export const LOCAL_SETTINGS_VERSION = 1 as const

export const LOCAL_THEME_IDS = ["blue", "green", "cyan", "orange", "rose"] as const
export type LocalThemeId = (typeof LOCAL_THEME_IDS)[number]

export const LOCAL_AVATAR_IDS = ["heart", "lounge", "hood", "custom"] as const
export type LocalAvatarId = (typeof LOCAL_AVATAR_IDS)[number]

export const NOTIFICATION_EXPORT_FORMATS = ["json", "csv"] as const
export type NotificationExportFormat = (typeof NOTIFICATION_EXPORT_FORMATS)[number]

export const MAX_USER_NAME_LENGTH = 80
export const MAX_CUSTOM_AVATAR_LENGTH = 512_000
export const MAX_LOCAL_SETTINGS_REQUEST_LENGTH = 600_000

export type LocalProfileSettings = {
  userName: string
  avatarId: LocalAvatarId
  customAvatar: string | null
}

export type NotificationCenterSettings = {
  maxItems: number
  retentionDays: number
  autoPurge: boolean
  defaultSnoozeMinutes: number
  autoExport: boolean
  exportFormat: NotificationExportFormat
  showCriticalAsToast: boolean
}

export type LocalSettings = {
  version: typeof LOCAL_SETTINGS_VERSION
  legacyMigrationVersion: number
  profile: LocalProfileSettings
  theme: LocalThemeId
  onboardingCompleted: boolean
  notificationCenter: NotificationCenterSettings
}

export type LocalSettingsPatch = {
  profile?: Partial<LocalProfileSettings>
  theme?: LocalThemeId
  onboardingCompleted?: boolean
  notificationCenter?: Partial<NotificationCenterSettings>
}

export type LocalSettingsSnapshot = {
  settings: LocalSettings
  exists: boolean
  recovered: boolean
}

export function defaultLocalSettings(): LocalSettings {
  return {
    version: LOCAL_SETTINGS_VERSION,
    legacyMigrationVersion: 0,
    profile: {
      userName: "NachoNeko",
      avatarId: "heart",
      customAvatar: null,
    },
    theme: "blue",
    onboardingCompleted: false,
    notificationCenter: {
      maxItems: 500,
      retentionDays: 30,
      autoPurge: true,
      defaultSnoozeMinutes: 60,
      autoExport: false,
      exportFormat: "json",
      showCriticalAsToast: true,
    },
  }
}
