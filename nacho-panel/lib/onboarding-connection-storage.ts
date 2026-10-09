export type StoredServerSource =
  | { mode: "local"; api: string; agentApi?: string; key: string }
  | { mode: "cloud"; api: string; key: string }
  | null

export type StoredAuthMethod = { mode: "key" | "password"; secret: string } | null

export interface OnboardingSnapshot {
  serverSource: StoredServerSource
  auth: StoredAuthMethod
  locked: boolean
}

export interface ConnectionStorageBridge {
  get(): Promise<{ snapshot: OnboardingSnapshot; persisted: boolean }>
  set(snapshot: OnboardingSnapshot): Promise<{ snapshot: OnboardingSnapshot; persisted: boolean }>
  clear(): Promise<{ snapshot: OnboardingSnapshot; persisted: boolean }>
}

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const ONBOARDING_STORAGE_KEYS = {
  auth: "nacho-auth",
  locked: "nacho-locked",
  serverSource: "nacho-server-source",
} as const

export const EMPTY_ONBOARDING_SNAPSHOT: OnboardingSnapshot = {
  serverSource: null,
  auth: null,
  locked: false,
}

declare global {
  interface Window {
    nachoConnection?: ConnectionStorageBridge
  }
}

function parseServerSource(raw: string | null): {
  source: StoredServerSource
  legacyLocalSource: boolean
} {
  if (!raw) return { source: null, legacyLocalSource: false }
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null
    if (value?.mode === "local") {
      if (typeof value.api === "string" && value.api && typeof value.key === "string" && value.key) {
        return {
          source: {
            mode: "local",
            api: value.api,
            agentApi: typeof value.agentApi === "string" && value.agentApi ? value.agentApi : undefined,
            key: value.key,
          },
          legacyLocalSource: false,
        }
      }
      return { source: null, legacyLocalSource: true }
    }
    if (value?.mode === "cloud"
      && typeof value.api === "string" && value.api
      && typeof value.key === "string" && value.key) {
      return { source: { mode: "cloud", api: value.api, key: value.key }, legacyLocalSource: false }
    }
  } catch {
    // 畸形旧值不进入运行态连接。
  }
  return { source: null, legacyLocalSource: false }
}

function parseAuth(raw: string | null): StoredAuthMethod {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null
    if ((value?.mode === "key" || value?.mode === "password")
      && typeof value.secret === "string" && value.secret) {
      return { mode: value.mode, secret: value.secret }
    }
  } catch {
    // 畸形旧值不进入运行态登录态。
  }
  return null
}

function readLegacySnapshot(storage: KeyValueStorage) {
  const sourceRaw = storage.getItem(ONBOARDING_STORAGE_KEYS.serverSource)
  const authRaw = storage.getItem(ONBOARDING_STORAGE_KEYS.auth)
  const lockedRaw = storage.getItem(ONBOARDING_STORAGE_KEYS.locked)
  const parsedSource = parseServerSource(sourceRaw)
  return {
    snapshot: {
      serverSource: parsedSource.source,
      auth: parseAuth(authRaw),
      locked: lockedRaw === "1",
    } satisfies OnboardingSnapshot,
    hasLegacyData: sourceRaw !== null || authRaw !== null || lockedRaw !== null,
    legacyLocalSource: parsedSource.legacyLocalSource,
  }
}

function removeLegacySnapshot(storage: KeyValueStorage) {
  Object.values(ONBOARDING_STORAGE_KEYS).forEach((key) => storage.removeItem(key))
}

/**
 * 桌面端只在无加密记录时读取当前 origin 的旧 localStorage，并在加密写入成功后删除旧键。
 * 浏览器开发版继续从 localStorage 恢复；加密记录读取失败时由调用方处理，不回退明文。
 */
export async function restoreOnboardingSnapshot(
  bridge: ConnectionStorageBridge | undefined,
  storage: KeyValueStorage,
) {
  if (!bridge) {
    return readLegacySnapshot(storage)
  }

  const saved = await bridge.get()
  if (saved.persisted) {
    removeLegacySnapshot(storage)
    return {
      snapshot: saved.snapshot,
      hasLegacyData: false,
      legacyLocalSource: false,
    }
  }

  const legacy = readLegacySnapshot(storage)
  if (legacy.hasLegacyData) {
    await bridge.set(legacy.snapshot)
    removeLegacySnapshot(storage)
  }
  return legacy
}

export async function persistOnboardingSnapshot(
  bridge: ConnectionStorageBridge | undefined,
  storage: KeyValueStorage,
  snapshot: OnboardingSnapshot,
) {
  if (bridge) {
    await bridge.set(snapshot)
    return
  }
  if (snapshot.serverSource) {
    storage.setItem(ONBOARDING_STORAGE_KEYS.serverSource, JSON.stringify(snapshot.serverSource))
  } else {
    storage.removeItem(ONBOARDING_STORAGE_KEYS.serverSource)
  }
  if (snapshot.auth) {
    storage.setItem(ONBOARDING_STORAGE_KEYS.auth, JSON.stringify(snapshot.auth))
  } else {
    storage.removeItem(ONBOARDING_STORAGE_KEYS.auth)
  }
  if (snapshot.locked) {
    storage.setItem(ONBOARDING_STORAGE_KEYS.locked, "1")
  } else {
    storage.removeItem(ONBOARDING_STORAGE_KEYS.locked)
  }
}

export async function clearOnboardingSnapshot(
  bridge: ConnectionStorageBridge | undefined,
  storage: KeyValueStorage,
) {
  if (bridge) {
    await bridge.clear()
    removeLegacySnapshot(storage)
    return
  }
  removeLegacySnapshot(storage)
}
