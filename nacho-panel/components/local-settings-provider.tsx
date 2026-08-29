"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  LOCAL_AVATAR_IDS,
  LOCAL_THEME_IDS,
  type LocalAvatarId,
  type LocalSettings,
  type LocalSettingsPatch,
  type LocalSettingsSnapshot,
  type LocalThemeId,
} from "@/lib/local-settings-schema"

const NAME_STORAGE_KEY = "nacho-user-name"
const AVATAR_STORAGE_KEY = "nacho-user-avatar"
const CUSTOM_AVATAR_STORAGE_KEY = "nacho-user-avatar-custom"
const THEME_STORAGE_KEY = "nacho-theme"
const AUTH_STORAGE_KEY = "nacho-auth"

const LEGACY_SHARED_KEYS = [NAME_STORAGE_KEY, AVATAR_STORAGE_KEY, CUSTOM_AVATAR_STORAGE_KEY, THEME_STORAGE_KEY]

type ApiEnvelope = {
  ok: boolean
  data?: LocalSettings
  meta?: { exists: boolean; recovered: boolean }
  message?: string
}

type LocalSettingsContextValue = {
  settings: LocalSettings
  hydrated: boolean
  update: (patch: LocalSettingsPatch) => Promise<void>
  reset: () => Promise<void>
  refresh: () => Promise<void>
}

const LocalSettingsContext = createContext<LocalSettingsContextValue | null>(null)

function mergeClientSettings(current: LocalSettings, patch: LocalSettingsPatch): LocalSettings {
  return {
    ...current,
    ...(patch.theme ? { theme: patch.theme } : {}),
    ...(typeof patch.onboardingCompleted === "boolean"
      ? { onboardingCompleted: patch.onboardingCompleted }
      : {}),
    profile: { ...current.profile, ...patch.profile },
  }
}

function readLegacyPatch(): { patch: LocalSettingsPatch; hasLegacyData: boolean } {
  const profile: LocalSettingsPatch["profile"] = {}
  const userName = localStorage.getItem(NAME_STORAGE_KEY)?.trim()
  if (userName) profile.userName = userName

  const avatarId = localStorage.getItem(AVATAR_STORAGE_KEY)
  if (avatarId && LOCAL_AVATAR_IDS.includes(avatarId as LocalAvatarId)) {
    profile.avatarId = avatarId as LocalAvatarId
  }

  const customAvatar = localStorage.getItem(CUSTOM_AVATAR_STORAGE_KEY)
  if (customAvatar) profile.customAvatar = customAvatar

  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)
  const theme = storedTheme && LOCAL_THEME_IDS.includes(storedTheme as LocalThemeId)
    ? (storedTheme as LocalThemeId)
    : undefined

  const onboardingCompleted = Boolean(localStorage.getItem(AUTH_STORAGE_KEY))
  const patch: LocalSettingsPatch = {
    ...(Object.keys(profile).length > 0 ? { profile } : {}),
    ...(theme ? { theme } : {}),
    ...(onboardingCompleted ? { onboardingCompleted: true } : {}),
  }
  return { patch, hasLegacyData: Object.keys(patch).length > 0 }
}

async function parseResponse(response: Response): Promise<ApiEnvelope> {
  const body = (await response.json().catch(() => null)) as ApiEnvelope | null
  if (!response.ok || !body?.ok || !body.data) {
    throw new Error(body?.message || `本地设置请求失败（HTTP ${response.status}）`)
  }
  return body
}

export function LocalSettingsProvider({
  initialSnapshot,
  children,
}: {
  initialSnapshot: LocalSettingsSnapshot
  children: ReactNode
}) {
  const [settings, setSettings] = useState(initialSnapshot.settings)
  const [hydrated, setHydrated] = useState(false)
  const writeQueue = useRef<Promise<void>>(Promise.resolve())
  const mutationRevision = useRef(0)

  const refresh = useCallback(async () => {
    const response = await fetch("/api/local-settings", { cache: "no-store" })
    const body = await parseResponse(response)
    setSettings(body.data!)
  }, [])

  const enqueueMutation = useCallback((revision: number, operation: () => Promise<LocalSettings>) => {
    const next = writeQueue.current.catch(() => undefined).then(async () => {
      try {
        const nextSettings = await operation()
        if (revision === mutationRevision.current) setSettings(nextSettings)
      } catch (error) {
        console.error(error)
        await refresh().catch(() => undefined)
      }
    })
    writeQueue.current = next
    return next
  }, [refresh])

  const update = useCallback(async (patch: LocalSettingsPatch) => {
    const revision = ++mutationRevision.current
    setSettings((current) => mergeClientSettings(current, patch))
    await enqueueMutation(revision, async () => {
      const response = await fetch("/api/local-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      return (await parseResponse(response)).data!
    })
  }, [enqueueMutation])

  const reset = useCallback(async () => {
    const revision = ++mutationRevision.current
    await enqueueMutation(revision, async () => {
      const response = await fetch("/api/local-settings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      return (await parseResponse(response)).data!
    })
  }, [enqueueMutation])

  useEffect(() => {
    let active = true
    const hydrate = async () => {
      if (initialSnapshot.settings.legacyMigrationVersion < 1 && !initialSnapshot.recovered) {
        try {
          const legacy = readLegacyPatch()
          if (legacy.hasLegacyData) {
            await update(legacy.patch)
            LEGACY_SHARED_KEYS.forEach((key) => localStorage.removeItem(key))
          }
        } catch {
          // The optimistic migrated values remain usable for this browser session.
        }
      }
      if (active) setHydrated(true)
    }
    void hydrate()
    return () => {
      active = false
    }
  }, [initialSnapshot.recovered, initialSnapshot.settings.legacyMigrationVersion, update])

  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === "visible") void refresh().catch(() => undefined)
    }
    window.addEventListener("focus", sync)
    document.addEventListener("visibilitychange", sync)
    return () => {
      window.removeEventListener("focus", sync)
      document.removeEventListener("visibilitychange", sync)
    }
  }, [refresh])

  const value = useMemo(
    () => ({ settings, hydrated, update, reset, refresh }),
    [settings, hydrated, update, reset, refresh],
  )

  return <LocalSettingsContext.Provider value={value}>{children}</LocalSettingsContext.Provider>
}

export function useLocalSettings() {
  const context = useContext(LocalSettingsContext)
  if (!context) throw new Error("useLocalSettings 必须在 LocalSettingsProvider 内使用")
  return context
}
