"use client"

/* 深度思考：移植自 React Bits ThoughtLine
 * https://reactbits.dev/c/micro/thought-line
 * MIT + Commons Clause，Copyright (c) 2026 David Haz。
 * 保留模块的实时计时、呼吸 / 扫光、逐条步骤轨迹与“结束后折叠成一行”；图标换成 lucide-react，
 * 削弱动效改由面板“削弱动画效果”开关控制（不读系统 prefers-reduced-motion），
 * 步骤轨迹用 AutoHeight 平滑展开，流式追加步骤时高度同样逐帧过渡。 */

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import { animate, type AnimationPlaybackControls } from "motion/react"
import { Check, ChevronDown, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMotionPreference } from "@/lib/motion-preference"
import { AutoHeight } from "@/components/ui/auto-height"

export type ThoughtLineGlyph = "sparkle" | "dot" | "none" | ReactNode

export type ThoughtLineProps = {
  label?: string
  doneLabel?: string
  renderLabel?: (text: string, working: boolean) => ReactNode
  glyph?: ThoughtLineGlyph
  steps?: string[]
  collapsible?: boolean
  collapseOnSettle?: boolean
  color?: string
  glyphColor?: string
  fontSize?: number
  breathPeriod?: number
  breathDepth?: number
  shimmer?: boolean
  shimmerDuration?: number
  settleDuration?: number
  settleBlur?: number
  working?: boolean
  settleAfter?: number
  /** 已累计的思考秒数：静止时直接显示，再次进入思考时从该值继续计时。 */
  elapsed?: number
  showTimer?: boolean
  /** 从思考中切换到完成时回调累计秒数，可用于持久化 elapsed。 */
  onSettle?: (seconds: number) => void
  className?: string
  style?: CSSProperties
}

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1]
const EASE_IN_OUT: [number, number, number, number] = [0.77, 0, 0.175, 1]
const GLYPH_DONE = 0.55
const EMPTY_STEPS: string[] = []

const fmt = (ds: number) =>
  ds < 600 ? `${(ds / 10).toFixed(1)}s` : `${Math.floor(ds / 600)}m ${((ds % 600) / 10).toFixed(1)}s`
const spoken = (ds: number) =>
  ds < 600
    ? `${(ds / 10).toFixed(1)} 秒`
    : `${Math.floor(ds / 600)} 分 ${((ds % 600) / 10).toFixed(1)} 秒`

const STYLE = `
@keyframes thought-line-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
@keyframes thought-line-shimmer { to { background-position: -125% 0; } }
`

