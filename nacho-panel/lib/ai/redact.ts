const API_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/g
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi
const USERINFO_PATTERN = /(https?:\/\/)[^@\s/]+@/gi
const JSON_SECRET_PATTERN = /("(?:apiKey|api_key|token|access_token|secret|password)"\s*:\s*")[^"]*(")/gi

export function redactSecrets(text: string, secrets: string[] = []): string {
  let result = text
  for (const secret of secrets) {
    if (secret.length < 4) continue
    result = result.split(secret).join("[REDACTED]")
  }
  return result
    .replace(API_KEY_PATTERN, "sk-[REDACTED]")
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(USERINFO_PATTERN, "$1[REDACTED]@")
    .replace(JSON_SECRET_PATTERN, "$1[REDACTED]$2")
}

export function truncateMiddle(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const total = Buffer.byteLength(text, "utf8")
  if (total <= maxBytes) return { text, truncated: false }
  const headBytes = Math.max(0, Math.floor(maxBytes * 0.6))
  const tailBytes = Math.max(0, Math.floor(maxBytes * 0.3))
  const buffer = Buffer.from(text, "utf8")
  const head = buffer.subarray(0, headBytes).toString("utf8").replace(/\uFFFD+$/g, "")
  const tail = buffer.subarray(Math.max(headBytes, buffer.length - tailBytes)).toString("utf8").replace(/^\uFFFD+/g, "")
  return { text: `${head}\n…（已截断 ${total - headBytes - tailBytes} 字节）…\n${tail}`, truncated: true }
}

export function sanitizeErrorMessage(error: unknown, secrets: string[] = [], maximum = 500): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "未知错误"
  return redactSecrets(message, secrets).slice(0, maximum)
}
