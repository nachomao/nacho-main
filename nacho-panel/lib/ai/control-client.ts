import { PANEL_VERSION } from "../panel-version"
import type { ChatConnection } from "./chat-sessions"

export class ControlError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = "ControlError"
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; message?: string; error?: string }

export type PanelCommand = {
  id: string
  clientId: string
  type: string
  payload: Record<string, unknown>
  status: "pending" | "sent" | "running" | "success" | "failed" | "canceled"
  result: string | null
  exitCode: number | null
  createdAt: number
  updatedAt: number
}

export function createControlClient(connection: ChatConnection) {
  const base = connection.baseUrl.replace(/\/+$/, "")

  async function request<T>(pathname: string, init?: RequestInit, timeoutMs = 8_000): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${base}/api/panel${pathname}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${connection.key}`,
          Accept: "application/json",
          "X-Nacho-Panel-Version": PANEL_VERSION,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
        signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new ControlError("连接控制服务端失败", 0)
    }
    const body = await response.json().catch(() => null) as Envelope<T> | null
    if (!response.ok || !body || !body.ok) {
      const message = body && !body.ok ? body.message || body.error || "控制服务端请求失败" : `控制服务端请求失败（HTTP ${response.status}）`
      throw new ControlError(message, response.status)
    }
    return body.data
  }

  return {
    listClients: () => request<Record<string, unknown>[]>("/clients"),
    getClient: (clientId: string) => request<Record<string, unknown>>(`/clients/${encodeURIComponent(clientId)}`),
    getOverview: () => request<Record<string, unknown>>("/overview"),
    getHealthStats: () => request<Record<string, unknown>>("/health/stats"),
    listCommands: (clientId?: string) =>
      request<PanelCommand[]>(clientId ? `/commands?clientId=${encodeURIComponent(clientId)}` : "/commands"),
    listTasks: () => request<Record<string, unknown>[]>("/tasks"),
    listPlugins: () => request<Record<string, unknown>[]>("/plugins"),
    dispatchCommand: (clientId: string, type: string, payload: Record<string, unknown>) =>
      request<PanelCommand>(`/clients/${encodeURIComponent(clientId)}/commands`, {
        method: "POST",
        body: JSON.stringify({ type, payload }),
      }, 20_000),
    async waitForCommand(clientId: string, commandId: string, timeoutMs: number) {
      const deadline = Date.now() + timeoutMs
      let last: PanelCommand | null = null
      while (Date.now() < deadline) {
        const commands = await request<PanelCommand[]>(`/commands?clientId=${encodeURIComponent(clientId)}`)
        last = commands.find((command) => command.id === commandId) ?? last
        if (last && ["success", "failed", "canceled"].includes(last.status)) {
          return { command: last, timedOut: false }
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
      return { command: last, timedOut: true }
    },
  }
}

export type ControlClient = ReturnType<typeof createControlClient>
