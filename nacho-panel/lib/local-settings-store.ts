import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  LOCAL_AVATAR_IDS,
  LOCAL_SETTINGS_VERSION,
  LOCAL_THEME_IDS,
  MAX_CUSTOM_AVATAR_LENGTH,
  MAX_USER_NAME_LENGTH,
  NOTIFICATION_EXPORT_FORMATS,
  defaultLocalSettings,
  type LocalAvatarId,
  type LocalProfileSettings,
  type LocalSettings,
  type LocalSettingsPatch,
  type LocalSettingsSnapshot,
  type LocalThemeId,
  type NotificationCenterSettings,
  type NotificationExportFormat,
} from "./local-settings-schema"

const TOP_LEVEL_PATCH_KEYS = new Set(["profile", "theme", "reduceMotion", "onboardingCompleted", "notificationCenter"])
const PROFILE_PATCH_KEYS = new Set(["userName", "avatarId", "customAvatar"])
const NOTIFICATION_CENTER_PATCH_KEYS = new Set(["maxItems", "retentionDays", "autoPurge", "defaultSnoozeMinutes", "autoExport", "exportFormat", "showCriticalAsToast"])
const STORED_KEYS = new Set(["version", "legacyMigrationVersion", "profile", "theme", "reduceMotion", "onboardingCompleted", "notificationCenter"])
const LEGACY_AVATAR_IDS = new Set(["cat", "ghost", "bird", "rabbit", "fish", "bot"])

export class LocalSettingsValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length > 0) {
    throw new LocalSettingsValidationError(`${label} 包含未知字段：${unknown.join(", ")}`)
  }
}

function validateUserName(value: unknown): string {
  if (typeof value !== "string") throw new LocalSettingsValidationError("用户名必须是字符串")
  const normalized = value.trim()
  if (!normalized) throw new LocalSettingsValidationError("用户名不能为空")
  if (normalized.length > MAX_USER_NAME_LENGTH) {
    throw new LocalSettingsValidationError(`用户名不能超过 ${MAX_USER_NAME_LENGTH} 个字符`)
  }
  return normalized
}

function validateAvatarId(value: unknown): LocalAvatarId {
  if (typeof value !== "string" || !LOCAL_AVATAR_IDS.includes(value as LocalAvatarId)) {
    throw new LocalSettingsValidationError("头像标识无效")
  }
  return value as LocalAvatarId
}

function validateStoredAvatarId(value: unknown): LocalAvatarId {
  if (typeof value === "string" && LEGACY_AVATAR_IDS.has(value)) return "heart"
  return validateAvatarId(value)
}

function validateCustomAvatar(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== "string") throw new LocalSettingsValidationError("自定义头像必须是 data URL 或 null")
  if (value.length > MAX_CUSTOM_AVATAR_LENGTH) {
    throw new LocalSettingsValidationError("自定义头像数据过大")
  }
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) {
    throw new LocalSettingsValidationError("自定义头像必须是 JPEG、PNG 或 WebP base64 data URL")
  }
  return value
}

function validateTheme(value: unknown): LocalThemeId {
  if (typeof value !== "string" || !LOCAL_THEME_IDS.includes(value as LocalThemeId)) {
    throw new LocalSettingsValidationError("主题标识无效")
  }
  return value as LocalThemeId
}

function validateNotificationCenter(value: unknown): NotificationCenterSettings {
  if (!isRecord(value)) throw new LocalSettingsValidationError("notificationCenter 必须是对象")
  assertOnlyKeys(value, NOTIFICATION_CENTER_PATCH_KEYS, "notificationCenter")
  
  const maxItems = value.maxItems
  if (typeof maxItems !== "number" || !Number.isInteger(maxItems) || maxItems < 100 || maxItems > 1000) {
    throw new LocalSettingsValidationError("maxItems 必须是 100-1000 之间的整数")
  }
  
  const retentionDays = value.retentionDays
  if (typeof retentionDays !== "number" || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) {
    throw new LocalSettingsValidationError("retentionDays 必须是 1-90 之间的整数")
  }
  const autoPurge = value.autoPurge
  if (typeof autoPurge !== "boolean") throw new LocalSettingsValidationError("autoPurge 必须是布尔值")
  const defaultSnoozeMinutes = value.defaultSnoozeMinutes
  if (typeof defaultSnoozeMinutes !== "number" || !Number.isInteger(defaultSnoozeMinutes) || defaultSnoozeMinutes < 1 || defaultSnoozeMinutes > 1440) throw new LocalSettingsValidationError("defaultSnoozeMinutes 必须是 1-1440 之间的整数")
  
  if (typeof value.autoExport !== "boolean") {
    throw new LocalSettingsValidationError("autoExport 必须是布尔值")
  }
  if (typeof value.showCriticalAsToast !== "boolean") throw new LocalSettingsValidationError("showCriticalAsToast 必须是布尔值")
  
  if (typeof value.exportFormat !== "string" || !NOTIFICATION_EXPORT_FORMATS.includes(value.exportFormat as NotificationExportFormat)) {
    throw new LocalSettingsValidationError("exportFormat 必须是 json 或 csv")
  }
  
  return {
    maxItems,
    retentionDays,
    autoPurge,
    defaultSnoozeMinutes,
    autoExport: value.autoExport,
    exportFormat: value.exportFormat as NotificationExportFormat,
    showCriticalAsToast: value.showCriticalAsToast,
  }
}

