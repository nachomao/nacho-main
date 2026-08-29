export type OpenUrlResult = {
  sessionId: number | null
  processStarted: boolean
  pid: number | null
  durationMs: number
  expired: boolean
  error: { code: string; message: string } | null
}

export type OpenUrlCommand = {
  id: string
  clientId: string
  type: "open-url"
  status: "pending" | "sent" | "running" | "success" | "failed" | "canceled"
  payload: { url: string; expiresAt: string }
  result: string | null
  exitCode: number | null
  createdAt: number
  updatedAt: number
}

export const terminalOpenUrlStatuses = ["success", "failed", "canceled"] as const

export function openUrlValidationError(value: string): string | null {
  if (value.length === 0) return "请输入网页地址"
  if (value.length > 2048) return "网页地址不得超过 2048 个字符"
  if (/[\u0000-\u001f\u007f]/.test(value)) return "网页地址包含控制字符"
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "仅支持绝对 HTTP/HTTPS 地址"
    if (!parsed.hostname) return "网页地址必须包含主机名"
    if (parsed.username || parsed.password) return "网页地址不得包含用户信息"
    return null
  } catch {
    return "请输入完整的绝对 HTTP/HTTPS 地址"
  }
}

export function isValidOpenUrl(value: string): boolean {
  return openUrlValidationError(value) === null
}

export function parseOpenUrlResult(raw: string | null): OpenUrlResult | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!isObject(value) || Object.keys(value).sort().join("|") !== "durationMs|error|expired|pid|processStarted|sessionId" ||
      !(value.sessionId === null || isPositiveInteger(value.sessionId)) ||
      typeof value.processStarted !== "boolean" || !(value.pid === null || isPositiveInteger(value.pid)) ||
      !isNonNegativeInteger(value.durationMs) || typeof value.expired !== "boolean" || !validError(value.error)) return null
    const success = value.processStarted && value.pid !== null && value.sessionId !== null && value.expired === false && value.error === null
    const failed = value.processStarted === false && value.pid === null && value.error !== null && value.expired === (value.error.code === "EXPIRED")
    if (!success && !failed) return null
    return value as OpenUrlResult
  } catch { return null }
}

export function latestOpenUrlBatch(commands: OpenUrlCommand[]): OpenUrlCommand[] {
  const sorted = commands.filter((command) => command.type === "open-url").sort((a, b) => b.createdAt - a.createdAt)
  const latest = sorted[0]
  if (!latest) return []
  return sorted.filter((command) => command.payload.expiresAt === latest.payload.expiresAt && command.payload.url === latest.payload.url)
}

export function openUrlConfirmation(url: string, targetNames: string[]): string {
  return `确认打开网页\n目标：${targetNames.join("、")}\n地址：${url}\n说明：成功仅代表已启动浏览器请求，不代表页面已完成加载。`
}

export function openUrlResultText(result: OpenUrlResult): string {
  return result.processStarted ? "已启动浏览器请求" : result.expired ? "请求已过期，未启动浏览器" : "浏览器启动请求失败"
}

function isPositiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value > 0 }
function isNonNegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0 }
function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value) }
function validError(value: unknown): value is { code: string; message: string } | null {
  return value === null || isObject(value) && Object.keys(value).sort().join("|") === "code|message" &&
    typeof value.code === "string" && /^[A-Z0-9_]{1,64}$/.test(value.code) &&
    typeof value.message === "string" && value.message.length >= 1 && value.message.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value.message)
}
