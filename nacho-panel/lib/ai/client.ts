import type { AIConfig } from "./config-shared"
import type { AIChatAttachment } from "./chat-attachments"
import {
  emptyAIChatHistory,
  normalizePersistedChatHistory,
  toPersistedChatHistory,
  type PersistedChatHistory,
  type Session,
} from "./chat-history"
import type { AIChatEvent, AIChatStep, AIChatStepSource } from "./chat-events"

export type { AIChatEvent, AIChatStep, AIChatStepSource } from "./chat-events"

export type AIRuntimeState = "stopped" | "starting" | "ready" | "error"

export type AIStatus = {
  desktop: boolean
  available: boolean
  runtime: { state: AIRuntimeState; version?: string; error?: string }
  settings: { configured: boolean; hasKey: boolean }
}

export type AITestProviderResult = {
  ok: boolean
  latencyMs: number
  models?: number
  model?: string
  error?: { code: string; message: string }
}

export type AITestMcpResult = {
  id: string
  ok: boolean
  tools: number
  latencyMs: number
  error?: { code: string; message: string }
}

export type AITestResult = {
  provider: AITestProviderResult
  mcp: AITestMcpResult[]
  settings: AIConfig
}

export class AIRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = "AIRequestError"
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; message?: string; code?: string }

async function requestAI<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: init?.signal ?? AbortSignal.timeout(30_000),
    })
  } catch {
    throw new AIRequestError("连接面板 AI 服务失败", 0, "network")
  }
  const body = await response.json().catch(() => null) as Envelope<T> | null
  if (!response.ok || !body || !body.ok) {
    const message = body && !body.ok ? body.message || "AI 请求失败" : `AI 请求失败（HTTP ${response.status}）`
    throw new AIRequestError(message, response.status, body && !body.ok ? body.code : undefined)
  }
  return body.data
}

export function canSaveAIConfig(config: AIConfig): boolean {
  const validHttp = (value: string, allowSearch: boolean) => {
    try {
      const url = new URL(value)
      return (url.protocol === "http:" || url.protocol === "https:")
        && !url.username && !url.password && !url.hash
        && (allowSearch || !url.search)
    } catch {
      return false
    }
  }
  if (!validHttp(config.baseUrl, false)) return false
  if (config.mcpServers.length > 16) return false
  const ids = new Set<string>()
  for (const server of config.mcpServers) {
    if (!server.id || ids.has(server.id)) return false
    ids.add(server.id)
    if (!server.name.trim() || server.name.length > 64) return false
    if (!validHttp(server.url, true)) return false
  }
  return true
}

export function fetchAIStatus() {
  return requestAI<AIStatus>("/api/ai/status", { signal: AbortSignal.timeout(10_000) })
}

export function fetchAISettings() {
  return requestAI<AIConfig>("/api/ai/settings", { signal: AbortSignal.timeout(10_000) })
}

export async function fetchAIChatHistory(): Promise<PersistedChatHistory> {
  const data = await requestAI<unknown>("/api/ai/sessions", { signal: AbortSignal.timeout(10_000) })
  return normalizePersistedChatHistory(data) ?? emptyAIChatHistory()
}

export function saveAIChatHistory(sessions: Session[], activeId: string) {
  const history = toPersistedChatHistory(sessions, activeId)
  return requestAI<{ saved: boolean }>("/api/ai/sessions", {
    method: "PUT",
    body: JSON.stringify(history),
    signal: AbortSignal.timeout(20_000),
  })
}

function settingsPayload(config: AIConfig) {
  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    model: config.model,
    customModel: config.customModel,
    temperature: config.temperature,
    confirmDanger: config.confirmDanger,
    skills: config.skills,
    mcpServers: config.mcpServers.map((server) => ({
      id: server.id,
      name: server.name,
      url: server.url,
      status: server.status,
      tools: server.tools,
      ...(server.token ? { token: server.token } : {}),
      ...(server.lastCheckedAt ? { lastCheckedAt: server.lastCheckedAt } : {}),
    })),
    plugins: config.plugins,
  }
}