function validateProfile(value: unknown): LocalProfileSettings {
  if (!isRecord(value)) throw new LocalSettingsValidationError("profile 必须是对象")
  assertOnlyKeys(value, PROFILE_PATCH_KEYS, "profile")
  const profile = {
    userName: validateUserName(value.userName),
    avatarId: validateStoredAvatarId(value.avatarId),
    customAvatar: validateCustomAvatar(value.customAvatar),
  }
  if (profile.avatarId === "custom" && !profile.customAvatar) {
    throw new LocalSettingsValidationError("使用自定义头像时必须提供头像数据")
  }
  return profile
}

function validateStoredProfile(value: unknown): LocalProfileSettings {
  const defaults = defaultLocalSettings().profile
  if (!isRecord(value)) return defaults
  let userName = defaults.userName
  try {
    if (typeof value.userName === "string" && value.userName.trim()) {
      userName = validateUserName(value.userName)
    }
  } catch {}
  let avatarId = defaults.avatarId
  try {
    avatarId = validateStoredAvatarId(value.avatarId)
  } catch {}
  let customAvatar: string | null = null
  try {
    customAvatar = validateCustomAvatar(value.customAvatar)
  } catch {}
  if (avatarId === "custom" && !customAvatar) {
    avatarId = "heart"
  }
  return { userName, avatarId, customAvatar }
}

function validateStoredNotificationCenter(value: unknown): NotificationCenterSettings {
  const defaults = defaultLocalSettings().notificationCenter
  if (!isRecord(value)) return defaults
  const maxItems = typeof value.maxItems === "number" && Number.isInteger(value.maxItems) && value.maxItems >= 100 && value.maxItems <= 1000
    ? value.maxItems : defaults.maxItems
  const retentionDays = typeof value.retentionDays === "number" && Number.isInteger(value.retentionDays) && value.retentionDays >= 1 && value.retentionDays <= 90
    ? value.retentionDays : defaults.retentionDays
  const autoPurge = typeof value.autoPurge === "boolean" ? value.autoPurge : defaults.autoPurge
  const defaultSnoozeMinutes = typeof value.defaultSnoozeMinutes === "number" && Number.isInteger(value.defaultSnoozeMinutes) && value.defaultSnoozeMinutes >= 1 && value.defaultSnoozeMinutes <= 1440
    ? value.defaultSnoozeMinutes : defaults.defaultSnoozeMinutes
  const autoExport = typeof value.autoExport === "boolean" ? value.autoExport : defaults.autoExport
  const showCriticalAsToast = typeof value.showCriticalAsToast === "boolean" ? value.showCriticalAsToast : defaults.showCriticalAsToast
  const exportFormat = typeof value.exportFormat === "string" && NOTIFICATION_EXPORT_FORMATS.includes(value.exportFormat as NotificationExportFormat)
    ? value.exportFormat as NotificationExportFormat : defaults.exportFormat

  return {
    maxItems,
    retentionDays,
    autoPurge,
    defaultSnoozeMinutes,
    autoExport,
    exportFormat,
    showCriticalAsToast,
  }
}

