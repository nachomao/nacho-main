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
function createProtector() {
  return {
    protect: (value) => Buffer.from(`windows-user-fixture:${value}`),
    unprotect: (value) => {
      const text = value.toString()
      if (!text.startsWith("windows-user-fixture:")) throw new Error("invalid protected bytes")
      return text.slice("windows-user-fixture:".length)
    },
  }
}

function createTempStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-connection-store-"))
  const safeStorage = createSafeStorage()
  const protector = createProtector()
  const filePath = path.join(directory, "NachoPanel", "connection-secrets.json")
  return {
    directory,
    filePath,
    safeStorage,
    protector,
    store: createConnectionStore({ safeStorage, protector, filePath }),
  }
}

test("connection store persists v2 ciphertext and verifies each disk read", () => {
  const context = createTempStore()
  try {
    context.store.set(fixture)
    const disk = fs.readFileSync(context.filePath, "utf8")
    const envelope = JSON.parse(disk)
    assert.deepEqual(Object.keys(envelope).sort(), ["ciphertext", "scheme", "version"])
    assert.equal(envelope.version, 2)
    assert.doesNotMatch(disk, /fixture-api-key|fixture-login-secret|panel\.example/)

    const restarted = createConnectionStore({
      safeStorage: context.safeStorage,
      protector: context.protector,
      filePath: context.filePath,
    })
    assert.deepEqual(restarted.load(), { snapshot: fixture, persisted: true })
    assert.deepEqual(restarted.get(), { snapshot: fixture, persisted: true })
    assert.deepEqual(restarted.get(), { snapshot: fixture, persisted: true })
    assert.equal(context.safeStorage.decryptions, 0, "v2 does not depend on Electron profile decryption")
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
      protector: context.protector,
      filePath: context.filePath,
    })
    assert.throws(() => restarted.get(), /加密连接配置读取失败/)
  } finally {
    fs.rmSync(context.directory, { recursive: true, force: true })
  }
})

test("read returns classified, non-sensitive error and never overwrites a failed record", () => {
  const context = createTempStore()
  try {
    context.store.set(fixture)
    const bad = JSON.stringify({ version: 1, ciphertext: Buffer.from("other-key-data").toString("base64") })
    fs.writeFileSync(context.filePath, bad)
    const result = context.store.read()
    assert.equal(result.snapshot, null)
    assert.equal(result.error.code, "decrypt-failed")
    assert.doesNotMatch(JSON.stringify(result), /fixture-api-key|fixture-login-secret/)
    assert.throws(() => context.store.set(fixture), /读取失败/)
    assert.equal(fs.readFileSync(context.filePath, "utf8"), bad)
    assert.throws(() => context.store.reinitialize("yes"), /明确确认/)
    assert.equal(fs.readFileSync(context.filePath, "utf8"), bad)
    assert.equal(context.store.reinitialize("RESET_LOCAL_CREDENTIALS").persisted, false)
    const archives = fs.readdirSync(path.dirname(context.filePath)).filter((name) => name.includes(".recovery-"))
    assert.ok(archives.length > 0)
    assert.ok(archives.some((name) => fs.readFileSync(path.join(path.dirname(context.filePath), name), "utf8") === bad))
  } finally { fs.rmSync(context.directory, { recursive: true, force: true }) }
})

test("read detects disk tampering after a previous successful read instead of using cached credentials", () => {
  const context = createTempStore()
  try {
    context.store.set(fixture)
    assert.equal(context.store.get().persisted, true)
    fs.writeFileSync(context.filePath, "{")
    assert.equal(context.store.read().error.code, "invalid-format")
  } finally { fs.rmSync(context.directory, { recursive: true, force: true }) }
})

