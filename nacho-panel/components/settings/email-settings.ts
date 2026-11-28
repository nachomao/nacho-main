import type { EmailSettings } from "./settings-data"

export type EmailProvider = Exclude<EmailSettings["mode"], "smtp">
export const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type ProviderStatus = {
  available: boolean
  state: "disconnected" | "connected" | "reauthorize"
  account: string | null
}

export type EmailAttempt = {
  id: string
  state: "pending" | "connected" | "canceled" | "failed" | "expired"
  message: string | null
}

export type EmailStatus = {
  configurable: boolean
  reason: string | null
  hasPassword: boolean
  providers: Record<EmailProvider, ProviderStatus>
  attempt: EmailAttempt | null
}

declare global {
  interface Window {
    nachoEmailOAuth?: { openBrowser(provider: EmailProvider, url: string): Promise<void> }
  }
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const nullableString = (value: unknown): value is string | null => value === null || typeof value === "string"

function isProviderStatus(value: unknown): value is ProviderStatus {
  return record(value) && typeof value.available === "boolean" && nullableString(value.account) &&
    (value.state === "disconnected" || value.state === "connected" || value.state === "reauthorize")
}

function isEmailAttempt(value: unknown): value is EmailAttempt {
  return record(value) && typeof value.id === "string" && nullableString(value.message) &&
    (value.state === "pending" || value.state === "connected" || value.state === "canceled" || value.state === "failed" || value.state === "expired")
}

export function readEmailStatus(value: unknown): EmailStatus | null {
  if (!record(value) || typeof value.configurable !== "boolean" || !nullableString(value.reason) || typeof value.hasPassword !== "boolean" ||
    !record(value.providers) || !isProviderStatus(value.providers.gmail) || !isProviderStatus(value.providers.outlook) ||
    (value.attempt !== null && !isEmailAttempt(value.attempt))) return null
  const pickProvider = ({ available, state, account }: ProviderStatus) => ({ available, state, account })
  const attempt = value.attempt
  return {
    configurable: value.configurable,
    reason: value.reason,
    hasPassword: value.hasPassword,
    providers: { gmail: pickProvider(value.providers.gmail), outlook: pickProvider(value.providers.outlook) },
    attempt: attempt ? { id: attempt.id, state: attempt.state, message: attempt.message } : null,
  }
}

export function isTrustedEmailService(value: string) {
  try {
    const url = new URL(value)
    if (url.username || url.password) return false
    if (url.protocol === "https:") return true
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname))
  } catch {
    return false
  }
}

// 与桌面主进程独立验证；浏览器直接使用明确的外链，不允许任意重定向地址。
export function getEmailAuthorizationUrl(provider: EmailProvider, value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("https://") || /[\s\\]/.test(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return null
    if (provider === "gmail" && url.hostname === "accounts.google.com" && url.pathname === "/o/oauth2/v2/auth") return url.href
    if (provider === "outlook" && url.hostname === "login.microsoftonline.com" && url.pathname === "/common/oauth2/v2.0/authorize") return url.href
  } catch {
    // 格式不正确的地址不进入浏览器。
  }
  return null
}

export function emailTestBlockReason(saved: EmailSettings, status: EmailStatus, dirty: boolean): string | null {
  if (!status.configurable) return status.reason || "当前连接不支持邮件通知。"
  if (dirty) return "请先保存邮件设置，再发送测试邮件。"
  if (!EMAIL_ADDRESS.test(saved.to.trim())) return "请先配置并保存收件人邮箱。"
  if (saved.mode === "smtp") {
    if (saved.encryption === "none") return "请将旧配置迁移至 TLS 或 STARTTLS 加密。"
    if (!saved.host.trim() || !saved.username.trim() || !EMAIL_ADDRESS.test(saved.from.trim())) return "请完成 SMTP 主机、用户名和发件人配置。"
    if (!status.hasPassword) return "请填写并保存 SMTP 密码或邮箱授权码。"
    return null
  }
  const provider = status.providers[saved.mode]
  if (!provider.available) return "请先在服务端配置此邮箱提供商。"
  if (provider.state !== "connected") return "请先完成邮箱账号授权。"
  return null
}
