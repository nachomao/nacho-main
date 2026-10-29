"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react"
import { holdForegroundMotion } from "@/lib/foreground-motion"
import {
  AI_MODE_TIMING,
  resolveAIOriginPoint,
  type AIModePhase,
  type AIOriginPoint,
} from "@/lib/ai-mode-transition"

type EnterTrigger = HTMLElement | ReactMouseEvent<HTMLElement> | null | undefined

type AIModeContextValue = {
  /** 当前是否处于 AI Mode（含载入/进入/退出过渡） */
  phase: AIModePhase
  /** AI 层是否需要挂载（intro/entering/active/exiting 期间都要渲染） */
  mounted: boolean
  /** 底层应用是否应处于退场姿态（3D 缩退 + 景深模糊） */
  shellRecessed: boolean
  /** 点击触发按钮的视口坐标锚点，驱动起点冲击波与能量光弧 */
  origin: AIOriginPoint
  enter: (trigger?: EnterTrigger) => void
  /** 开场核心演化进入空间门阶段，交接给三栏工作台破茧入场 */
  introDone: () => void
  exit: () => void
}

const AIModeContext = createContext<AIModeContextValue | null>(null)

function extractElement(trigger: EnterTrigger): HTMLElement | null {
  if (!trigger) return null
  if (typeof HTMLElement !== "undefined" && trigger instanceof HTMLElement) {
    return trigger
  }
  if (typeof trigger === "object" && "currentTarget" in trigger && trigger.currentTarget instanceof HTMLElement) {
    return trigger.currentTarget
  }
  return null
}

export function AIModeProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AIModePhase>("closed")
  const [origin, setOrigin] = useState<AIOriginPoint>(() => resolveAIOriginPoint(null, null))

  const enter = useCallback((trigger?: EnterTrigger) => {
    if (typeof window !== "undefined") {
      const el = extractElement(trigger)
      const rect = el ? el.getBoundingClientRect() : null
      setOrigin(resolveAIOriginPoint(rect, { width: window.innerWidth, height: window.innerHeight }))
    }
    // 零黑屏等待：点击瞬间即进入 intro，按钮冲击波、底层 3D 退场与双螺旋核心同步启动
    setPhase((p) => (p === "closed" || p === "exiting" ? "intro" : p))
  }, [])

  const introDone = useCallback(() => {
    setPhase((p) => (p === "intro" || p === "dimming" ? "entering" : p))
  }, [])

  const exit = useCallback(() => {
    setPhase((p) => (p === "active" || p === "entering" || p === "intro" || p === "dimming" ? "exiting" : p))
  }, [])

  // 过渡态期间暂停底层常驻 WebGL 光晕（Orb）逐帧重绘，保障 60fps 切入与退场帧率
  useEffect(() => {
    if (phase === "intro" || phase === "dimming") {
      return holdForegroundMotion(AI_MODE_TIMING.PORTAL_HANDOFF_MS + AI_MODE_TIMING.WORKSPACE_ENTER_MS + 200)
    }
    if (phase === "entering") {
      return holdForegroundMotion(AI_MODE_TIMING.WORKSPACE_ENTER_MS + 150)
    }
    if (phase === "exiting") {
      return holdForegroundMotion(AI_MODE_TIMING.WORKSPACE_EXIT_MS + 120)
    }
  }, [phase])

  // 过渡态自动推进到稳定态
  useEffect(() => {
    if (phase === "dimming") {
      const t = setTimeout(() => setPhase("intro"), 120)
      return () => clearTimeout(t)
    }
    if (phase === "entering") {
      const t = setTimeout(() => setPhase("active"), AI_MODE_TIMING.WORKSPACE_ENTER_MS)
      return () => clearTimeout(t)
    }
    if (phase === "exiting") {
      const t = setTimeout(() => setPhase("closed"), AI_MODE_TIMING.WORKSPACE_EXIT_MS)
      return () => clearTimeout(t)
    }
  }, [phase])

  // ESC 退出（开场与激活阶段均可按 Esc 立即退场）
  useEffect(() => {
    if (phase !== "active" && phase !== "entering" && phase !== "intro" && phase !== "dimming") return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [phase, exit])

  const value = useMemo<AIModeContextValue>(
    () => ({
      phase,
      mounted: phase !== "closed",
      shellRecessed: phase === "dimming" || phase === "intro" || phase === "entering" || phase === "active",
      origin,
      enter,
      introDone,
      exit,
    }),
    [phase, origin, enter, introDone, exit],
  )

  return <AIModeContext.Provider value={value}>{children}</AIModeContext.Provider>
}

export function useAIMode() {
  const ctx = useContext(AIModeContext)
  if (!ctx) throw new Error("useAIMode must be used within AIModeProvider")
  return ctx
}
