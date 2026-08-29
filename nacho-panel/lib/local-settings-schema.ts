export const LOCAL_SETTINGS_VERSION = 1 as const

export const LOCAL_THEME_IDS = ["blue", "green", "cyan", "orange", "rose"] as const
export type LocalThemeId = (typeof LOCAL_THEME_IDS)[number]

export const LOCAL_AVATAR_IDS = ["cat", "ghost", "bird", "rabbit", "fish", "bot", "custom"] as const
export type LocalAvatarId = (typeof LOCAL_AVATAR_IDS)[number]

export const MAX_USER_NAME_LENGTH = 80
export const MAX_CUSTOM_AVATAR_LENGTH = 512_000
export const MAX_LOCAL_SETTINGS_REQUEST_LENGTH = 600_000

export type LocalProfileSettings = {
  userName: string
  avatarId: LocalAvatarId
  customAvatar: string | null
}

export type LocalSettings = {
  version: typeof LOCAL_SETTINGS_VERSION
  legacyMigrationVersion: number
  profile: LocalProfileSettings
  theme: LocalThemeId
  onboardingCompleted: boolean
}

export type LocalSettingsPatch = {
  profile?: Partial<LocalProfileSettings>
  theme?: LocalThemeId
  onboardingCompleted?: boolean
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
      avatarId: "cat",
      customAvatar: null,
    },
    theme: "blue",
    onboardingCompleted: false,
  }
}
