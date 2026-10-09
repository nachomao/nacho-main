const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const test = require("node:test")
const { createConnectionStore, registerConnectionIpc } = require("../src/connection-store.cjs")

const fixture = {
  serverSource: { mode: "cloud", api: "https://panel.example", key: "fixture-api-key" },
  auth: { mode: "password", secret: "fixture-login-secret" },
  locked: true,
}

function createSafeStorage() {
  let decryptions = 0
  return {
    get decryptions() { return decryptions },
    isEncryptionAvailable: () => true,
    encryptString(value) {
      return Buffer.from(`dpapi-fixture:${value}`, "utf8")
    },
    decryptString(value) {
      decryptions += 1
      const text = value.toString("utf8")
      if (!text.startsWith("dpapi-fixture:")) throw new Error("invalid encrypted payload")
      return text.slice("dpapi-fixture:".length)
    },
  }
}

function createTempStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-connection-store-"))
  const safeStorage = createSafeStorage()
  const filePath = path.join(directory, "NachoPanel", "connection-secrets.json")
  return {
    directory,
    filePath,
    safeStorage,
    store: createConnectionStore({ safeStorage, filePath }),
  }
}

test("connection store persists only ciphertext and restores a single cached snapshot", () => {
  const context = createTempStore()
  try {
    context.store.set(fixture)
    const disk = fs.readFileSync(context.filePath, "utf8")
    const envelope = JSON.parse(disk)
    assert.deepEqual(Object.keys(envelope).sort(), ["ciphertext", "version"])
    assert.equal(envelope.version, 1)
    assert.doesNotMatch(disk, /fixture-api-key|fixture-login-secret|panel\.example/)

    const restarted = createConnectionStore({
      safeStorage: context.safeStorage,
      filePath: context.filePath,
    })
    assert.deepEqual(restarted.load(), { snapshot: fixture, persisted: true })
    assert.deepEqual(restarted.get(), { snapshot: fixture, persisted: true })
    assert.deepEqual(restarted.get(), { snapshot: fixture, persisted: true })
    assert.equal(context.safeStorage.decryptions, 1)
  } finally {
    fs.rmSync(context.directory, { recursive: true, force: true })
  }
})

test("tampered ciphertext is rejected without plaintext recovery", () => {
  const context = createTempStore()
  try {
    context.store.set(fixture)
    const envelope = JSON.parse(fs.readFileSync(context.filePath, "utf8"))
    envelope.ciphertext = Buffer.from("tampered", "utf8").toString("base64")
    fs.writeFileSync(context.filePath, JSON.stringify(envelope), "utf8")

    const restarted = createConnectionStore({
      safeStorage: context.safeStorage,
      filePath: context.filePath,
    })
    assert.throws(() => restarted.get(), /加密连接配置读取失败/)
    assert.equal(context.safeStorage.decryptions, 1)
  } finally {
    fs.rmSync(context.directory, { recursive: true, force: true })
  }
})

test("connection IPC accepts only the current main-window frame", async () => {
  const context = createTempStore()
  const handlers = new Map()
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) }
  const webContents = { mainFrame: { id: "main-frame" } }
  const mainWindow = { webContents, isDestroyed: () => false }
  registerConnectionIpc({ ipcMain, getMainWindow: () => mainWindow, store: context.store })
  const invoke = (channel, sender = webContents, senderFrame = webContents.mainFrame, value) =>
    handlers.get(channel)({ sender, senderFrame }, value)

  try {
    assert.deepEqual(await invoke("connection:set", webContents, webContents.mainFrame, fixture), {
      snapshot: fixture,
      persisted: true,
    })
    assert.deepEqual(await invoke("connection:get"), { snapshot: fixture, persisted: true })
    assert.throws(() => invoke("connection:get", {}), /窗口来源无效/)
    assert.throws(() => invoke("connection:get", webContents, { id: "child-frame" }), /子框架/)
    assert.deepEqual(await invoke("connection:clear"), {
      snapshot: { serverSource: null, auth: null, locked: false },
      persisted: false,
    })
  } finally {
    fs.rmSync(context.directory, { recursive: true, force: true })
  }
})

test("encryption unavailability never writes plaintext", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-connection-unavailable-"))
  const filePath = path.join(directory, "connection-secrets.json")
  const store = createConnectionStore({
    safeStorage: { isEncryptionAvailable: () => false },
    filePath,
  })
  try {
    assert.throws(() => store.set(fixture), /加密不可用/)
    assert.equal(fs.existsSync(filePath), false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test("real Electron safeStorage survives a process restart", (t) => {
  const electronPath = path.join(__dirname, "..", "node_modules", "electron", "dist", "electron.exe")
  if (process.platform !== "win32" || !fs.existsSync(electronPath)) {
    t.skip("仅在 Windows Electron 打包环境执行")
    return
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-electron-connection-"))
  const scriptPath = path.join(directory, "probe.cjs")
  const modulePath = path.resolve(__dirname, "..", "src", "connection-store.cjs")
  const snapshot = {
    serverSource: { mode: "cloud", api: "https://electron.example", key: "electron-api-key" },
    auth: { mode: "key", secret: "electron-login-secret" },
    locked: false,
  }
  fs.writeFileSync(scriptPath, `
    const { app, safeStorage } = require("electron")
    const { createConnectionStore } = require(process.env.NACHO_CONNECTION_STORE_MODULE)
    app.setPath("userData", process.env.NACHO_CONNECTION_USER_DATA)
    app.whenReady().then(() => {
      if (!safeStorage.isEncryptionAvailable()) {
        process.stdout.write(JSON.stringify({ available: false }))
        app.quit()
        return
      }
      const store = createConnectionStore({
        safeStorage,
        filePath: process.env.NACHO_CONNECTION_STORE_PATH,
      })
      if (process.env.NACHO_CONNECTION_MODE === "set") {
        store.set(JSON.parse(process.env.NACHO_CONNECTION_SNAPSHOT))
        process.stdout.write(JSON.stringify({ available: true, action: "set" }))
      } else {
        process.stdout.write(JSON.stringify({ available: true, action: "get", value: store.get() }))
      }
      app.quit()
    }).catch((error) => {
      console.error(error.stack || error.message)
      app.exit(1)
    })
  `, "utf8")
  const run = (mode) => spawnSync(electronPath, [scriptPath], {
    env: {
      ...process.env,
      NACHO_CONNECTION_MODE: mode,
      NACHO_CONNECTION_STORE_MODULE: modulePath,
      NACHO_CONNECTION_STORE_PATH: path.join(directory, "connection-secrets.json"),
      NACHO_CONNECTION_USER_DATA: path.join(directory, "user-data"),
      ...(mode === "set" ? { NACHO_CONNECTION_SNAPSHOT: JSON.stringify(snapshot) } : {}),
    },
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  })

  try {
    const first = run("set")
    assert.equal(first.status, 0, first.stderr || first.stdout)
    const firstResult = JSON.parse(first.stdout.trim())
    if (!firstResult.available) {
      t.skip("当前 Electron 环境未启用 safeStorage")
      return
    }
    const disk = fs.readFileSync(path.join(directory, "connection-secrets.json"), "utf8")
    assert.doesNotMatch(disk, /electron-api-key|electron-login-secret|electron\.example/)

    const second = run("get")
    assert.equal(second.status, 0, second.stderr || second.stdout)
    assert.deepEqual(JSON.parse(second.stdout.trim()), {
      available: true,
      action: "get",
      value: { snapshot, persisted: true },
    })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
