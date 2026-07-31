"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

type AIModePhase = "closed" | "dimming" | "intro" | "entering" | "active" | "exiting"

type AIModeContextValue = {
  /** 当前是否处于 AI Mode（含载入/进入/退出过渡） */
  phase: AIModePhase
  /** AI 层是否需要挂载（intro/entering/active/exiting 期间都要渲染） */
  mounted: boolean
  /** 底层应用是否应处于退场姿态（缩放+模糊） */
  shellRecessed: boolean
  enter: () => void
  /** 开场载入动画播完，进入工作台入场编排 */
  introDone: () => void
  exit: () => void
}

const AIModeContext = createContext<AIModeContextValue | null>(null)

/** 进入动画时长（与 CSS 过渡保持一致） */
const ENTER_MS = 900
/** 退出动画时长 */
const EXIT_MS = 560
/** 点击后画面模糊变暗的铺垫时长（底层退场约 1200ms，取其大半后无缝衔接开场） */
const DIM_MS = 900

export function AIModeProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AIModePhase>("closed")

  const enter = useCallback(() => {
    // 每次进入都先让画面模糊变暗，再播完整的载入开场
    setPhase((p) => (p === "closed" || p === "exiting" ? "dimming" : p))
  }, [])

  const introDone = useCallback(() => {
    setPhase((p) => (p === "intro" ? "entering" : p))
  }, [])

  const exit = useCallback(() => {
    setPhase((p) => (p === "active" || p === "entering" || p === "intro" || p === "dimming" ? "exiting" : p))
  }, [])

  // 过渡态自动推进到稳定态
  useEffect(() => {
    if (phase === "dimming") {
      const t = setTimeout(() => setPhase("intro"), DIM_MS)
      return () => clearTimeout(t)
    }
    if (phase === "entering") {
      const t = setTimeout(() => setPhase("active"), ENTER_MS)
      return () => clearTimeout(t)
    }
    if (phase === "exiting") {
      const t = setTimeout(() => setPhase("closed"), EXIT_MS)
      return () => clearTimeout(t)
    }
  }, [phase])

  // ESC 退出（铺垫与开场载入阶段也可按 Esc 直接跳出）
  useEffect(() => {
    if (phase !== "active" && phase !== "intro" && phase !== "dimming") return
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
      enter,
      introDone,
      exit,
    }),
    [phase, enter, introDone, exit],
  )

  return <AIModeContext.Provider value={value}>{children}</AIModeContext.Provider>
}

export function useAIMode() {
  const ctx = useContext(AIModeContext)
  if (!ctx) throw new Error("useAIMode must be used within AIModeProvider")
  return ctx
}
