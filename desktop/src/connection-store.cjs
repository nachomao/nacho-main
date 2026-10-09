const fs = require("node:fs")
const path = require("node:path")

const EMPTY_SNAPSHOT = Object.freeze({
  serverSource: null,
  auth: null,
  locked: false,
})

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key))
}

function validText(value, maxLength = 8_192) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value)
}

function validateServerSource(value) {
  if (value === null) return true
  if (!isPlainObject(value)) return false
  if (value.mode === "cloud") {
    return hasExactKeys(value, ["mode", "api", "key"])
      && validText(value.api, 2_048)
      && validText(value.key)
  }
  if (value.mode === "local") {
    const keys = Object.hasOwn(value, "agentApi")
      ? ["mode", "api", "agentApi", "key"]
      : ["mode", "api", "key"]
    return hasExactKeys(value, keys)
      && validText(value.api, 2_048)
      && (!Object.hasOwn(value, "agentApi") || validText(value.agentApi, 2_048))
      && validText(value.key)
  }
  return false
}

function validateSnapshot(value) {
  if (!hasExactKeys(value, ["serverSource", "auth", "locked"]) || typeof value.locked !== "boolean") {
    throw new TypeError("连接配置格式无效")
  }
  if (!validateServerSource(value.serverSource)) throw new TypeError("服务端连接格式无效")
  if (value.auth !== null) {
    if (!isPlainObject(value.auth)
      || !hasExactKeys(value.auth, ["mode", "secret"])
      || !["key", "password"].includes(value.auth.mode)
      || !validText(value.auth.secret)) {
      throw new TypeError("本地登录配置格式无效")
    }
  }
  return {
    serverSource: value.serverSource ? { ...value.serverSource } : null,
    auth: value.auth ? { ...value.auth } : null,
    locked: value.locked,
  }
}

function replaceFileAtomically(temporaryPath, filePath) {
  try {
    fs.renameSync(temporaryPath, filePath)
    return
  } catch (error) {
    // POSIX rename replaces the destination atomically. Windows refuses to
    // replace an existing file, so briefly move the old record aside and
    // restore it if the second rename fails.
    if (!["EEXIST", "EPERM", "EACCES"].includes(error?.code) || !fs.existsSync(filePath)) {
      throw error
    }
  }

  const backupPath = `${filePath}.${process.pid}.${Date.now()}.bak`
  let movedOriginal = false
  try {
    fs.renameSync(filePath, backupPath)
    movedOriginal = true
    fs.renameSync(temporaryPath, filePath)
    fs.rmSync(backupPath, { force: true })
  } catch (error) {
    if (movedOriginal && !fs.existsSync(filePath) && fs.existsSync(backupPath)) {
      try { fs.renameSync(backupPath, filePath) } catch {}
    }
    throw error
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true })
    if (fs.existsSync(backupPath) && fs.existsSync(filePath)) fs.rmSync(backupPath, { force: true })
  }
}

function createConnectionStore({ safeStorage, filePath }) {
  if (!safeStorage || typeof filePath !== "string" || !filePath) {
    throw new TypeError("加密存储初始化参数无效")
  }

  let initialized = false
  let loadError = null
  let persisted = false
  let snapshot = { ...EMPTY_SNAPSHOT }

  function ensureEncryption() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("系统凭据加密不可用")
    }
  }

  function initialize() {
    if (initialized) return
    initialized = true
    persisted = fs.existsSync(filePath)
    if (!persisted) return

    try {
      ensureEncryption()
      const envelope = JSON.parse(fs.readFileSync(filePath, "utf8"))
      if (!hasExactKeys(envelope, ["version", "ciphertext"])
        || envelope.version !== 1
        || typeof envelope.ciphertext !== "string"
        || envelope.ciphertext.length === 0) {
        throw new Error("加密连接文件格式无效")
      }
      const plaintext = safeStorage.decryptString(Buffer.from(envelope.ciphertext, "base64"))
      snapshot = validateSnapshot(JSON.parse(plaintext))
    } catch (error) {
      loadError = new Error("加密连接配置读取失败", { cause: error })
    }
  }

  function get() {
    initialize()
    if (loadError) throw loadError
    return {
      snapshot: structuredClone(snapshot),
      persisted,
    }
  }

  function set(value) {
    initialize()
    ensureEncryption()
    const next = validateSnapshot(value)
    const ciphertext = safeStorage.encryptString(JSON.stringify(next)).toString("base64")
    const envelope = JSON.stringify({ version: 1, ciphertext })
    const directory = path.dirname(filePath)
    fs.mkdirSync(directory, { recursive: true })
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`

    try {
      fs.writeFileSync(temporaryPath, envelope, { encoding: "utf8", mode: 0o600, flag: "wx" })
      replaceFileAtomically(temporaryPath, filePath)
    } catch (error) {
      try { fs.rmSync(temporaryPath, { force: true }) } catch {}
      throw error
    }

    snapshot = next
    persisted = true
    loadError = null
    return get()
  }

  function clear() {
    initialize()
    fs.rmSync(filePath, { force: true })
    snapshot = { ...EMPTY_SNAPSHOT }
    persisted = false
    loadError = null
    return get()
  }

  return { load: get, get, set, clear }
}

function assertMainFrame(event, getMainWindow) {
  const window = getMainWindow()
  if (!window || window.isDestroyed?.() || event.sender !== window.webContents) {
    throw new Error("窗口来源无效")
  }
  if (event.senderFrame && event.senderFrame !== event.sender.mainFrame) {
    throw new Error("面板子框架来源无效")
  }
}

function registerConnectionIpc({ ipcMain, getMainWindow, store }) {
  ipcMain.handle("connection:get", (event) => {
    assertMainFrame(event, getMainWindow)
    return store.get()
  })
  ipcMain.handle("connection:set", (event, value) => {
    assertMainFrame(event, getMainWindow)
    return store.set(value)
  })
  ipcMain.handle("connection:clear", (event) => {
    assertMainFrame(event, getMainWindow)
    return store.clear()
  })
}

module.exports = {
  createConnectionStore,
  registerConnectionIpc,
  validateSnapshot,
}