export function validateStoredSettings(value: unknown): LocalSettings {
  if (!isRecord(value)) throw new LocalSettingsValidationError("本地设置必须是对象")
  // 保持前向兼容性：磁盘存储不强制白名单断言，容忍未来版本新增字段，避免版本回退或升级时误判为损坏
  if (value.version !== LOCAL_SETTINGS_VERSION) {
    throw new LocalSettingsValidationError("本地设置版本不受支持")
  }
  const legacyMigrationVersion = Number.isInteger(value.legacyMigrationVersion) && Number(value.legacyMigrationVersion) >= 0
    ? Number(value.legacyMigrationVersion)
    : 0
  const onboardingCompleted = typeof value.onboardingCompleted === "boolean"
    ? value.onboardingCompleted
    : false
  const theme = typeof value.theme === "string" && LOCAL_THEME_IDS.includes(value.theme as LocalThemeId)
    ? value.theme as LocalThemeId
    : "blue"
  const reduceMotion = typeof value.reduceMotion === "boolean" ? value.reduceMotion : false

  return {
    version: LOCAL_SETTINGS_VERSION,
    legacyMigrationVersion,
    profile: validateStoredProfile(value.profile),
    theme,
    reduceMotion,
    onboardingCompleted,
    notificationCenter: validateStoredNotificationCenter(value.notificationCenter),
  }
}

export function validateSettingsPatch(value: unknown): LocalSettingsPatch {
  if (!isRecord(value)) throw new LocalSettingsValidationError("请求体必须是对象")
  assertOnlyKeys(value, TOP_LEVEL_PATCH_KEYS, "请求体")
  const patch: LocalSettingsPatch = {}

  if (Object.hasOwn(value, "profile")) {
    if (!isRecord(value.profile)) throw new LocalSettingsValidationError("profile 必须是对象")
    assertOnlyKeys(value.profile, PROFILE_PATCH_KEYS, "profile")
    const profile: Partial<LocalProfileSettings> = {}
    if (Object.hasOwn(value.profile, "userName")) profile.userName = validateUserName(value.profile.userName)
    if (Object.hasOwn(value.profile, "avatarId")) profile.avatarId = validateAvatarId(value.profile.avatarId)
    if (Object.hasOwn(value.profile, "customAvatar")) {
      profile.customAvatar = validateCustomAvatar(value.profile.customAvatar)
    }
    patch.profile = profile
  }
  if (Object.hasOwn(value, "theme")) patch.theme = validateTheme(value.theme)
  if (Object.hasOwn(value, "reduceMotion")) {
    if (typeof value.reduceMotion !== "boolean") {
      throw new LocalSettingsValidationError("reduceMotion 必须是布尔值")
    }
    patch.reduceMotion = value.reduceMotion
  }
  if (Object.hasOwn(value, "onboardingCompleted")) {
    if (typeof value.onboardingCompleted !== "boolean") {
      throw new LocalSettingsValidationError("onboardingCompleted 必须是布尔值")
    }
    patch.onboardingCompleted = value.onboardingCompleted
  }
  if (Object.hasOwn(value, "notificationCenter")) {
    if (!isRecord(value.notificationCenter)) throw new LocalSettingsValidationError("notificationCenter 必须是对象")
    assertOnlyKeys(value.notificationCenter, NOTIFICATION_CENTER_PATCH_KEYS, "notificationCenter")
    const nc: Partial<NotificationCenterSettings> = {}
    if (Object.hasOwn(value.notificationCenter, "maxItems")) {
      const maxItems = value.notificationCenter.maxItems
      if (typeof maxItems !== "number" || !Number.isInteger(maxItems) || maxItems < 100 || maxItems > 1000) {
        throw new LocalSettingsValidationError("maxItems 必须是 100-1000 之间的整数")
      }
      nc.maxItems = maxItems
    }
    if (Object.hasOwn(value.notificationCenter, "retentionDays")) {
      const retentionDays = value.notificationCenter.retentionDays
      if (typeof retentionDays !== "number" || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) {
        throw new LocalSettingsValidationError("retentionDays 必须是 1-90 之间的整数")
      }
      nc.retentionDays = retentionDays
    }
    if (Object.hasOwn(value.notificationCenter, "autoPurge")) { if (typeof value.notificationCenter.autoPurge !== "boolean") throw new LocalSettingsValidationError("autoPurge 必须是布尔值"); nc.autoPurge = value.notificationCenter.autoPurge }
    if (Object.hasOwn(value.notificationCenter, "defaultSnoozeMinutes")) { const v=value.notificationCenter.defaultSnoozeMinutes; if (typeof v !== "number" || !Number.isInteger(v) || v<1 || v>1440) throw new LocalSettingsValidationError("defaultSnoozeMinutes 必须是 1-1440 之间的整数"); nc.defaultSnoozeMinutes=v }
    if (Object.hasOwn(value.notificationCenter, "autoExport")) {
      if (typeof value.notificationCenter.autoExport !== "boolean") {
        throw new LocalSettingsValidationError("autoExport 必须是布尔值")
      }
      nc.autoExport = value.notificationCenter.autoExport
    }
    if (Object.hasOwn(value.notificationCenter, "exportFormat")) {
      const exportFormat = value.notificationCenter.exportFormat
      if (typeof exportFormat !== "string" || !NOTIFICATION_EXPORT_FORMATS.includes(exportFormat as NotificationExportFormat)) {
        throw new LocalSettingsValidationError("exportFormat 必须是 json 或 csv")
      }
      nc.exportFormat = exportFormat as NotificationExportFormat
    }
    if (Object.hasOwn(value.notificationCenter, "showCriticalAsToast")) { if (typeof value.notificationCenter.showCriticalAsToast !== "boolean") throw new LocalSettingsValidationError("showCriticalAsToast 必须是布尔值"); nc.showCriticalAsToast = value.notificationCenter.showCriticalAsToast }
    patch.notificationCenter = nc
  }
  return patch
}

