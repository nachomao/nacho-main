"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useLocalSettings } from "@/components/local-settings-provider"
import type { LocalAvatarId } from "@/lib/local-settings-schema"

/** 服务端来源：本地部署 或 云端对接（API + Key） */
export type ServerSource =
  | { mode: "local" }
  | { mode: "cloud"; api: string; key: string }
  | null

/** 登录方式：生成的登录密钥 或 用户设置的密码（二选一） */
export type AuthMethod = { mode: "key" | "password"; secret: string } | null

/**
 * 引导流程阶段：
 * - intro     引导覆盖层展示中（品牌动画 / 用户名 / 服务端 / 登录方式注册）
 * - locked    已退出登录，显示锁屏（仅需输入密钥或密码解锁，不走完整流程）
 * - unlocking 覆盖层正在渐隐离场，主页同步浮现
 * - done      引导完成，覆盖层已卸载
 */
type OnboardingPhase = "intro" | "locked" | "unlocking" | "done"

const AUTH_STORAGE_KEY = "nacho-auth"
const LOCKED_STORAGE_KEY = "nacho-locked"
const SERVER_SOURCE_STORAGE_KEY = "nacho-server-source"

const ONBOARDING_STORAGE_KEYS = [
  AUTH_STORAGE_KEY,
  LOCKED_STORAGE_KEY,
  SERVER_SOURCE_STORAGE_KEY,
] as const

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

  // 共享设置迁移完成后，再恢复当前浏览器独有的连接与锁屏状态。
  useEffect(() => {
    if (!hydrated || restored.current) return
    restored.current = true
    try {
      const savedServerSource = localStorage.getItem(SERVER_SOURCE_STORAGE_KEY)
      if (savedServerSource) {
        const parsed = JSON.parse(savedServerSource) as ServerSource
        if (parsed?.mode === "local" || (parsed?.mode === "cloud" && parsed.api && parsed.key)) {
          setServerSourceState(parsed)
        }
      }
      const raw = localStorage.getItem(AUTH_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as AuthMethod
        if (parsed && (parsed.mode === "key" || parsed.mode === "password") && parsed.secret) {
          setAuthState(parsed)
          if (settings.onboardingCompleted) {
            setPhase(localStorage.getItem(LOCKED_STORAGE_KEY) === "1" ? "locked" : "done")
          }
        }
      }
      if (settings.onboardingCompleted && !raw) setPhase("done")
    } catch {
      // 存储不可用时静默降级为完整首次流程
    }
  }, [hydrated, settings.onboardingCompleted])

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
    try {
      if (a) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(a))
      else localStorage.removeItem(AUTH_STORAGE_KEY)
    } catch {}
  }, [])

  const lock = useCallback(() => {
    try {
      localStorage.setItem(LOCKED_STORAGE_KEY, "1")
    } catch {}
    setPhase("locked")
  }, [])

  const startUnlock = useCallback(() => {
    try {
      localStorage.removeItem(LOCKED_STORAGE_KEY)
    } catch {}
    setPhase("unlocking")
    void update({ onboardingCompleted: true })
    // 与覆盖层离场动画时长保持一致，结束后卸载覆盖层
    window.setTimeout(() => setPhase("done"), 1050)
  }, [update])

  const setServerSource = useCallback((source: ServerSource) => {
    setServerSourceState(source)
    try {
      if (source) localStorage.setItem(SERVER_SOURCE_STORAGE_KEY, JSON.stringify(source))
      else localStorage.removeItem(SERVER_SOURCE_STORAGE_KEY)
    } catch {}
  }, [])

  const reset = useCallback(() => {
    void (async () => {
      await resetLocalSettings()
      try {
        ONBOARDING_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key))
      } catch {}

      // A reload also resets transient step and animation state owned by child components.
      window.location.reload()
    })()
  }, [resetLocalSettings])

  return (
    <OnboardingContext.Provider
      value={{
        hydrated,
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
