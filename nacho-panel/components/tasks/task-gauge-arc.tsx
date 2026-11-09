"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

const ARC_PATH = "M10 60 A50 50 0 0 1 110 60"
const DRAW_MS = 1200
const UPDATE_MS = 700

/* 计划任务半圆仪表：挂载后从起点"走"到目标进度；入场完成后，后续进度刷新改用短过渡且不再延迟 */
export function TaskGaugeArc({
  progress,
  hidden,
  delayMs = 0,
}: {
  progress: number
  hidden: boolean
  delayMs?: number
}) {
  const [drawn, setDrawn] = useState(false)
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    // 双重 rAF：确保 0 进度帧先绘制，过渡才会从起点开始
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setDrawn(true))
    })
    const settle = setTimeout(() => setSettled(true), delayMs + DRAW_MS + 50)
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
      clearTimeout(settle)
    }
  }, [delayMs])

  const target = Math.round(Math.min(1, Math.max(0, progress)) * 100)
  const value = drawn ? target : 0
  const delay = settled ? 0 : delayMs

  return (
    <svg viewBox="0 0 120 68" className="w-full overflow-visible" aria-hidden="true">
      <path
        d={ARC_PATH}
        fill="none"
        strokeWidth="9"
        strokeLinecap="round"
        style={{ stroke: "color-mix(in oklab, var(--foreground) 10%, transparent)" }}
      />
      <path
        d={ARC_PATH}
        fill="none"
        strokeWidth="9"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="100 100"
        strokeDashoffset={100 - value}
        stroke="currentColor"
        className={cn("task-gauge-arc text-primary", (hidden || !drawn) && "opacity-0")}
        style={{
          filter: "drop-shadow(0 0 5px color-mix(in oklab, var(--primary) 40%, transparent))",
          transition: `stroke-dashoffset ${settled ? UPDATE_MS : DRAW_MS}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, opacity 360ms ease-out ${delay}ms`,
        }}
      />
    </svg>
  )
}