test("v1 migrates only after successful decryption and preserves original encrypted bytes", () => {
  const context = createTempStore()
  try {
    fs.mkdirSync(path.dirname(context.filePath), { recursive: true })
    const original = JSON.stringify({ version: 1, ciphertext: context.safeStorage.encryptString(JSON.stringify(fixture)).toString("base64") })
    fs.writeFileSync(context.filePath, original)
    assert.deepEqual(context.store.get().snapshot, fixture)
    assert.equal(JSON.parse(fs.readFileSync(context.filePath, "utf8")).version, 2)
    assert.equal(fs.readFileSync(`${context.filePath}.previous`, "utf8"), original)
  } finally { fs.rmSync(context.directory, { recursive: true, force: true }) }
})

test("v2 stays readable when Electron profile or legacy safeStorage changes", () => {
  const context = createTempStore()
  const store = createConnectionStore({ safeStorage: context.safeStorage, protector: context.protector, filePath: context.filePath })
  try {
    store.set(fixture)
    const bytes = fs.readFileSync(context.filePath)
    context.safeStorage.decryptString = () => { throw new Error("changed Chromium key") }
    assert.deepEqual(store.retry().snapshot, fixture)
    assert.ok(fs.readFileSync(context.filePath).equals(bytes))
  } finally { fs.rmSync(context.directory, { recursive: true, force: true }) }
})

test("post-commit disk verification failure restores the exact previous ciphertext", () => {
  const context = createTempStore()
  try {
    context.store.set(fixture)
    const previous = fs.readFileSync(context.filePath)
    let installed = false
    let corrupted = false
    const io = Object.create(fs)
    io.renameSync = (...args) => { fs.renameSync(...args); if (args[1] === context.filePath) installed = true }
    io.readFileSync = (file, ...args) => {
      if (file === context.filePath && installed && !corrupted) {
        corrupted = true
        fs.writeFileSync(file, "corrupted")
      }
      return fs.readFileSync(file, ...args)
    }
    const store = createConnectionStore({ safeStorage: context.safeStorage, protector: context.protector, filePath: context.filePath, fileSystem: io })
    assert.throws(() => store.set({ ...fixture, locked: false }), /磁盘校验失败/)
    assert.ok(fs.readFileSync(context.filePath).equals(previous))
    assert.deepEqual(context.store.get().snapshot, fixture)
  } finally { fs.rmSync(context.directory, { recursive: true, force: true }) }
})

test("archived v1 without its key produces recovery status and stays unchanged", () => {
  const context = createTempStore()
  try {
    const archivedPath = path.join(context.directory, "archived.json")
    const bad = JSON.stringify({ version: 1, ciphertext: Buffer.from("lost-key").toString("base64") })
    fs.writeFileSync(archivedPath, bad)
    const store = createConnectionStore({ safeStorage: context.safeStorage, filePath: context.filePath, archivedPath })
    assert.equal(store.read().error.code, "decrypt-failed")
    assert.equal(fs.readFileSync(archivedPath, "utf8"), bad)
    assert.equal(fs.existsSync(context.filePath), false)
  } finally { fs.rmSync(context.directory, { recursive: true, force: true }) }
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
    assert.throws(() => store.set(fixture), /保存或磁盘校验失败/)
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
  const protectorModule = path.resolve(__dirname, "..", "src", "credential-protector.cjs")
  const helperExe = path.resolve(__dirname, "..", "build", "credential-protector", "nacho-credential-protector.exe")
  const snapshot = {
    serverSource: { mode: "cloud", api: "https://electron.example", key: "electron-api-key" },
    auth: { mode: "key", secret: "electron-login-secret" },
    locked: false,
  }
  fs.writeFileSync(scriptPath, `
    const { app, safeStorage } = require("electron")
    const { createConnectionStore } = require(process.env.NACHO_CONNECTION_STORE_MODULE)
    const { createCredentialProtector } = require(${JSON.stringify(protectorModule)})
    app.setPath("userData", process.env.NACHO_CONNECTION_USER_DATA)
    app.whenReady().then(() => {
      if (!safeStorage.isEncryptionAvailable()) {
        process.stdout.write(JSON.stringify({ available: false }))
        app.quit()
        return
      }
      const store = createConnectionStore({
        safeStorage,
        protector: createCredentialProtector(${JSON.stringify(helperExe)}),
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