export function ThoughtLine({
  label = "思考中…",
  doneLabel = "",
  renderLabel,
  glyph = "sparkle",
  steps = EMPTY_STEPS,
  collapsible = true,
  collapseOnSettle = true,
  color = "currentColor",
  glyphColor = "",
  fontSize = 16,
  breathPeriod = 1.6,
  breathDepth = 0.45,
  shimmer = true,
  shimmerDuration = 1.8,
  settleDuration = 350,
  settleBlur = 2,
  working = true,
  settleAfter = 0,
  elapsed,
  showTimer = true,
  onSettle,
  className,
  style,
}: ThoughtLineProps) {
  const { reduceMotion: reduce } = useMotionPreference()
  const [autoSettled, setAutoSettled] = useState(false)
  const isWorking = working && !autoSettled
  const [open, setOpen] = useState(() => isWorking || !collapseOnSettle)
  const [clockRan, setClockRan] = useState(false)
  const [initialGlyphOpacity] = useState(() => (isWorking ? 1 : GLYPH_DONE))
  const doneText = doneLabel || (showTimer ? "思考用时" : "思考完成")
  const hasTrace = steps.length > 0
  const depth = reduce ? Math.min(breathDepth, 0.2) : breathDepth
  const period = reduce ? breathPeriod * 1.5 : breathPeriod
  const trough = 1 - depth
  const sheen = shimmer && !reduce
  const settle = reduce ? 0 : settleDuration
  const blur = reduce ? 0 : settleBlur
  const timerVisible = showTimer && (isWorking || clockRan || elapsed != null)

  const glyphRef = useRef<HTMLSpanElement>(null)
  const breathRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<HTMLSpanElement>(null)
  const tailRef = useRef<HTMLSpanElement>(null)
  const stackRef = useRef<HTMLSpanElement>(null)
  const workRef = useRef<HTMLSpanElement>(null)
  const doneRef = useRef<HTMLSpanElement>(null)
  const traceRef = useRef<HTMLDivElement>(null)
  const dsRef = useRef(0)
  const prevWorking = useRef(isWorking)
  const workedRef = useRef(isWorking)
  const [announce, setAnnounce] = useState(label)
  const emitSettle = useEffectEvent((seconds: number) => onSettle?.(seconds))

  useEffect(() => {
    if (working) setAutoSettled(false)
  }, [working])

  useEffect(() => {
    if (isWorking) setOpen(true)
    else if (collapseOnSettle) setOpen(false)
  }, [isWorking, collapseOnSettle])

  useEffect(() => {
    if (isWorking) setClockRan(true)
  }, [isWorking])

  useEffect(() => {
    const glyphEl = glyphRef.current
    const breathEl = breathRef.current
    if (!breathEl) return undefined
    const s = settle / 1000
    const loop = (el: HTMLElement, delay: number) =>
      animate(el, { opacity: [trough, 1, trough] }, { duration: period, ease: EASE_IN_OUT, repeat: Infinity, delay })
    let cancelled = false
    const running: AnimationPlaybackControls[] = []
    if (isWorking) {
      if (depth > 0) {
        if (sheen) running.push(animate(breathEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }))
        if (glyphEl) {
          const lead = animate(glyphEl, { opacity: trough }, { duration: 0.2, ease: EASE_OUT })
          running.push(lead)
          lead.then(() => {
            if (cancelled) return
            running.push(loop(glyphEl, 0))
            if (!sheen) running.push(loop(breathEl, 0.14))
          })
        } else if (!sheen) {
          running.push(loop(breathEl, 0.14))
        }
      } else {
        if (glyphEl) running.push(animate(glyphEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }))
        running.push(animate(breathEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }))
      }
    } else {
      if (glyphEl) running.push(animate(glyphEl, { opacity: GLYPH_DONE }, { duration: s, ease: EASE_OUT }))
      running.push(animate(breathEl, { opacity: 1 }, { duration: s, ease: EASE_OUT }))
    }
    return () => {
      cancelled = true
      running.forEach((animation) => animation.stop())
    }
  }, [isWorking, period, depth, trough, settle, glyph, sheen])

  const paint = (ds: number) => {
    dsRef.current = ds
    if (timerRef.current) timerRef.current.textContent = fmt(ds)
  }

  useLayoutEffect(() => {
    const base = elapsed != null && Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed * 10)) : 0
    if (!isWorking) {
      paint(Math.max(base, dsRef.current))
      return undefined
    }
    const from = Math.max(base, dsRef.current)
    const startedAt = performance.now() - from * 100
    paint(from)
    const id = window.setInterval(() => {
      const ds = Math.floor((performance.now() - startedAt) / 100)
      paint(ds)
      if (settleAfter > 0 && ds >= Math.round(settleAfter * 10)) setAutoSettled(true)
    }, 100)
    return () => window.clearInterval(id)
  }, [isWorking, elapsed, settleAfter, timerVisible])

  // 计时器与箭头一起贴在当前标签后面；思考中 / 完成两种标签宽度不同，切换时整体滑到新位置。
  useLayoutEffect(() => {
    const tail = tailRef.current
    const stack = stackRef.current
    if (!tail || !stack) return undefined
    const measure = () => `${workRef.current?.offsetWidth}:${doneRef.current?.offsetWidth}:${stack.offsetWidth}`
    const place = (glide: boolean) => {
      const active = isWorking ? workRef.current : doneRef.current
      if (!active) return
      const shift = active.offsetWidth - stack.offsetWidth
      if (!glide) tail.style.transition = "none"
      tail.style.transform = `translateX(${shift}px)`
      if (!glide) {
        void tail.offsetWidth
        tail.style.transition = ""
      }
    }
    place(prevWorking.current !== isWorking)
    prevWorking.current = isWorking
    let widths = measure()
    const observer = new ResizeObserver(() => {
      const next = measure()
      if (next === widths) return
      widths = next
      place(false)
    })
    if (workRef.current) observer.observe(workRef.current)
    if (doneRef.current) observer.observe(doneRef.current)
    return () => observer.disconnect()
  }, [isWorking, label, doneText, fontSize, timerVisible])

  useEffect(() => {
    const trace = traceRef.current
    if (!trace || !isWorking || trace.scrollHeight - trace.clientHeight < 2) return
    trace.scrollTo({ top: trace.scrollHeight, behavior: reduce ? "auto" : "smooth" })
  }, [steps, isWorking, reduce])

  useEffect(() => {
    if (isWorking) {
      workedRef.current = true
      setAnnounce(label)
      return
    }
    setAnnounce(timerVisible ? `${doneText} ${spoken(dsRef.current)}` : doneText)
    if (!workedRef.current) return
    workedRef.current = false
    emitSettle(dsRef.current / 10)
  }, [isWorking, label])

  const toggle = hasTrace && collapsible
  const labelTransition =
    "[transition:opacity_var(--tl-settle)_cubic-bezier(0.23,1,0.32,1),filter_var(--tl-settle)_cubic-bezier(0.23,1,0.32,1)]"
  const head = (
    <>
      {glyph !== "none" ? (
        <span
          ref={glyphRef}
          className="mr-[0.2em] inline-flex h-[1.1em] w-[1.1em] flex-none [color:var(--tl-glyph)] [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          style={{ opacity: initialGlyphOpacity }}
          aria-hidden="true"
        >
          {glyph === "sparkle" ? (
            <Sparkles strokeWidth={2} />
          ) : glyph === "dot" ? (
            <span className="m-auto h-[0.5em] w-[0.5em] rounded-full bg-current" />
          ) : (
            glyph
          )}
        </span>
      ) : null}
      <span ref={stackRef} className="inline-grid" aria-hidden="true">
        <span
          ref={workRef}
          className={cn(
            "w-max opacity-0 [grid-area:1/1] [filter:blur(var(--tl-blur))] data-[active]:opacity-100 data-[active]:[filter:blur(0)]",
            labelTransition,
          )}
          data-active={isWorking ? "" : undefined}
        >
          <span
            ref={breathRef}
            className="inline-block group-data-[working]:data-[shimmer]:bg-clip-text group-data-[working]:data-[shimmer]:text-transparent group-data-[working]:data-[shimmer]:[background-image:linear-gradient(100deg,color-mix(in_srgb,var(--tl-color)_50%,transparent)_30%,var(--tl-color)_50%,color-mix(in_srgb,var(--tl-color)_50%,transparent)_70%)] group-data-[working]:data-[shimmer]:[background-size:250%_100%] group-data-[working]:data-[shimmer]:[background-position:125%_0] group-data-[working]:data-[shimmer]:[-webkit-text-fill-color:transparent] group-data-[working]:data-[shimmer]:[animation:thought-line-shimmer_var(--tl-shimmer)_linear_infinite]"
            data-shimmer={sheen ? "" : undefined}
          >
            {renderLabel ? renderLabel(label, true) : label}
          </span>
        </span>
        <span
          ref={doneRef}
          className={cn(
            "w-max opacity-0 [grid-area:1/1] [filter:blur(var(--tl-blur))] data-[active]:[opacity:var(--tl-done)] data-[active]:[filter:blur(0)]",
            labelTransition,
          )}
          data-active={isWorking ? undefined : ""}
        >
          {renderLabel ? renderLabel(doneText, false) : doneText}
        </span>
      </span>
      <span
        ref={tailRef}
        className="inline-flex items-center gap-[0.3em] [transition:transform_var(--tl-settle)_cubic-bezier(0.77,0,0.175,1)]"
      >
        {timerVisible ? (
          <span
            ref={timerRef}
            className="tabular-nums [opacity:var(--tl-timer)] [transition:opacity_var(--tl-settle)_ease] data-[done]:[opacity:var(--tl-done)]"
            data-done={isWorking ? undefined : ""}
            aria-hidden="true"
          >
            0.0s
          </span>
        ) : null}
        {collapsible ? (
          <span
            className="ml-[0.1em] inline-flex opacity-0 [transition:opacity_200ms_ease,transform_200ms_cubic-bezier(0.23,1,0.32,1)] data-[on]:opacity-55 group-data-[open]:rotate-180"
            data-on={hasTrace ? "" : undefined}
            aria-hidden="true"
          >
            <ChevronDown size="1em" strokeWidth={2.2} />
          </span>
        ) : null}
      </span>
      <span className="sr-only" role="status">
        {announce}
      </span>
    </>
  )

  const headClass =
    "relative m-0 inline-flex cursor-default items-center gap-[0.3em] rounded-sm border-0 bg-transparent p-0 text-left whitespace-nowrap text-inherit outline-none [font:inherit] focus-visible:ring-1 focus-visible:ring-primary/60 data-[toggle]:cursor-pointer data-[toggle]:[-webkit-tap-highlight-color:transparent] data-[toggle]:hover:[--tl-done:1]"

  return (
    <div
      className={cn(
        "group flex w-full flex-col items-start leading-[1.2] font-medium [color:var(--tl-color)] [font-family:inherit] [font-size:var(--tl-font)]",
        className,
      )}
      data-working={isWorking ? "" : undefined}
      data-open={open && hasTrace ? "" : undefined}
      style={
        {
          "--tl-font": `${fontSize}px`,
          "--tl-color": color,
          "--tl-glyph": glyphColor || color,
          "--tl-settle": `${settle}ms`,
          "--tl-blur": `${blur}px`,
          "--tl-shimmer": `${shimmerDuration}s`,
          "--tl-done": "0.75",
          "--tl-timer": "0.55",
          ...style,
        } as CSSProperties
      }
    >
      <style>{STYLE}</style>
      {collapsible ? (
        <button
          type="button"
          className={headClass}
          data-toggle={toggle ? "" : undefined}
          aria-expanded={toggle ? open : undefined}
          aria-label={toggle ? `${announce}，${open ? "收起" : "展开"}思考过程` : undefined}
          tabIndex={toggle ? 0 : -1}
          onClick={() => {
            if (toggle) setOpen((value) => !value)
          }}
        >
          {head}
        </button>
      ) : (
        <div className={headClass}>{head}</div>
      )}
      {hasTrace ? (
        <AutoHeight open={open} appear duration={settle} className="w-full" innerClassName="pt-[0.6em] pb-[0.2em]">
          <div
            ref={traceRef}
            className="flex max-h-56 flex-col gap-[0.45em] overflow-y-auto pr-1 pl-[1.6em] text-[0.875em] font-normal"
          >
            {steps.map((text, index) => {
              const done = !isWorking || index < steps.length - 1
              return (
                <div
                  // 步骤只会在末尾追加，用序号作 key，流式输出时最后一步原地更新而不会重播入场动画
                  key={index}
                  className={cn(
                    "group/step flex items-start gap-[0.5em] opacity-100 [transition:opacity_200ms_cubic-bezier(0.23,1,0.32,1),translate_200ms_cubic-bezier(0.23,1,0.32,1)] starting:opacity-0",
                    !reduce && "translate-y-0 starting:-translate-y-1",
                  )}
                  data-done={done ? "" : undefined}
                >
                  <span className="inline-grid h-[1.6em] w-[1em] flex-none place-items-center opacity-55" aria-hidden="true">
                    {done ? (
                      <Check size="1em" strokeWidth={2.5} />
                    ) : (
                      <i
                        className={cn(
                          "block h-[0.4em] w-[0.4em] rounded-full bg-current [animation:thought-line-pulse_1.6s_cubic-bezier(0.77,0,0.175,1)_infinite]",
                          reduce && "[animation-duration:2.4s]",
                        )}
                      />
                    )}
                  </span>
                  <span className="min-w-0 leading-[1.6] break-words [transition:opacity_var(--tl-settle)_ease] group-data-[done]/step:opacity-55">
                    {text}
                  </span>
                </div>
              )
            })}
          </div>
        </AutoHeight>
      ) : null}
    </div>
  )
}
