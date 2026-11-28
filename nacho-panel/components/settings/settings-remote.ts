import type { EmailSettings, SettingsState } from "./settings-data"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 仅接受与本地默认值同类型的字段；缺失、类型不符或非有限数字时保留本地值。 */
function mergeSection<T extends Record<string, unknown>>(fallback: T, remote: unknown): T {
  if (!isRecord(remote)) return fallback
  const output: Record<string, unknown> = { ...fallback }
  for (const [key, fallbackValue] of Object.entries(fallback)) {
    const value = remote[key]
    if (typeof value !== typeof fallbackValue) continue
    // 设置中的数值字段均为非负；负数、NaN 与 Infinity 不进入面板状态。
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) continue
    output[key] = value
  }
  return output as T
}

/** 把服务端返回的完整设置合并到面板状态，兼容旧服务端或部分字段缺失。 */
export function applyRemoteSettings(remote: unknown, fallback: SettingsState): SettingsState {
  const fields = isRecord(remote) ? remote : {}
  const email = { ...mergeSection(fallback.email, fields.email), password: "" }
  // 即使旧服务端或部分响应仍回传密码，面板也不采用它。
  if (email.mode !== "smtp" && email.mode !== "gmail" && email.mode !== "outlook") {
    email.mode = "smtp"
  }
  if (email.encryption !== "none" && email.encryption !== "ssl" && email.encryption !== "tls") {
    email.encryption = fallback.email.encryption
  }
  return {
    general: mergeSection(fallback.general, fields.general),
    email,
    conditions: mergeSection(fallback.conditions, fields.conditions),
    security: mergeSection(fallback.security, fields.security),
  }
}

const commonEmailFields = ["mode", "enabled", "to"] as const
const smtpFields = ["host", "port", "encryption", "username", "from"] as const
const allEmailFields = [...commonEmailFields, ...smtpFields] as const

function changedEmailFields(current: EmailSettings, saved: EmailSettings) {
  return (current.mode === "smtp" ? allEmailFields : commonEmailFields).filter((key) => current[key] !== saved[key])
}

export function isEmailSettingsDirty(current: EmailSettings, saved: EmailSettings) {
  return changedEmailFields(current, saved).length > 0 || (current.mode === "smtp" && !!current.password)
}

/** OAuth 终态可能改变服务端告警开关；仅保留用户明确编辑过的字段。 */
export function syncSavedEmail(draft: EmailSettings, previous: EmailSettings, remote: EmailSettings): EmailSettings {
  const edited = allEmailFields.filter((key) => draft[key] !== previous[key])
  return { ...remote, ...Object.fromEntries(edited.map((key) => [key, draft[key]])), password: draft.password }
}

export function buildSettingsUpdate(current: SettingsState, saved: SettingsState, canWriteEmail: boolean): Omit<SettingsState, "email"> & { email?: Partial<EmailSettings> } {
  const { email, ...nonEmail } = current
  if (!canWriteEmail || !isEmailSettingsDirty(email, saved.email)) return nonEmail
  const patch: Partial<EmailSettings> = Object.fromEntries(changedEmailFields(email, saved.email).map((key) => [key, email[key]]))
  if (email.mode === "smtp" && email.password) patch.password = email.password
  return { ...nonEmail, email: patch }
}
