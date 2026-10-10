"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useLocalSettings } from "@/components/local-settings-provider"
import { useLocalControlServer } from "@/lib/local-control-server-client"
import type { LocalAvatarId } from "@/lib/local-settings-schema"
import {
  clearOnboardingSnapshot,
  ConnectionRestoreError,
  EMPTY_ONBOARDING_SNAPSHOT,
  persistOnboardingSnapshot,
  restoreOnboardingSnapshot,
  restoredOnboardingPhase,
  type ConnectionStorageFailure,
  type OnboardingPhase,
  type OnboardingSnapshot,
} from "@/lib/onboarding-connection-storage"

/** 服务端来源：本地部署或云端服务；云端自动部署和云端对接共用 API + Key 连接协议 */
export type ServerSource = OnboardingSnapshot["serverSource"]

/** 登录方式：生成的登录密钥 或 用户设置的密码（二选一） */
export type AuthMethod = OnboardingSnapshot["auth"]

/**
 * 引导流程阶段：
 * - intro     引导覆盖层展示中（品牌动画 / 用户名 / 服务端 / 登录方式注册）
 * - locked    已退出登录，显示锁屏（仅需输入密钥或密码解锁，不走完整流程）
 * - unlocking 覆盖层正在渐隐离场，主页同步浮现
 * - done      引导完成，覆盖层已卸载
 */
