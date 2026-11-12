/**
 * WebSSH 面板侧纯逻辑：消息解析、终端行缓冲、尺寸换算、Windows 路径与分块传输工具。
 * 组件只负责渲染与生命周期，协议细节集中在这里并由单元测试覆盖。
 */

export type TerminalShell = "powershell" | "cmd"

export const TERMINAL_MIN_COLS = 20
export const TERMINAL_MAX_COLS = 240
export const TERMINAL_MIN_ROWS = 5
export const TERMINAL_MAX_ROWS = 100
export const TERMINAL_MAX_LINES = 2000
export const TERMINAL_MAX_LINE_CHARS = 4000
export const FILE_CHUNK_BYTES = 256 * 1024
export const FILE_MAX_BYTES = 512 * 1024 * 1024

export type TerminalServerMessage =
  | {
      kind: "ready"
      sessionId: string
      clientId: string
      shell: TerminalShell
      cols: number
      rows: number
      startedAt: number
      seq: number
      reconnected: boolean
      agentAttached: boolean
    }
  | { kind: "agent-connected" }
  | { kind: "agent-ready"; shell: TerminalShell; pid: number | null; cwd: string | null }
  | { kind: "output"; seq: number; data: string }
  | { kind: "exit"; code: number | null; reason: string; truncated?: boolean }
  | { kind: "error"; code?: string; message: string }
  | { kind: "pong"; serverTime: number }
  | { kind: "resize-ack"; cols: number; rows: number }

export type RemoteEntry = {
  name: string
  type: "dir" | "file"
  size: number | null
  mtimeUtc: string | null
}

export type RemoteRoot = {
  path: string
  label: string
  freeBytes: number | null
  totalBytes: number | null
}

export type FileServerMessage =
  | { kind: "ready"; sessionId: string; clientId: string; reconnected: boolean; agentAttached: boolean }
  | { kind: "agent-connected" }
  | { kind: "closed"; reason: string; error: string | null }
  | { kind: "rootsResult"; id: string; roots: RemoteRoot[] }
  | { kind: "listResult"; id: string; path: string; entries: RemoteEntry[]; truncated: boolean }
  | { kind: "deleteResult"; id: string; path: string; deleted: true }
  | { kind: "downloadStart"; id: string; transferId: string; name: string; size: number; sha256: string }
  | { kind: "downloadChunk"; id: string; transferId: string; offset: number; data: string; sha256: string }
  | { kind: "downloadComplete"; id: string; transferId: string; size: number }
  | { kind: "uploadReady"; id: string; transferId: string; receivedBytes: number }
  | { kind: "uploadAck"; id: string; transferId: string; receivedBytes: number }
  | { kind: "uploadComplete"; id: string; transferId: string; path: string; size: number; sha256: string }
  | { kind: "error"; id?: string; transferId?: string; code: string; message: string; receivedBytes?: number }

export type TerminalSessionResponse = {
  session: {
    id: string
    clientId: string
    shell: TerminalShell
    cols: number
    rows: number
    status: string
    createdAt: number
  }
  ticket: string
  wsPath: string
}

export type FileSessionResponse = {
  session: { id: string; clientId: string; status: string; createdAt: number }
  ticket: string
  wsPath: string
}

export function clampTerminalSize(cols: number, rows: number): { cols: number; rows: number } {
  const safeCols = Number.isFinite(cols) ? Math.round(cols) : 120
  const safeRows = Number.isFinite(rows) ? Math.round(rows) : 30
  return {
    cols: Math.min(TERMINAL_MAX_COLS, Math.max(TERMINAL_MIN_COLS, safeCols)),
    rows: Math.min(TERMINAL_MAX_ROWS, Math.max(TERMINAL_MIN_ROWS, safeRows)),
  }
}

/** 按等宽字体近似换算终端列/行；最终仍由服务端与 Agent 再做一次夹取。 */
export function terminalSizeFromPixels(width: number, height: number): { cols: number; rows: number } {
  const cols = Number.isFinite(width) && width > 0 ? Math.floor(width / 7.2) : 120
  const rows = Number.isFinite(height) && height > 0 ? Math.floor(height / 18) : 30
  return clampTerminalSize(cols, rows)
}

