import { randomUUID } from "node:crypto"
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises"
import path from "node:path"
import { MAX_AI_SETTINGS_BYTES, type AIConfig } from "./config-shared"
import { AIDesktopUnavailableError, createCredentialProtector, type CredentialProtector } from "./credential-protector"
import { getAISettingsPath } from "./runtime-paths"
import {
  defaultStoredSettings,
  redactSettings,
  validateStoredSettings,
  type StoredAIConfig,
} from "./settings-schema"

const ENVELOPE_VERSION = 1
const ENVELOPE_SCHEME = "windows-dpapi-current-user"

type Envelope = {
  version: number
  scheme: string
  ciphertext: string
}

export class AISettingsStoreError extends Error {
  constructor(message: string, readonly code: "read" | "write" | "corrupt") {
    super(message)
    this.name = "AISettingsStoreError"
  }
}

export type AISettingsSnapshot = {
  config: StoredAIConfig
  exists: boolean
  recovered: boolean
}

export type SettingsStoreOptions = {
  filePath: string
  protector: CredentialProtector
}

export function createSettingsStore({ filePath, protector }: SettingsStoreOptions) {
  let cache: { mtimeMs: number; size: number; snapshot: AISettingsSnapshot } | null = null
  let writeQueue: Promise<unknown> = Promise.resolve()

  function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(operation, operation)
    writeQueue = result.catch(() => undefined)
    return result
  }

  function decode(raw: string): StoredAIConfig {
    const envelope = JSON.parse(raw) as Envelope
    if (!envelope || envelope.version !== ENVELOPE_VERSION || envelope.scheme !== ENVELOPE_SCHEME) {
      throw new AISettingsStoreError("AI 设置密文版本不受支持", "corrupt")
    }
    if (typeof envelope.ciphertext !== "string" || !envelope.ciphertext) {
      throw new AISettingsStoreError("AI 设置密文为空", "corrupt")
    }
    const plaintext = protector.unprotect(Buffer.from(envelope.ciphertext, "base64"))
    if (Buffer.byteLength(plaintext, "utf8") > MAX_AI_SETTINGS_BYTES) {
      throw new AISettingsStoreError("AI 设置超过大小限制", "corrupt")
    }
    return validateStoredSettings(JSON.parse(plaintext))
  }

  function encode(config: StoredAIConfig): string {
    const normalized = validateStoredSettings(config)
    const plaintext = JSON.stringify(normalized)
    if (Buffer.byteLength(plaintext, "utf8") > MAX_AI_SETTINGS_BYTES) {
      throw new AISettingsStoreError("AI 设置超过大小限制", "write")
    }
    const ciphertext = protector.protect(plaintext).toString("base64")
    const envelope: Envelope = {
      version: ENVELOPE_VERSION,
      scheme: ENVELOPE_SCHEME,
      ciphertext,
    }
    return `${JSON.stringify(envelope)}\n`
  }

  async function read(): Promise<AISettingsSnapshot> {
    let fileStat
    try {
      fileStat = await stat(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const snapshot = { config: defaultStoredSettings(), exists: false, recovered: false }
        cache = { mtimeMs: 0, size: 0, snapshot }
        return snapshot
      }
      throw new AISettingsStoreError("读取 AI 设置失败", "read")
    }
    if (cache && cache.mtimeMs === fileStat.mtimeMs && cache.size === fileStat.size) return cache.snapshot
    try {
      const raw = await readFile(filePath, "utf8")
      if (Buffer.byteLength(raw, "utf8") > MAX_AI_SETTINGS_BYTES * 2) {
        throw new AISettingsStoreError("AI 设置密文过大", "corrupt")
      }
      const snapshot = { config: decode(raw), exists: true, recovered: false }
      cache = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, snapshot }
      return snapshot
    } catch (error) {
      if (error instanceof AIDesktopUnavailableError) throw error
      cache = null
      return { config: defaultStoredSettings(), exists: true, recovered: true }
    }
  }

  async function write(config: StoredAIConfig): Promise<AISettingsSnapshot> {
    const normalized = validateStoredSettings(config)
    const content = encode(normalized)
    await mkdir(path.dirname(filePath), { recursive: true })
    const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
    try {
      const handle = await open(temporaryPath, "wx", 0o600)
      try {
        await handle.writeFile(content, "utf8")
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporaryPath, filePath)
      await chmod(filePath, 0o600).catch(() => undefined)
      const verify = await readFile(filePath, "utf8")
      const decoded = decode(verify)
      if (JSON.stringify(decoded) !== JSON.stringify(normalized)) {
        throw new AISettingsStoreError("AI 设置写入校验失败", "write")
      }
      const fileStat = await stat(filePath)
      const snapshot = { config: decoded, exists: true, recovered: false }
      cache = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, snapshot }
      return snapshot
    } catch (error) {
      throw error instanceof AISettingsStoreError ? error : new AISettingsStoreError("保存 AI 设置失败", "write")
    } finally {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }

  async function update(operation: (current: StoredAIConfig) => StoredAIConfig | Promise<StoredAIConfig>) {
    return withWriteLock(async () => {
      const current = (await read()).config
      const next = await operation(current)
      return write(next)
    })
  }

  async function getRedacted(): Promise<AIConfig> {
    return redactSettings((await read()).config)
  }

  return { read, write, update, getRedacted }
}

let singleton: ReturnType<typeof createSettingsStore> | null = null

export function getAISettingsStore() {
  if (!singleton) {
    singleton = createSettingsStore({
      filePath: getAISettingsPath(),
      protector: createCredentialProtector(),
    })
  }
  return singleton
}
