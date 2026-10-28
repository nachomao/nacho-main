"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

type AIModePhase = "closed" | "intro" | "entering" | "active" | "exiting"

/** 切入动画的发源点（视口坐标）：点击位置，键盘触发时为按钮中心 */
export type AIModeOrigin = { x: number; y: number }

type AIModeContextValue = {
  /** 当前是否处于 AI Mode（含载入/进入/退出过渡） */
  phase: AIModePhase
  /** AI 层是否需要挂载（intro/entering/active/exiting 期间都要渲染） */
  mounted: boolean
  /** 底层应用是否应处于退场姿态（缩放+模糊） */
  shellRecessed: boolean
  /** 像素浪潮扩散、幕布展开与退出收拢共用的圆心 */
  origin: AIModeOrigin
  enter: (origin?: AIModeOrigin) => void
  /** 字标开始燃尽，工作台进入浮现编排 */
  introDone: () => void
  exit: () => void
}

const AIModeContext = createContext<AIModeContextValue | null>(null)

/** 工作台各栏浮现时长（与 Rise 过渡保持一致） */
const ENTER_MS = 900
/** 退出：面板淡出与幕布收拢回发源点的总时长 */
export const EXIT_MS = 620

type ModeState = { phase: AIModePhase; origin: AIModeOrigin }

export function AIModeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ModeState>({ phase: "closed", origin: { x: 0, y: 0 } })
  const { phase, origin } = state

  const enter = useCallback((next?: AIModeOrigin) => {
    // 无来源坐标（如快捷键）时从视口顶部中央涌出
    const from = next ?? { x: window.innerWidth / 2, y: 0 }
    setState((s) => (s.phase === "closed" || s.phase === "exiting" ? { phase: "intro", origin: from } : s))
  }, [])

  const introDone = useCallback(() => {
    setState((s) => (s.phase === "intro" ? { ...s, phase: "entering" } : s))
  }, [])

  const exit = useCallback(() => {
    setState((s) =>
      s.phase === "active" || s.phase === "entering" || s.phase === "intro" ? { ...s, phase: "exiting" } : s,
    )
  }, [])

  // 过渡态自动推进到稳定态
  useEffect(() => {
    if (phase === "entering") {
      const t = setTimeout(() => setState((s) => (s.phase === "entering" ? { ...s, phase: "active" } : s)), ENTER_MS)
      return () => clearTimeout(t)
    }
    if (phase === "exiting") {
      const t = setTimeout(() => setState((s) => (s.phase === "exiting" ? { ...s, phase: "closed" } : s)), EXIT_MS)
      return () => clearTimeout(t)
    }
  }, [phase])

  // ESC 退出（载入与浮现阶段也可按 Esc 直接跳出）
  useEffect(() => {
    if (phase !== "active" && phase !== "intro" && phase !== "entering") return
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
      shellRecessed: phase === "intro" || phase === "entering" || phase === "active",
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
