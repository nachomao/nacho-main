export type MessageSeverity = "info" | "warning" | "error"
export type MessageDeliveryStatus = "confirmed" | "canceled" | "timed-out" | "expired" | "failed"
export type MessagePushResult = { sessionId: number | null; deliveryStatus: MessageDeliveryStatus; responseCode: number | null; timedOut: boolean; durationMs: number; error: { code: string; message: string } | null }
export type MessageCommand = {
  id: string; clientId: string; type: "show-message"; status: "pending" | "sent" | "running" | "success" | "failed" | "canceled"
  payload: { title: string; message: string; severity: MessageSeverity; timeoutSeconds: number; expiresAt: string }
  result: string | null; exitCode: number | null; createdAt: number; updatedAt: number
}
export const terminalMessageStatuses = ["success", "failed", "canceled"] as const

export function unicodeScalarCount(value: string): number { return [...value].length }
export function validMessageText(value: string, maximum: number, multiline: boolean): boolean {
  if (unicodeScalarCount(value) < 1 || unicodeScalarCount(value) > maximum || hasUnpairedSurrogate(value)) return false
  return ![...value].some((character) => { const code = character.codePointAt(0) ?? 0; return code === 0 || code === 127 || code < 32 && !(multiline && ["\r", "\n", "\t"].includes(character)) })
}
export function validMessageTimeout(value: number): boolean { return Number.isInteger(value) && value >= 5 && value <= 300 }

export function parseMessagePushResult(raw: string | null): MessagePushResult | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!isObject(value) || Object.keys(value).sort().join("|") !== "deliveryStatus|durationMs|error|responseCode|sessionId|timedOut" ||
      !["confirmed", "canceled", "timed-out", "expired", "failed"].includes(String(value.deliveryStatus)) ||
      !(value.sessionId === null || typeof value.sessionId === "number" && Number.isInteger(value.sessionId) && value.sessionId > 0) ||
      !(value.responseCode === null || typeof value.responseCode === "number" && Number.isInteger(value.responseCode) && value.responseCode >= 0) ||
      typeof value.timedOut !== "boolean" || typeof value.durationMs !== "number" || !Number.isInteger(value.durationMs) || value.durationMs < 0 || !validError(value.error)) return null
    if (value.timedOut !== (value.deliveryStatus === "timed-out")) return null
    return value as MessagePushResult
  } catch { return null }
}

export function latestMessageBatch(commands: MessageCommand[]): MessageCommand[] {
  const terminalOrActive = commands.filter((command) => command.type === "show-message").sort((a, b) => b.createdAt - a.createdAt)
  const latest = terminalOrActive[0]; if (!latest) return []
  return terminalOrActive.filter((command) => command.payload.expiresAt === latest.payload.expiresAt && command.payload.title === latest.payload.title && command.payload.message === latest.payload.message && command.payload.severity === latest.payload.severity && command.payload.timeoutSeconds === latest.payload.timeoutSeconds)
}

export function messageConfirmation(title: string, message: string, severity: MessageSeverity, timeout: number, targetNames: string[]): string {
  const summary = message.length > 80 ? message.slice(0, 80) + "…" : message
  return `确认推送消息\n目标：${targetNames.join("、")}\n级别：${severity}\n超时：${timeout} 秒\n标题：${title}\n内容摘要：${summary}`
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) { const code = value.charCodeAt(i); if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return true } else if (code >= 0xdc00 && code <= 0xdfff) return true }
  return false
}
function validError(value: unknown): boolean { return value === null || isObject(value) && Object.keys(value).sort().join("|") === "code|message" && typeof value.code === "string" && /^[A-Z0-9_]{1,64}$/.test(value.code) && typeof value.message === "string" && value.message.length > 0 && value.message.length <= 512 }
function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value) }