export function saveAISettings(config: AIConfig) {
  return requestAI<AIConfig>("/api/ai/settings", {
    method: "PUT",
    body: JSON.stringify(settingsPayload(config)),
    signal: AbortSignal.timeout(15_000),
  })
}

export function testAIConnection() {
  return requestAI<AITestResult>("/api/ai/test", {
    method: "POST",
    body: JSON.stringify({ target: "all" }),
    signal: AbortSignal.timeout(40_000),
  })
}

export type AIChatConnection = { baseUrl: string; key: string }

export type AIChatRequest = {
  uiSessionId: string
  turnId: string
  text: string
  attachments?: AIChatAttachment[]
  model: string
  mode: "agent" | "chat"
  /** 本轮开启深度思考；由服务端映射为模型 reasoning effort。 */
  deepThinking?: boolean
  connection: AIChatConnection
}

const AI_STREAM_STALL_MS = 45_000

export function createAIChatTurnId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `t-${crypto.randomUUID()}`
  }
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function streamAIChat(
  request: AIChatRequest,
  onEvent: (event: AIChatEvent) => void,
  signal?: AbortSignal,
) {
  const controller = new AbortController()
  let stalled = false
  let watchdog: ReturnType<typeof setTimeout> | null = null
  const armWatchdog = () => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      stalled = true
      controller.abort()
    }, AI_STREAM_STALL_MS)
  }
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener("abort", onAbort, { once: true })
  }
  const cleanup = () => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = null
    signal?.removeEventListener("abort", onAbort)
  }

  let response: Response
  try {
    armWatchdog()
    response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
  } catch {
    cleanup()
    if (stalled) throw new AIRequestError("AI 连接已中断", 0, "stream-stalled")
    if (signal?.aborted) return
    throw new AIRequestError("连接 AI 服务失败", 0, "network")
  }
  if (!response.ok) {
    cleanup()
    const body = await response.json().catch(() => null) as Envelope<never> | null
    throw new AIRequestError(
      body && !body.ok ? body.message || "AI 请求失败" : `AI 请求失败（HTTP ${response.status}）`,
      response.status,
      body && !body.ok ? body.code : undefined,
    )
  }
  const reader = response.body?.getReader()
  if (!reader) {
    cleanup()
    throw new AIRequestError("AI 服务未返回流", 0, "empty-stream")
  }
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    armWatchdog()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      armWatchdog()
      buffer += decoder.decode(value, { stream: true })
      let index
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (!line) continue
        try {
          onEvent(JSON.parse(line) as AIChatEvent)
        } catch {
          // 单行损坏不应中断整个流
        }
      }
    }
    if (buffer.trim()) {
      try {
        onEvent(JSON.parse(buffer.trim()) as AIChatEvent)
      } catch {
        // ignore trailing partial line
      }
    }
  } catch {
    if (stalled) throw new AIRequestError("AI 连接已中断", 0, "stream-stalled")
    if (signal?.aborted) return
    throw new AIRequestError("AI 连接已中断", 0, "stream-error")
  } finally {
    cleanup()
    await reader.cancel().catch(() => undefined)
  }
}

export function postAIApproval(input: {
  uiSessionId: string
  approvalId: string
  decision: "once" | "always" | "reject"
}) {
  return requestAI<{ resolved: boolean }>("/api/ai/approvals", {
    method: "POST",
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(10_000),
  })
}

export function abortAIChat(uiSessionId: string, turnId?: string) {
  return requestAI<{ aborted: boolean }>("/api/ai/abort", {
    method: "POST",
    body: JSON.stringify({ uiSessionId, ...(turnId ? { turnId } : {}) }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
}

export function restartAIEngine(uiSessionId: string) {
  return requestAI<{ restarted: boolean }>("/api/ai/restart", {
    method: "POST",
    body: JSON.stringify({ uiSessionId }),
    signal: AbortSignal.timeout(20_000),
  })
}

export function deleteAISession(uiSessionId: string) {
  return requestAI<{ deleted: boolean }>(`/api/ai/sessions?uiSessionId=${encodeURIComponent(uiSessionId)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
}
