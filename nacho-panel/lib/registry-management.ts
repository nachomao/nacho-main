export type RegistryAction = "list" | "get" | "set" | "delete"
export type RegistryHive = "HKLM" | "HKU"
export type RegistryView = "registry64" | "registry32"
export type RegistryValueKind = "string" | "expandString" | "dword" | "qword" | "multiString" | "binary"
export type RegistryData = string | number | string[]
export type RegistryValue = { valueName: string; valueKind: RegistryValueKind; value: RegistryData; sizeBytes: number }
export type RegistryError = { code: string; message: string }
export type RegistryPayload = {
  action: RegistryAction
  hive: RegistryHive
  view: RegistryView
  subKey: string
  valueName: string | null
  valueKind: RegistryValueKind | null
  value: RegistryData | null
}
export type RegistryResult = {
  action: RegistryAction
  hive: RegistryHive
  view: RegistryView
  subKey: string
  changed: boolean
  values: RegistryValue[] | null
  previous: RegistryValue | null
  current: RegistryValue | null
  error: RegistryError | null
}
export type RegistryCommand = {
  id: string
  clientId: string
  type: "manage-registry"
  payload: RegistryPayload
  status: "pending" | "sent" | "running" | "success" | "failed" | "canceled"
  result: string | null
  exitCode: number | null
  createdAt: number
  updatedAt: number
}

export const registryValueKinds: RegistryValueKind[] = ["string", "expandString", "dword", "qword", "multiString", "binary"]
export const terminalRegistryStatuses = ["success", "failed", "canceled"] as const

export function isValidRegistrySubKey(value: string): boolean {
  return value.length >= 1 && value.length <= 2048 && value === value.trim() && !value.startsWith("\\") && !value.endsWith("\\") &&
    !value.includes("\\\\") && !/[\0-\x1f\x7f]/.test(value) && !value.split("\\").some((part) => part === "" || part === "." || part === "..")
}

export function isValidRegistryValueName(value: string): boolean {
  return value.length <= 255 && !/[\0-\x1f\x7f]/.test(value)
}

export function registryBinaryDecodedBytes(value: string): number | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null
  return (value.length / 4) * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0)
}

export function parseRegistryEditorValue(kind: RegistryValueKind, text: string): RegistryData {
  let value: RegistryData
  if (kind === "string" || kind === "expandString") {
    if (/[\0-\x1f\x7f]/.test(text)) throw new Error("字符串包含控制字符")
    value = text
  } else if (kind === "dword") {
    if (!/^\d+$/.test(text)) throw new Error("DWORD 必须是十进制整数")
    const parsed = Number(text)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 4_294_967_295) throw new Error("DWORD 超出 0..4294967295")
    value = parsed
  } else if (kind === "qword") {
    if (!/^\d+$/.test(text)) throw new Error("QWORD 必须是十进制整数")
    const parsed = BigInt(text)
    if (parsed > BigInt("9223372036854775807")) throw new Error("QWORD 超出有符号 64 位范围")
    value = parsed.toString()
  } else if (kind === "multiString") {
    const items = text === "" ? [] : text.split(/\r?\n/)
    if (items.some((item) => /[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(item))) throw new Error("多字符串包含控制字符")
    value = items
  } else {
    const normalized = text.trim()
    const decoded = registryBinaryDecodedBytes(normalized)
    if (decoded === null) throw new Error("Binary 必须是规范 Base64")
    value = normalized
  }
  if (serializedRegistryValueBytes(value) > 65_536) throw new Error("单值序列化超过 64 KiB")
  return value
}

export function serializedRegistryValueBytes(value: RegistryData): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

export function registryPayload(
  action: RegistryAction,
  hive: RegistryHive,
  view: RegistryView,
  subKey: string,
  valueName: string | null = null,
  valueKind: RegistryValueKind | null = null,
  value: RegistryData | null = null,
): RegistryPayload {
  if (!isValidRegistrySubKey(subKey)) throw new Error("注册表子路径格式无效")
  if (action === "list") return { action, hive, view, subKey, valueName: null, valueKind: null, value: null }
  if (valueName === null || !isValidRegistryValueName(valueName)) throw new Error("注册表值名称格式无效")
  if (action === "get" || action === "delete") return { action, hive, view, subKey, valueName, valueKind: null, value: null }
  if (!valueKind || value === null) throw new Error("set 需要值类型和数据")
  validateRegistryValue({ valueName, valueKind, value, sizeBytes: registryValueSize(valueKind, value) })
  return { action, hive, view, subKey, valueName, valueKind, value }
}

