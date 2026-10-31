import type { RuntimeHandle } from "./runtime"

export type OpenCodePermissionRule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

export type OpenCodeSession = {
  id: string
  title?: string
  [key: string]: unknown
}

export type OpenCodePromptPart =
  | { type: "text"; text: string }
  | { type: "file"; mime: string; url: string; filename?: string }

export type OpenCodePromptBody = {
  parts: OpenCodePromptPart[]
  model?: { providerID: string; modelID: string }
  agent?: string
  tools?: Record<string, boolean>
  system?: string
  /** 模型变体；high 会映射为 openai-compatible 的 reasoning_effort=high。 */
  variant?: string
}

export class OpenCodeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = "OpenCodeError"
  }
}

export function createOpencodeClient(runtime: RuntimeHandle) {
  const authorization = `Basic ${Buffer.from(`${runtime.username}:${runtime.password}`, "utf8").toString("base64")}`

  async function request<T>(pathname: string, init?: RequestInit, timeoutMs = 15_000): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${runtime.url}${pathname}`, {
        ...init,
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
        signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new OpenCodeError("AI 引擎连接失败", 0)
    }
    if (response.status === 204) return null as T
    const text = await response.text().catch(() => "")
    if (!response.ok) {
      let message = text.slice(0, 500)
      try {
        const body = JSON.parse(text) as { message?: string; error?: { message?: string } | string }
        message = typeof body.error === "string" ? body.error : body.error?.message || body.message || message
      } catch {
        // keep raw text
      }
      throw new OpenCodeError(message || `AI 引擎请求失败（HTTP ${response.status}）`, response.status)
    }
    if (!text) return null as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new OpenCodeError("AI 引擎返回了无效 JSON", response.status)
    }
  }

  return {
    health: () => request<{ healthy?: boolean; version?: string }>("/global/health", undefined, 5_000),
    createSession: (input: { title: string; permission: OpenCodePermissionRule[] }) =>
      request<OpenCodeSession>("/session", { method: "POST", body: JSON.stringify(input) }),
    getSessionStatus: () =>
      request<Record<string, { type?: string }>>("/session/status", undefined, 2_000),
    getSession: (sessionId: string) => request<OpenCodeSession>(`/session/${encodeURIComponent(sessionId)}`),
    deleteSession: (sessionId: string) =>
      request<boolean>(`/session/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
    updateSession: (sessionId: string, input: { permission?: OpenCodePermissionRule[]; title?: string }) =>
      request<OpenCodeSession>(`/session/${encodeURIComponent(sessionId)}`, { method: "PATCH", body: JSON.stringify(input) }),
    promptAsync: (sessionId: string, body: OpenCodePromptBody) =>
      request<null>(`/session/${encodeURIComponent(sessionId)}/prompt_async`, {
        method: "POST",
        body: JSON.stringify(body),
      }, 30_000),
    abortSession: (sessionId: string) =>
      request<boolean>(`/session/${encodeURIComponent(sessionId)}/abort`, { method: "POST" }, 10_000),
    replyPermission: (sessionId: string, permissionId: string, response: "once" | "always" | "reject") =>
      request<boolean>(`/session/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(permissionId)}`, {
        method: "POST",
        body: JSON.stringify({ response }),
      }, 10_000),
    eventResponse: (signal: AbortSignal) => fetch(`${runtime.url}/event`, {
      headers: { Authorization: authorization, Accept: "text/event-stream" },
      signal,
    }),
  }
}

export type OpencodeClient = ReturnType<typeof createOpencodeClient>
