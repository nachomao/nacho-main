"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useLocalSettings } from "@/components/local-settings-provider"
import { useLocalControlServer } from "@/lib/local-control-server-client"
import type { LocalAvatarId } from "@/lib/local-settings-schema"
import {
  clearOnboardingSnapshot,
  EMPTY_ONBOARDING_SNAPSHOT,
  persistOnboardingSnapshot,
  restoreOnboardingSnapshot,
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
type OnboardingPhase = "intro" | "locked" | "unlocking" | "done"

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
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve())
  const [connectionHydrated, setConnectionHydrated] = useState(false)
  const { status: localControlStatus } = useLocalControlServer()

  const persistSnapshot = useCallback((next: OnboardingSnapshot) => {
    snapshot.current = next
    persistenceQueue.current = persistenceQueue.current
      .catch(() => undefined)
      .then(() => persistOnboardingSnapshot(
        typeof window === "undefined" ? undefined : window.nachoConnection,
        localStorage,
        next,
      ))
      .catch((error) => console.error("连接配置保存失败", error))
  }, [])

  // 共享设置迁移完成后，再恢复桌面加密记录或浏览器连接与锁屏状态。
  useEffect(() => {
    if (!hydrated || restored.current) return
    restored.current = true
    let active = true
    void restoreOnboardingSnapshot(
      typeof window === "undefined" ? undefined : window.nachoConnection,
      localStorage,
    ).then(({ snapshot: saved, legacyLocalSource: isLegacyLocal }) => {
      if (!active) return
      snapshot.current = saved
      legacyLocalSource.current = isLegacyLocal
      setServerSourceState(saved.serverSource)
      setAuthState(saved.auth)
      if (settings.onboardingCompleted) {
        setPhase(saved.auth
          ? (saved.locked ? "locked" : "done")
          : "done")
      }
    }).catch((error) => {
      // 桌面密文损坏或读取失败时不读取 localStorage 明文作为回退。
      console.error("连接配置恢复失败", error)
    }).finally(() => {
      if (active) setConnectionHydrated(true)
    })
    return () => {
      active = false
    }
  }, [hydrated, settings.onboardingCompleted])

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
    persistSnapshot({ ...snapshot.current, locked: false })
    setPhase("unlocking")
    void update({ onboardingCompleted: true })
    // 与覆盖层离场动画时长保持一致，结束后卸载覆盖层
    window.setTimeout(() => setPhase("done"), 1050)
  }, [persistSnapshot, update])

  const setServerSource = useCallback((source: ServerSource) => {
    setServerSourceState(source)
    persistSnapshot({ ...snapshot.current, serverSource: source })
  }, [persistSnapshot])

  const reset = useCallback(() => {
    void (async () => {
      await resetLocalSettings()
      await clearOnboardingSnapshot(
        typeof window === "undefined" ? undefined : window.nachoConnection,
        localStorage,
      )

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
