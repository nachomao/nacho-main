const fs = require("node:fs")
const path = require("node:path")
const { randomUUID } = require("node:crypto")

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

const ERROR_MESSAGES = {
  "read-failed": "本地凭据文件读取失败",
  "invalid-format": "本地凭据文件格式不完整",
  "encryption-unavailable": "系统凭据加密暂不可用",
  "decrypt-failed": "凭据解密认证失败",
  "invalid-snapshot": "解密后的凭据结构无效",
  "write-failed": "凭据保存或磁盘校验失败",
}
class ConnectionStorageError extends Error {
  constructor(code) {
    super(`加密连接配置读取失败：${ERROR_MESSAGES[code]}`)
    this.code = code
  }
}
const MAX_RECORD_BYTES = 128 * 1024

function createConnectionStore({ safeStorage, protector, filePath, archivedPath = null, fileSystem = fs }) {
  if (!safeStorage || typeof filePath !== "string" || !filePath) {
    throw new TypeError("加密存储初始化参数无效")
  }

  const io = fileSystem
  const backupPath = `${filePath}.previous`

  function ensureEncryption() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new ConnectionStorageError("encryption-unavailable")
    }
  }

  function decode(file) {
    let text
    try {
      if (io.statSync(file).size > MAX_RECORD_BYTES) throw new ConnectionStorageError("invalid-format")
      text = io.readFileSync(file, "utf8")
    } catch (error) { throw error instanceof ConnectionStorageError ? error : new ConnectionStorageError("read-failed") }
    let envelope
    try {
      envelope = JSON.parse(text)
      const keys = envelope.version === 1 ? ["version", "ciphertext"] : ["version", "scheme", "ciphertext"]
      if (![1, 2].includes(envelope.version) || !hasExactKeys(envelope, keys) ||
          typeof envelope.ciphertext !== "string" || !envelope.ciphertext.length) throw new Error()
      const bytes = Buffer.from(envelope.ciphertext, "base64")
      if (bytes.toString("base64") !== envelope.ciphertext) throw new Error()
      if (envelope.version === 2 && envelope.scheme !== "windows-dpapi-current-user") throw new Error()
    } catch { throw new ConnectionStorageError("invalid-format") }
    let plaintext
    if (envelope.version === 1) ensureEncryption()
    try {
      const bytes = Buffer.from(envelope.ciphertext, "base64")
      plaintext = envelope.version === 1 ? safeStorage.decryptString(bytes) : protector.unprotect(bytes)
    }
    catch { throw new ConnectionStorageError("decrypt-failed") }
    try { return { snapshot: validateSnapshot(JSON.parse(plaintext)), version: envelope.version } }
    catch { throw new ConnectionStorageError("invalid-snapshot") }
  }

  function sourcePath() {
    if (io.existsSync(filePath)) return filePath
    if (archivedPath && io.existsSync(archivedPath)) return archivedPath
    if (io.existsSync(backupPath)) throw new ConnectionStorageError("read-failed")
    return null
  }
  function get() {
    const source = sourcePath()
    if (!source) return { snapshot: structuredClone(EMPTY_SNAPSHOT), persisted: false }
    const { snapshot, version } = decode(source)
    // 成功解密后才迁移；重新初始化之前，历史记录也继续保留。
    if (version === 1 || source !== filePath) {
      commit(snapshot, source)
      if (source === archivedPath) io.renameSync(source, `${source}.migrated-${randomUUID()}`)
    }
    return { snapshot, persisted: true }
  }
  function commit(next, previousSource) {
    let envelope
    try {
      const plaintext = JSON.stringify(next)
      const ciphertext = protector.protect(plaintext)
      if (protector.unprotect(ciphertext) !== plaintext) throw new Error()
      envelope = JSON.stringify({ version: 2, scheme: "windows-dpapi-current-user", ciphertext: ciphertext.toString("base64") })
    } catch (error) { throw error instanceof ConnectionStorageError ? error : new ConnectionStorageError("write-failed") }
    const directory = path.dirname(filePath)
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`
    let oldBytes = null
    let installed = false
    try {
      io.mkdirSync(directory, { recursive: true })
      if (previousSource) oldBytes = io.readFileSync(previousSource)
      const descriptor = io.openSync(temporaryPath, "wx", 0o600)
      try { io.writeFileSync(descriptor, envelope, "utf8"); io.fsyncSync(descriptor) }
      finally { io.closeSync(descriptor) }
      if (JSON.stringify(decode(temporaryPath).snapshot) !== JSON.stringify(next)) throw new Error()
      if (oldBytes && previousSource === filePath) io.writeFileSync(backupPath, oldBytes, { mode: 0o600 })
      io.renameSync(temporaryPath, filePath)
      installed = true
      if (JSON.stringify(decode(filePath).snapshot) !== JSON.stringify(next)) throw new Error()
    } catch (error) {
      // 磁盘验证失败不更新内存；恢复原文件，首次写入失败则保留空状态。
      if (installed) {
        try {
          if (oldBytes && previousSource === filePath) io.writeFileSync(filePath, oldBytes, { mode: 0o600 })
          else io.rmSync(filePath, { force: true })
        } catch { /* 保留已写入备份，下一次读取进入恢复状态。 */ }
      }
      throw new ConnectionStorageError("write-failed")
    } finally {
      try { io.rmSync(temporaryPath, { force: true }) } catch {}
    }
  }
  function set(value) {
    const next = validateSnapshot(value)
    const source = sourcePath()
    if (source) decode(source) // 失败记录不能被普通保存静默覆盖。
    commit(next, source)
    return get()
  }
  function clear() {
    get() // 异常记录必须经独立、明确确认的重新初始化流程处理。
    return reinitialize("RESET_LOCAL_CREDENTIALS")
  }
  function read() {
    try { return get() }
    catch (error) {
      const code = error instanceof ConnectionStorageError ? error.code : "read-failed"
      return { snapshot: null, persisted: true, error: { code, message: ERROR_MESSAGES[code] } }
    }
  }
  function reinitialize(confirmation) {
    if (confirmation !== "RESET_LOCAL_CREDENTIALS") throw new Error("需要明确确认本机凭据重新初始化")
    // 仅备份密文，不移除历史备份或触碰服务端配置、数据库。
    if (io.existsSync(filePath)) {
      io.renameSync(filePath, `${filePath}.recovery-${randomUUID()}`)
    }
    if (io.existsSync(backupPath)) io.renameSync(backupPath, `${backupPath}.recovery-${randomUUID()}`)
    if (archivedPath && io.existsSync(archivedPath)) {
      io.renameSync(archivedPath, `${archivedPath}.recovery-${randomUUID()}`)
    }
    return get()
  }
  return { load: get, get, set, clear, read, retry: read, reinitialize }
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
    return store.read()
  })
  ipcMain.handle("connection:set", (event, value) => {
    assertMainFrame(event, getMainWindow)
    return store.set(value)
  })
  ipcMain.handle("connection:clear", (event) => {
    assertMainFrame(event, getMainWindow)
    return store.clear()
  })
  ipcMain.handle("connection:retry", (event) => {
    assertMainFrame(event, getMainWindow)
    return store.retry()
  })
  ipcMain.handle("connection:reinitialize", (event, confirmation) => {
    assertMainFrame(event, getMainWindow)
    return store.reinitialize(confirmation)
  })
}

module.exports = {
  createConnectionStore,
  registerConnectionIpc,
  validateSnapshot,
  ConnectionStorageError,
}