export function buildWebSocketUrl(baseUrl: string, wsPath: string): string {
  const url = new URL(wsPath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const terminalKinds = new Set(["ready", "agent-connected", "agent-ready", "output", "exit", "error", "pong", "resize-ack"])

export function parseTerminalServerMessage(raw: string): TerminalServerMessage | null {
  const value = parseJsonObject(raw)
  if (!value || typeof value.kind !== "string" || !terminalKinds.has(value.kind)) return null
  switch (value.kind) {
    case "ready":
      if (typeof value.sessionId !== "string" || typeof value.clientId !== "string") return null
      if (value.shell !== "powershell" && value.shell !== "cmd") return null
      if (typeof value.cols !== "number" || typeof value.rows !== "number" || typeof value.startedAt !== "number") return null
      if (typeof value.seq !== "number" || typeof value.reconnected !== "boolean" || typeof value.agentAttached !== "boolean") return null
      return value as TerminalServerMessage
    case "agent-ready":
      if (value.shell !== "powershell" && value.shell !== "cmd") return null
      if (value.pid !== null && typeof value.pid !== "number") return null
      if (value.cwd !== null && typeof value.cwd !== "string") return null
      return value as TerminalServerMessage
    case "output":
      if (typeof value.seq !== "number" || typeof value.data !== "string") return null
      return value as TerminalServerMessage
    case "exit":
      if (value.code !== null && typeof value.code !== "number") return null
      if (typeof value.reason !== "string") return null
      return value as TerminalServerMessage
    case "error":
      if (typeof value.message !== "string") return null
      return value as TerminalServerMessage
    case "pong":
      if (typeof value.serverTime !== "number") return null
      return value as TerminalServerMessage
    case "resize-ack":
      if (typeof value.cols !== "number" || typeof value.rows !== "number") return null
      return value as TerminalServerMessage
    default:
      return value as TerminalServerMessage
  }
}

const fileKinds = new Set([
  "ready",
  "agent-connected",
  "closed",
  "rootsResult",
  "listResult",
  "deleteResult",
  "downloadStart",
  "downloadChunk",
  "downloadComplete",
  "uploadReady",
  "uploadAck",
  "uploadComplete",
  "error",
])

export function parseFileServerMessage(raw: string): FileServerMessage | null {
  const value = parseJsonObject(raw)
  if (!value || typeof value.kind !== "string" || !fileKinds.has(value.kind)) return null
  const stringValue = (name: string) => typeof value[name] === "string"
  const numberValue = (name: string) => typeof value[name] === "number"
  switch (value.kind) {
    case "ready":
      if (!stringValue("sessionId") || !stringValue("clientId")) return null
      if (typeof value.reconnected !== "boolean" || typeof value.agentAttached !== "boolean") return null
      return value as FileServerMessage
    case "closed":
      if (!stringValue("reason")) return null
      return value as FileServerMessage
    case "rootsResult":
      if (!stringValue("id") || !Array.isArray(value.roots)) return null
      return value as FileServerMessage
    case "listResult":
      if (!stringValue("id") || !stringValue("path") || !Array.isArray(value.entries)) return null
      if (typeof value.truncated !== "boolean") return null
      return value as FileServerMessage
    case "deleteResult":
      if (!stringValue("id") || !stringValue("path")) return null
      return value as FileServerMessage
    case "downloadStart":
      if (!stringValue("id") || !stringValue("transferId") || !stringValue("name") || !stringValue("sha256") || !numberValue("size")) return null
      return value as FileServerMessage
    case "downloadChunk":
      if (!stringValue("id") || !stringValue("transferId") || !numberValue("offset") || !stringValue("data") || !stringValue("sha256")) return null
      return value as FileServerMessage
    case "downloadComplete":
      if (!stringValue("id") || !stringValue("transferId") || !numberValue("size")) return null
      return value as FileServerMessage
    case "uploadReady":
    case "uploadAck":
      if (!stringValue("id") || !stringValue("transferId") || !numberValue("receivedBytes")) return null
      return value as FileServerMessage
    case "uploadComplete":
      if (!stringValue("id") || !stringValue("transferId") || !stringValue("path") || !stringValue("sha256") || !numberValue("size")) return null
      return value as FileServerMessage
    case "error":
      if (!stringValue("code") || !stringValue("message")) return null
      return value as FileServerMessage
    default:
      return value as FileServerMessage
  }
}

/** 去掉常见 ANSI 转义序列，避免把颜色/光标控制符渲染进页面。 */
export function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-_]/g, "")
}

function truncateLine(line: string): string {
  return line.length > TERMINAL_MAX_LINE_CHARS ? line.slice(0, TERMINAL_MAX_LINE_CHARS) : line
}

/** 将一段远端输出并入行缓冲；返回已完成的行与尚未换行的尾行。 */
export function splitTerminalChunk(partial: string, chunk: string): { lines: string[]; partial: string } {
  const normalized = stripAnsi(chunk).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  if (normalized.length === 0) return { lines: [], partial }
  const segments = (partial + normalized).split("\n")
  const nextPartial = truncateLine(segments.pop() ?? "")
  return { lines: segments.map(truncateLine), partial: nextPartial }
}

export function formatTransferBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export function formatRemoteTime(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("zh-CN", { hour12: false }).replace(/\//g, "-")
}

export function joinWindowsPath(directory: string, name: string): string {
  if (!directory) return name
  return directory.endsWith("\\") ? `${directory}${name}` : `${directory}\\${name}`
}

export function parentWindowsPath(path: string): string {
  const trimmed = path.replace(/\\+$/, "")
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}\\`
  const index = trimmed.lastIndexOf("\\")
  if (index < 0) return path
  const parent = trimmed.slice(0, index)
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent
}

export type PathCrumb = { name: string; path: string }

/** 把 C:\Users\Administrator 拆成可点击的面包屑。 */
export function splitWindowsPath(path: string): PathCrumb[] {
  const normalized = path.replace(/\//g, "\\")
  const parts = normalized.split("\\").filter(Boolean)
  if (parts.length === 0) return []
  const crumbs: PathCrumb[] = [{ name: parts[0], path: `${parts[0]}\\` }]
  let current = `${parts[0]}\\`
  for (const part of parts.slice(1)) {
    current = current.endsWith("\\") ? `${current}${part}` : `${current}\\${part}`
    crumbs.push({ name: part, path: current })
  }
  return crumbs
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ""
  const block = 0x8000
  for (let index = 0; index < bytes.length; index += block) {
    binary += String.fromCharCode(...bytes.subarray(index, index + block))
  }
  return btoa(binary)
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export async function sha256Hex(data: Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function isValidSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value)
}
