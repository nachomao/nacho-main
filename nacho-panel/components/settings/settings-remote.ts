import type { SettingsState } from "./settings-data"

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
  if (!isRecord(remote)) return fallback
  const email = mergeSection(fallback.email, remote.email)
  if (email.encryption !== "none" && email.encryption !== "ssl" && email.encryption !== "tls") {
    email.encryption = fallback.email.encryption
  }
  return {
    general: mergeSection(fallback.general, remote.general),
    email,
    conditions: mergeSection(fallback.conditions, remote.conditions),
    security: mergeSection(fallback.security, remote.security),
  }
}
