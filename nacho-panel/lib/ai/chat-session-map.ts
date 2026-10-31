/* uiSessionId -> opencodeSessionId 映射：重启后恢复已保存会话的模型上下文。
 * 仅由 Next 服务端引用，文件位于 %LOCALAPPDATA%\NachoPanel\ai-chat-session-map.json。 */

import { randomUUID } from "node:crypto"
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises"
import path from "node:path"
import { getAIChatSessionMapPath } from "./runtime-paths"

const MAX_MAPPINGS = 500
const FILE_MODE = 0o600
const ID_PATTERN = /^[A-Za-z0-9_:-]{1,160}$/

type Mapping = { opencodeSessionId: string; updatedAt: number }
type MapFile = { version: 1; mappings: Record<string, Mapping> }

export type ChatSessionMapStore = {
  get: (uiSessionId: string) => Promise<Mapping | null>
  remember: (uiSessionId: string, opencodeSessionId: string) => Promise<void>
  forget: (uiSessionId: string) => Promise<void>
}

export type ChatSessionMapStoreOptions = { filePath: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value)
}

function normalizeMap(value: unknown): MapFile {
  if (!isRecord(value) || !isRecord(value.mappings)) return { version: 1, mappings: {} }
  const mappings: Record<string, Mapping> = {}
  for (const [uiSessionId, raw] of Object.entries(value.mappings)) {
    if (!validId(uiSessionId) || !isRecord(raw)) continue
    const opencodeSessionId = raw.opencodeSessionId
    const updatedAt = raw.updatedAt
    if (!validId(opencodeSessionId) || typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) continue
    mappings[uiSessionId] = { opencodeSessionId, updatedAt }
  }
  const kept = Object.entries(mappings)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, MAX_MAPPINGS)
  return { version: 1, mappings: Object.fromEntries(kept) }
}

export function createAIChatSessionMapStore({ filePath }: ChatSessionMapStoreOptions): ChatSessionMapStore {
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

  async function readFileState(): Promise<MapFile> {
    let fileStat
    try {
      fileStat = await stat(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, mappings: {} }
      throw error
    }
    if (fileStat.size > 1024 * 1024) {
      await quarantine()
      return { version: 1, mappings: {} }
    }
    try {
      return normalizeMap(JSON.parse(await readFile(filePath, "utf8")))
    } catch {
      await quarantine()
      return { version: 1, mappings: {} }
    }
  }

  async function writeState(state: MapFile): Promise<void> {
    const normalized = normalizeMap(state)
    const content = `${JSON.stringify(normalized)}\n`
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
      const verify = normalizeMap(JSON.parse(await readFile(filePath, "utf8")))
      if (JSON.stringify(verify) !== JSON.stringify(normalized)) {
        throw new Error("会话映射写入校验失败")
      }
    } finally {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }

  async function get(uiSessionId: string) {
    if (!validId(uiSessionId)) return null
    const state = await readFileState()
    return state.mappings[uiSessionId] ?? null
  }

  async function remember(uiSessionId: string, opencodeSessionId: string) {
    if (!validId(uiSessionId) || !validId(opencodeSessionId)) return
    await withWriteLock(async () => {
      const state = await readFileState()
      state.mappings[uiSessionId] = { opencodeSessionId, updatedAt: Date.now() }
      await writeState(state)
    })
  }

  async function forget(uiSessionId: string) {
    if (!validId(uiSessionId)) return
    await withWriteLock(async () => {
      const state = await readFileState()
      if (!state.mappings[uiSessionId]) return
      delete state.mappings[uiSessionId]
      await writeState(state)
    })
  }

  return { get, remember, forget }
}

let singleton: ChatSessionMapStore | null = null

export function getAIChatSessionMapStore() {
  if (!singleton) singleton = createAIChatSessionMapStore({ filePath: getAIChatSessionMapPath() })
  return singleton
}
