"use client"

/* 深度思考动效：改编自 React Bits ThoughtLine
 * https://reactbits.dev/micro/thought-line
 * MIT + Commons Clause，Copyright (c) 2026 David Haz。
 * 本实现将图标替换为 lucide-react，并把动效偏好接入面板自己的“削弱动画效果”开关。 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { animate, type AnimationPlaybackControls } from "motion/react"
import { ChevronDown, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMotionPreference } from "@/lib/motion-preference"

export type ThoughtLineGlyph = "sparkle" | "dot" | "none" | ReactNode

export type ThoughtLineProps = {
  label: string
  doneLabel: string
  working: boolean
  glyph?: ThoughtLineGlyph
  children?: ReactNode
  className?: string
  fontSize?: number
}

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1]
const EASE_IN_OUT: [number, number, number, number] = [0.77, 0, 0.175, 1]
const GLYPH_DONE = 0.55
const BREATH_DEPTH = 0.42
const BREATH_PERIOD = 1.6
const SHIMMER_DURATION = 1.8
const SETTLE_DURATION = 350
const SETTLE_BLUR = 2

const STYLE = `
@keyframes thought-line-shimmer { to { background-position: -125% 0; } }
`

export function ThoughtLine({
  label,
  doneLabel,
  working,
  glyph = "sparkle",
  children,
  className,
  fontSize = 13,
}: ThoughtLineProps) {
  const { reduceMotion } = useMotionPreference()
  const [open, setOpen] = useState(working)
  const hasTrace = Boolean(children)
  const depth = reduceMotion ? Math.min(BREATH_DEPTH, 0.2) : BREATH_DEPTH
  const period = reduceMotion ? BREATH_PERIOD * 1.5 : BREATH_PERIOD
  const trough = 1 - depth
  const sheen = !reduceMotion
  const settle = reduceMotion ? 0 : SETTLE_DURATION

  const glyphRef = useRef<HTMLSpanElement>(null)
  const breathRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (working) {
      setOpen(true)
      return
    }
    setOpen(false)
  }, [working])

  useEffect(() => {
    const breathEl = breathRef.current
    if (!breathEl) return undefined
    const glyphEl = glyphRef.current
    const settleSeconds = settle / 1000
    const loop = (el: HTMLElement, delay: number) =>
      animate(el, { opacity: [trough, 1, trough] }, {
        duration: period,
        ease: EASE_IN_OUT,
        repeat: Infinity,
        delay,
      })
    let cancelled = false
    const running: AnimationPlaybackControls[] = []
    if (working) {
      if (reduceMotion || depth <= 0) {
        running.push(animate(breathEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }))
        if (glyphEl) running.push(animate(glyphEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }))
      } else {
        running.push(animate(breathEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }))
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
      }
    } else {
      if (glyphEl) {
        running.push(animate(glyphEl, { opacity: GLYPH_DONE }, { duration: settleSeconds, ease: EASE_OUT }))
      }
      running.push(animate(breathEl, { opacity: 1 }, { duration: settleSeconds, ease: EASE_OUT }))
    }
    return () => {
      cancelled = true
      running.forEach((control) => control.stop())
    }
  }, [working, period, depth, trough, reduceMotion, settle, sheen])

  const visualTransition = `opacity ${settle}ms cubic-bezier(0.23,1,0.32,1), filter ${settle}ms cubic-bezier(0.23,1,0.32,1)`

  const labelStack = (
    <span className="inline-grid min-w-0" aria-hidden="true">
      <span
        className="w-max [grid-area:1/1]"
        style={{
          opacity: working ? 1 : 0,
          filter: working ? "blur(0)" : `blur(${SETTLE_BLUR}px)`,
          transition: visualTransition,
        }}
      >
        <span
          ref={breathRef}
          className="inline-block"
          style={working && sheen
            ? {
                backgroundImage:
                  "linear-gradient(100deg, color-mix(in srgb, currentColor 50%, transparent) 30%, currentColor 50%, color-mix(in srgb, currentColor 50%, transparent) 70%)",
                backgroundSize: "250% 100%",
                backgroundPosition: "125% 0",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                WebkitTextFillColor: "transparent",
                animation: `thought-line-shimmer ${SHIMMER_DURATION}s linear infinite`,
              }
            : undefined}
        >
          {label}
        </span>
      </span>
      <span
        className="w-max [grid-area:1/1]"
        style={{
          opacity: working ? 0 : 0.75,
          filter: working ? `blur(${SETTLE_BLUR}px)` : "blur(0)",
          transition: visualTransition,
        }}
      >
        {doneLabel}
      </span>
    </span>
  )

  return (
    <div
      className={cn("group flex w-full flex-col items-start leading-[1.2] font-medium", className)}
      data-working={working ? "" : undefined}
      data-open={open && hasTrace ? "" : undefined}
      style={{
        fontSize: `${fontSize}px`,
        color: "currentColor",
        ...({ "--tl-settle": `${settle}ms` } as CSSProperties),
      }}
    >
      <style>{STYLE}</style>
      <button
        type="button"
        className={cn(
          "relative m-0 inline-flex items-center gap-[0.3em] border-0 bg-transparent p-0 text-left whitespace-nowrap text-inherit outline-none [font:inherit]",
          hasTrace && "cursor-pointer",
        )}
        data-toggle={hasTrace ? "" : undefined}
        aria-expanded={hasTrace ? open : undefined}
        aria-label={hasTrace
          ? `${working ? label : doneLabel}，${open ? "收起" : "展开"}思考过程`
          : (working ? label : doneLabel)}
        tabIndex={hasTrace ? 0 : -1}
        onClick={() => {
          if (hasTrace) setOpen((value) => !value)
        }}
      >
        {glyph !== "none" ? (
          <span
            ref={glyphRef}
            className="mr-[0.2em] inline-flex h-[1.1em] w-[1.1em] flex-none text-foreground/75 [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
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
        {labelStack}
        {hasTrace ? (
          <span
            className={cn(
              "ml-[0.1em] inline-flex opacity-55 transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden="true"
          >
            <ChevronDown size="1em" strokeWidth={2.2} />
          </span>
        ) : null}
        <span className="sr-only" role="status">
          {working ? label : doneLabel}
        </span>
      </button>
      {hasTrace ? (
        <div
          className="grid w-full [grid-template-rows:0fr] data-[open]:[grid-template-rows:1fr]"
          data-open={open ? "" : undefined}
          aria-hidden={!open}
          style={{
            gridTemplateRows: open ? "1fr" : "0fr",
            transition: `grid-template-rows ${settle}ms cubic-bezier(0.23,1,0.32,1)`,
          }}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="pt-2 pb-1 pl-6 pr-1">{children}</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