interface OnboardingContextValue {
  /** 本地持久化状态是否已恢复完成 */
  hydrated: boolean
  phase: OnboardingPhase
  userName: string
  setUserName: (name: string) => void
  /** 头像标识：预设 id 或 "custom"（使用本地上传图片） */
  avatarId: string
  /** 本地上传的头像图片（data URL），仅当 avatarId 为 "custom" 时使用 */
  customAvatar: string | null
  /** 选择预设头像 */
  setAvatar: (id: string) => void
  /** 设置本地上传头像（data URL），并将 avatarId 置为 "custom" */
  setCustomAvatar: (dataUrl: string) => void
  serverSource: ServerSource
  setServerSource: (s: ServerSource) => void
  auth: AuthMethod
  /** 保存登录方式（密钥/密码）并持久化，供锁屏校验 */
  setAuth: (a: AuthMethod) => void
  /** 退出登录：进入锁屏，下次进入只需输入密钥/密码 */
  lock: () => void
  /** 触发覆盖层渐隐离场，动画结束后自动进入 done */
  startUnlock: () => void
  /** 清除本机保存的首次引导数据，并重新开始初始化流程 */
  reset: () => void
  recoveryError: ConnectionStorageFailure | null
  retryRecovery: () => Promise<void>
  reinitializeCredentials: () => Promise<void>
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null)

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { settings, hydrated, update, reset: resetLocalSettings } = useLocalSettings()
  const [phase, setPhase] = useState<OnboardingPhase>("intro")
  const [serverSource, setServerSourceState] = useState<ServerSource>(null)
  const [auth, setAuthState] = useState<AuthMethod>(null)
  const restored = useRef(false)
  const legacyLocalSource = useRef(false)
  const snapshot = useRef<OnboardingSnapshot>(EMPTY_ONBOARDING_SNAPSHOT)
  const persistenceQueue = useRef<Promise<unknown>>(Promise.resolve())
  const [connectionHydrated, setConnectionHydrated] = useState(false)
  const [recoveryError, setRecoveryError] = useState<ConnectionStorageFailure | null>(null)
  const { status: localControlStatus } = useLocalControlServer()

  const persistSnapshot = useCallback((next: OnboardingSnapshot) => {
    snapshot.current = next
    const saved = persistenceQueue.current
      .catch(() => undefined)
      .then(() => persistOnboardingSnapshot(
        typeof window === "undefined" ? undefined : window.nachoConnection,
        localStorage,
        next,
      ))
      .then(() => true)
      .catch(() => {
        setRecoveryError({ code: "write-failed", message: "本地凭据保存校验失败，原记录保持保留。" })
        setPhase("recovery")
        return false
      })
    persistenceQueue.current = saved
    return saved
  }, [])

  const restore = useCallback(async () => {
    try {
      const { snapshot: saved, legacyLocalSource: isLegacyLocal } = await restoreOnboardingSnapshot(
        typeof window === "undefined" ? undefined : window.nachoConnection, localStorage,
      )
      snapshot.current = saved
      legacyLocalSource.current = isLegacyLocal
      setServerSourceState(saved.serverSource)
      setAuthState(saved.auth)
      const nextPhase = restoredOnboardingPhase(settings.onboardingCompleted, saved)
      setRecoveryError(nextPhase === "recovery" ? {
        code: "missing-auth", message: "已初始化的面板缺少本地登录凭据，请先恢复或明确重新初始化。",
      } : null)
      setPhase(nextPhase)
    } catch (error) {
      setServerSourceState(null)
      setAuthState(null)
      setRecoveryError(error instanceof ConnectionRestoreError ? error.failure : {
        code: "read-failed", message: "本地凭据恢复失败，请重试读取。",
      })
      setPhase("recovery")
    } finally { setConnectionHydrated(true) }
  }, [settings.onboardingCompleted])

  // 恢复错误只进入专用状态，保留锁定语义及历史文件，不读取明文作为回退。
  useEffect(() => {
    if (!hydrated || restored.current) return
    restored.current = true
    void restore()
  }, [hydrated, restore])

  const retryRecovery = useCallback(async () => { await restore() }, [restore])
  const reinitializeCredentials = useCallback(async () => {
    if (window.nachoConnection) {
      if (!window.nachoConnection.reinitialize) throw new Error("需要支持凭据恢复的新桌面版本")
      await window.nachoConnection.reinitialize("RESET_LOCAL_CREDENTIALS")
    } else await clearOnboardingSnapshot(undefined, localStorage)
    await update({ onboardingCompleted: false })
    // 用户名、头像、主题、通知设置保留；仅明确重新建立本机连接和登录方式。
    window.location.reload()
  }, [update])

  useEffect(() => {
    if (!connectionHydrated || !legacyLocalSource.current || !localControlStatus?.healthy || !localControlStatus.connection) return
    legacyLocalSource.current = false
    const source: ServerSource = { mode: "local", ...localControlStatus.connection }
    setServerSourceState(source)
    persistSnapshot({ ...snapshot.current, serverSource: source })
  }, [connectionHydrated, localControlStatus, persistSnapshot])

  const setUserName = useCallback((name: string) => {
    void update({ profile: { userName: name } })
  }, [update])

  const setAvatar = useCallback((id: string) => {
    void update({ profile: { avatarId: id as LocalAvatarId } })
  }, [update])

  const setCustomAvatar = useCallback((dataUrl: string) => {
    void update({ profile: { customAvatar: dataUrl, avatarId: "custom" } })
  }, [update])

  const setAuth = useCallback((a: AuthMethod) => {
    setAuthState(a)
    persistSnapshot({ ...snapshot.current, auth: a })
  }, [persistSnapshot])

  const lock = useCallback(() => {
    persistSnapshot({ ...snapshot.current, locked: true })
    setPhase("locked")
  }, [persistSnapshot])

  const startUnlock = useCallback(() => {
    void (async () => {
      if (!await persistSnapshot({ ...snapshot.current, locked: false })) return
      await update({ onboardingCompleted: true })
      setPhase("unlocking")
      // 与覆盖层离场动画时长保持一致，结束后卸载覆盖层。
      window.setTimeout(() => setPhase("done"), 1050)
    })().catch(() => {
      setRecoveryError({ code: "write-failed", message: "本地初始化状态保存失败，请重试读取凭据。" })
      setPhase("recovery")
    })
  }, [persistSnapshot, update])

  const setServerSource = useCallback((source: ServerSource) => {
    setServerSourceState(source)
    persistSnapshot({ ...snapshot.current, serverSource: source })
  }, [persistSnapshot])

  const reset = useCallback(() => {
    void (async () => {
      await clearOnboardingSnapshot(
        typeof window === "undefined" ? undefined : window.nachoConnection,
        localStorage,
      )
      await resetLocalSettings()

      // A reload also resets transient step and animation state owned by child components.
      window.location.reload()
    })()
  }, [resetLocalSettings])

  return (
    <OnboardingContext.Provider
      value={{
        hydrated: hydrated && connectionHydrated,
        phase,
        userName: settings.profile.userName,
        setUserName,
        avatarId: settings.profile.avatarId,
        customAvatar: settings.profile.customAvatar,
        setAvatar,
        setCustomAvatar,
        serverSource,
        setServerSource,
        auth,
        setAuth,
        lock,
        startUnlock,
        reset,
        recoveryError,
        retryRecovery,
        reinitializeCredentials,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  )
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext)
  if (!ctx) throw new Error("useOnboarding 必须在 OnboardingProvider 内使用")
  return ctx
}
