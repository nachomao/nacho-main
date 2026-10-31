/* AI Mode 会话历史快照存储：保存在 %LOCALAPPDATA%\NachoPanel\ai-chat-history.json。
 * 仅由 Next 服务端引用；采用临时文件 + rename 的原子写入，损坏文件隔离后返回空快照。 */

import { randomUUID } from "node:crypto"
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises"
import path from "node:path"
import {
  emptyAIChatHistory,
  MAX_AI_CHAT_HISTORY_BYTES,
  normalizePersistedChatHistory,
  type PersistedChatHistory,
} from "./chat-history"
import { getAIChatHistoryPath } from "./runtime-paths"

export class AIChatHistoryStoreError extends Error {
  constructor(message: string, readonly code: "read" | "write" | "corrupt" | "too-large") {
    super(message)
    this.name = "AIChatHistoryStoreError"
  }
}

export type ChatHistorySnapshot = {
  history: PersistedChatHistory
  exists: boolean
  recovered: boolean
}

export type ChatHistoryStore = {
  read: () => Promise<ChatHistorySnapshot>
  write: (history: PersistedChatHistory) => Promise<ChatHistorySnapshot>
  remove: (uiSessionId: string) => Promise<{ removed: boolean; history: PersistedChatHistory }>
}

export type ChatHistoryStoreOptions = { filePath: string }

const MAX_RAW_BYTES = MAX_AI_CHAT_HISTORY_BYTES * 2
const FILE_MODE = 0o600

function serialize(history: PersistedChatHistory): string {
  return `${JSON.stringify({ ...history, savedAt: Date.now() })}\n`
}

export function createAIChatHistoryStore({ filePath }: ChatHistoryStoreOptions): ChatHistoryStore {
  let writeQueue: Promise<unknown> = Promise.resolve()

  function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(operation, operation)
    writeQueue = result.catch(() => undefined)
    return result
  }

  async function quarantine(): Promise<void> {
    const backup = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`
    await rename(filePath, backup).catch(() => undefined)
  }

  async function read(): Promise<ChatHistorySnapshot> {
    let fileStat
    try {
      fileStat = await stat(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { history: emptyAIChatHistory(), exists: false, recovered: false }
      }
      throw new AIChatHistoryStoreError("读取会话历史失败", "read")
    }
    if (fileStat.size > MAX_RAW_BYTES) {
      await quarantine()
      return { history: emptyAIChatHistory(), exists: true, recovered: true }
    }
    try {
      const raw = await readFile(filePath, "utf8")
      if (Buffer.byteLength(raw, "utf8") > MAX_RAW_BYTES) {
        throw new AIChatHistoryStoreError("会话历史文件过大", "corrupt")
      }
      const normalized = normalizePersistedChatHistory(JSON.parse(raw))
      if (!normalized) throw new AIChatHistoryStoreError("会话历史结构无效", "corrupt")
      return { history: normalized, exists: true, recovered: false }
    } catch {
      await quarantine()
      return { history: emptyAIChatHistory(), exists: true, recovered: true }
    }
  }

  async function writeUnlocked(history: PersistedChatHistory): Promise<ChatHistorySnapshot> {
    const normalized = normalizePersistedChatHistory(history)
    if (!normalized) throw new AIChatHistoryStoreError("会话历史结构无效", "write")
    const content = serialize(normalized)
    if (Buffer.byteLength(content, "utf8") > MAX_AI_CHAT_HISTORY_BYTES) {
      throw new AIChatHistoryStoreError("会话历史超过大小限制", "too-large")
    }
    await mkdir(path.dirname(filePath), { recursive: true })
    const temporaryPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
    )
    try {
      const handle = await open(temporaryPath, "wx", FILE_MODE)
      try {
        await handle.writeFile(content, "utf8")
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporaryPath, filePath)
      await chmod(filePath, FILE_MODE).catch(() => undefined)
      const verifyRaw = await readFile(filePath, "utf8")
      const verify = normalizePersistedChatHistory(JSON.parse(verifyRaw))
      if (
        !verify
        || verify.activeId !== normalized.activeId
        || JSON.stringify(verify.sessions) !== JSON.stringify(normalized.sessions)
      ) {
        throw new AIChatHistoryStoreError("会话历史写入校验失败", "write")
      }
      return { history: verify, exists: true, recovered: false }
    } catch (error) {
      throw error instanceof AIChatHistoryStoreError
        ? error
        : new AIChatHistoryStoreError("保存会话历史失败", "write")
    } finally {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }

  async function write(history: PersistedChatHistory): Promise<ChatHistorySnapshot> {
    return withWriteLock(() => writeUnlocked(history))
  }

  async function remove(uiSessionId: string) {
    return withWriteLock(async () => {
      const snapshot = await read()
      const sessions = snapshot.history.sessions.filter((session) => session.id !== uiSessionId)
      if (sessions.length === snapshot.history.sessions.length) {
        return { removed: false, history: snapshot.history }
      }
      const activeId = sessions.some((session) => session.id === snapshot.history.activeId)
        ? snapshot.history.activeId
        : sessions[0]?.id ?? ""
      const history: PersistedChatHistory = { ...snapshot.history, sessions, activeId }
      await writeUnlocked(history)
      return { removed: true, history }
    })
  }

  return { read, write, remove }
}

let singleton: ChatHistoryStore | null = null

export function getAIChatHistoryStore() {
  if (!singleton) singleton = createAIChatHistoryStore({ filePath: getAIChatHistoryPath() })
  return singleton
}