function mergeSettings(current: LocalSettings, patch: LocalSettingsPatch): LocalSettings {
  const hasUserPatch = Object.keys(patch).length > 0
  const merged: LocalSettings = {
    ...current,
    legacyMigrationVersion: hasUserPatch ? 1 : current.legacyMigrationVersion,
    ...(patch.theme ? { theme: patch.theme } : {}),
    ...(typeof patch.reduceMotion === "boolean" ? { reduceMotion: patch.reduceMotion } : {}),
    ...(typeof patch.onboardingCompleted === "boolean"
      ? { onboardingCompleted: patch.onboardingCompleted }
      : {}),
    profile: {
      ...current.profile,
      ...patch.profile,
    },
    notificationCenter: {
      ...current.notificationCenter,
      ...patch.notificationCenter,
    },
  }
  if (merged.profile.avatarId === "custom" && !merged.profile.customAvatar) {
    throw new LocalSettingsValidationError("使用自定义头像时必须提供头像数据")
  }
  return validateStoredSettings(merged)
}

export function getLocalSettingsPath() {
  if (process.env.NACHO_PANEL_SETTINGS_PATH) {
    return path.resolve(/*turbopackIgnore: true*/ process.env.NACHO_PANEL_SETTINGS_PATH)
  }
  const isDev = process.env.NODE_ENV !== "production"
  const localAppData = process.env.LOCALAPPDATA || path.join(/*turbopackIgnore: true*/ os.homedir(), "AppData", "Local")
  return path.join(localAppData, isDev ? "NachoPanel-dev" : "NachoPanel", "panel-settings.json")
}

async function pathExists(filePath: string) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function writeSettingsAtomic(settings: LocalSettings) {
  const filePath = getLocalSettingsPath()
  const directory = path.dirname(filePath)
  await mkdir(directory, { recursive: true })
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  await rename(temporaryPath, filePath)
}

export async function readLocalSettings(): Promise<LocalSettingsSnapshot> {
  const filePath = getLocalSettingsPath()
  if (!(await pathExists(filePath))) {
    return { settings: defaultLocalSettings(), exists: false, recovered: false }
  }

  try {
    const raw = await readFile(filePath, "utf8")
    return { settings: validateStoredSettings(JSON.parse(raw)), exists: true, recovered: false }
  } catch {
    const backupPath = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`
    await rename(filePath, backupPath).catch(() => undefined)
    const settings = defaultLocalSettings()
    await writeSettingsAtomic(settings)
    return { settings, exists: true, recovered: true }
  }
}

let writeQueue: Promise<unknown> = Promise.resolve()

function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation)
  writeQueue = result.catch(() => undefined)
  return result
}

export async function patchLocalSettings(value: unknown): Promise<LocalSettings> {
  const patch = validateSettingsPatch(value)
  return withWriteLock(async () => {
    const current = (await readLocalSettings()).settings
    const next = mergeSettings(current, patch)
    await writeSettingsAtomic(next)
    return next
  })
}

export async function resetLocalSettings(): Promise<LocalSettings> {
  return withWriteLock(async () => {
    const settings = { ...defaultLocalSettings(), legacyMigrationVersion: 1 }
    await writeSettingsAtomic(settings)
    return settings
  })
}