export function parseRegistryResult(raw: string | null): RegistryResult | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!isObject(value) || Object.keys(value).sort().join("|") !== "action|changed|current|error|hive|previous|subKey|values|view" ||
      !["list", "get", "set", "delete"].includes(String(value.action)) || !["HKLM", "HKU"].includes(String(value.hive)) ||
      !["registry64", "registry32"].includes(String(value.view)) || typeof value.subKey !== "string" || !isValidRegistrySubKey(value.subKey) ||
      typeof value.changed !== "boolean" || !isRegistryError(value.error)) return null
    const action = value.action as RegistryAction
    const values = value.values === null ? null : Array.isArray(value.values) ? value.values.map(parseRegistryValue) : null
    if (Array.isArray(value.values) && values?.some((item) => item === null)) return null
    const previous = value.previous === null ? null : parseRegistryValue(value.previous)
    const current = value.current === null ? null : parseRegistryValue(value.current)
    if (value.previous !== null && !previous || value.current !== null && !current) return null
    if (action === "list" && (!Array.isArray(value.values) || previous !== null || current !== null || value.changed !== false)) return null
    if (action === "get" && (value.values !== null || previous !== null || value.changed !== false)) return null
    if ((action === "set" || action === "delete") && value.values !== null) return null
    return { action, hive: value.hive as RegistryHive, view: value.view as RegistryView, subKey: value.subKey, changed: value.changed, values: values as RegistryValue[] | null, previous, current, error: value.error as RegistryError | null }
  } catch {
    return null
  }
}

export function inverseRegistryPayload(result: RegistryResult): RegistryPayload | null {
  if ((result.action !== "set" && result.action !== "delete") || result.error || !result.changed) return null
  if (result.previous) return registryPayload("set", result.hive, result.view, result.subKey, result.previous.valueName, result.previous.valueKind, result.previous.value)
  if (result.action === "set" && result.current) return registryPayload("delete", result.hive, result.view, result.subKey, result.current.valueName)
  return null
}

export function latestRegistryCommand(commands: RegistryCommand[]): RegistryCommand | null {
  return [...commands].filter((command) => command.type === "manage-registry" && terminalRegistryStatuses.includes(command.status as (typeof terminalRegistryStatuses)[number])).sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
}

export function registryValuePreview(value: RegistryValue | null): string {
  if (!value) return "（不存在）"
  if (value.valueKind === "binary") return `Base64 · ${value.sizeBytes} 字节`
  if (value.valueKind === "multiString") return (value.value as string[]).join(" | ") || "（空数组）"
  return String(value.value)
}

function parseRegistryValue(value: unknown): RegistryValue | null {
  if (!isObject(value) || Object.keys(value).sort().join("|") !== "sizeBytes|value|valueKind|valueName" || typeof value.valueName !== "string" ||
    !isValidRegistryValueName(value.valueName) || !registryValueKinds.includes(value.valueKind as RegistryValueKind) ||
    typeof value.sizeBytes !== "number" || !Number.isInteger(value.sizeBytes) || value.sizeBytes < 0 || value.sizeBytes > 65_536) return null
  const parsed = { valueName: value.valueName, valueKind: value.valueKind as RegistryValueKind, value: value.value as RegistryData, sizeBytes: value.sizeBytes }
  try { validateRegistryValue(parsed); return parsed } catch { return null }
}

function validateRegistryValue(value: RegistryValue): void {
  if (value.valueKind === "dword" && (typeof value.value !== "number" || !Number.isInteger(value.value) || value.value < 0 || value.value > 4_294_967_295 || value.sizeBytes !== 4)) throw new Error("invalid dword")
  if (value.valueKind === "qword" && (typeof value.value !== "string" || !/^\d+$/.test(value.value) || BigInt(value.value) > BigInt("9223372036854775807") || value.sizeBytes !== 8)) throw new Error("invalid qword")
  if ((value.valueKind === "string" || value.valueKind === "expandString") && (typeof value.value !== "string" || /[\0-\x1f\x7f]/.test(value.value))) throw new Error("invalid string")
  if (value.valueKind === "multiString" && (!Array.isArray(value.value) || value.value.some((item) => typeof item !== "string" || /[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(item)))) throw new Error("invalid multiString")
  if (value.valueKind === "binary" && (typeof value.value !== "string" || registryBinaryDecodedBytes(value.value) === null)) throw new Error("invalid binary")
  if (serializedRegistryValueBytes(value.value) > 65_536) throw new Error("value too large")
}

function registryValueSize(kind: RegistryValueKind, value: RegistryData): number {
  if (kind === "dword") return 4
  if (kind === "qword") return 8
  if (kind === "binary") return registryBinaryDecodedBytes(value as string) ?? 0
  return serializedRegistryValueBytes(value)
}

function isRegistryError(value: unknown): value is RegistryError | null {
  return value === null || isObject(value) && Object.keys(value).sort().join("|") === "code|message" && typeof value.code === "string" && /^[A-Z0-9_]{1,64}$/.test(value.code) && typeof value.message === "string" && value.message.length > 0 && value.message.length <= 512
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

