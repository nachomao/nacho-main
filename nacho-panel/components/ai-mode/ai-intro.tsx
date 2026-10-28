"use client"

import { useEffect, useState } from "react"
import { Sparkles } from "lucide-react"

/**
 * 时间轴（毫秒，相对挂载时刻）。组件在暗幕铺垫（dimming，约 900ms）开始时挂载，
 * onDone 必须晚于铺垫结束，否则 introDone 只在 intro 阶段生效会被忽略。
 */
const T = {
  markIn: 200,
  labelIn: 380,
  lineIn: 520,
  lineMs: 980,
  out: 1560,
  outMs: 380,
} as const
/** 标识开始淡出后稍候交给工作台入场，两者短暂重叠 */
const DONE_AT = T.out + 120
const STILL_DONE_AT = 1200

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)"
const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)"
const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)"

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * AI Mode 载入开场：与工作台空态同款的图标方块安静浮现，
 * 下方一条细线走完一次作为载入指示，随后整体淡出、工作台接管画面。
 */
export function AIIntro({ onDone }: { onDone: () => void }) {
  const [still] = useState(prefersReducedMotion)

  useEffect(() => {
    const timer = window.setTimeout(onDone, still ? STILL_DONE_AT : DONE_AT)
    return () => clearTimeout(timer)
  }, [onDone, still])

  return (
    <div
      role="status"
      data-still={still ? "" : undefined}
      className="aii-root flex h-full w-full items-center justify-center"
    >
      <span className="sr-only">AI Mode 正在载入</span>

      <div aria-hidden className="aii-group flex flex-col items-center gap-5">
        <span className="aii-mark flex size-14 items-center justify-center rounded-2xl border border-border/70 bg-background/70 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)]">
          <Sparkles className="size-6 text-foreground/80" />
        </span>

        <div className="aii-label flex flex-col items-center gap-3">
          <span className="text-sm font-medium tracking-wide text-foreground/80">AI Mode</span>
          <span className="aii-track relative block h-px w-12 overflow-hidden rounded-full bg-border">
            <span className="aii-line absolute inset-0 origin-left bg-foreground/60" />
          </span>
        </div>
      </div>

      <style>{INTRO_CSS}</style>
    </div>
  )
}

const INTRO_CSS = `
@keyframes aii-mark-in {
  from { opacity: 0; transform: translateY(6px) scale(0.96); filter: blur(4px); }
  to { opacity: 1; transform: none; filter: blur(0px); }
}
@keyframes aii-rise-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
@keyframes aii-line {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
@keyframes aii-out {
  to { opacity: 0; transform: translateY(-4px) scale(0.98); filter: blur(4px); }
}
@keyframes aii-fade-in {
  from { opacity: 0; }
}
@keyframes aii-fade-out {
  to { opacity: 0; }
}
.aii-mark { animation: aii-mark-in 600ms ${EASE_OUT} ${T.markIn}ms both; }
.aii-label { animation: aii-rise-in 500ms ${EASE_OUT} ${T.labelIn}ms both; }
.aii-line { transform: scaleX(0); animation: aii-line ${T.lineMs}ms ${EASE_IN_OUT} ${T.lineIn}ms both; }
.aii-group { animation: aii-out ${T.outMs}ms ${EASE_IN} ${T.out}ms forwards; }
.aii-root[data-still] .aii-mark,
.aii-root[data-still] .aii-label { animation: aii-fade-in 400ms ease-out both; }
.aii-root[data-still] .aii-track { display: none; }
.aii-root[data-still] .aii-group { animation: aii-fade-out 300ms ease-out ${STILL_DONE_AT - 100}ms forwards; }
`
