"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export const DEPLOYMENT_STAGE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)"

export type InstallationOutputChunk = { id: number; content: string }

export function DeploymentStagePanel({
  stage,
  active,
  compact = false,
  children,
}: {
  stage: "setup" | "install" | "installed"
  active: boolean
  compact?: boolean
  children: ReactNode
}) {
  return (
    <div
      data-local-control-stage={stage}
      data-active={active}
      aria-hidden={!active}
      inert={!active}
      className={cn("grid motion-reduce:transition-none", !active && "pointer-events-none")}
      style={{
        gridTemplateRows: active ? "1fr" : "0fr",
        transition: `grid-template-rows 720ms ${DEPLOYMENT_STAGE_EASE}`,
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn("flex flex-col motion-reduce:transition-none", compact ? "gap-4" : "gap-5")}
          style={{
            opacity: active ? 1 : 0,
            filter: active ? "blur(0px)" : "blur(14px)",
            transform: active ? "translateY(0) scale(1)" : "translateY(8px) scale(0.975)",
            transition: `opacity 440ms ease ${active ? "160ms" : "0ms"}, filter 520ms ease ${active ? "160ms" : "0ms"}, transform 620ms ${DEPLOYMENT_STAGE_EASE} ${active ? "140ms" : "0ms"}`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function InstallationOutputLine({ chunk }: { chunk: InstallationOutputChunk }) {
  const lineRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const element = lineRef.current
    if (!element) return

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const animation = element.animate(
      reducedMotion
        ? [{ opacity: 0.55 }, { opacity: 1 }]
        : [
            { opacity: 0, filter: "blur(8px)", transform: "translateY(7px)" },
            { opacity: 1, filter: "blur(0px)", transform: "translateY(0)" },
          ],
      {
        duration: reducedMotion ? 160 : 480,
        easing: DEPLOYMENT_STAGE_EASE,
      },
    )

    return () => animation.cancel()
  }, [chunk.id])

  return (
    <span ref={lineRef} className="block max-w-full">
      {chunk.content.replace(/\r?\n$/, "")}
    </span>
  )
}

export function InstallationConsole({
  output,
  active,
  title = "安装命令实时输出",
  placeholder = "[Nacho] 正在准备安装命令…\n",
  inactiveDescription = "安装未完成，可查看下方输出定位问题",
}: {
  output: InstallationOutputChunk[]
  active: boolean
  title?: string
  placeholder?: string
  inactiveDescription?: string
}) {
  const consoleRef = useRef<HTMLPreElement>(null)
  const [consoleHeight, setConsoleHeight] = useState<number | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updateMotionPreference = () => setReducedMotion(media.matches)

    updateMotionPreference()
    media.addEventListener("change", updateMotionPreference)
    return () => media.removeEventListener("change", updateMotionPreference)
  }, [])

  useEffect(() => {
    const element = consoleRef.current
    if (!element) return

    const updateConsoleViewport = () => {
      const minimumHeight = window.matchMedia("(min-width: 640px)").matches ? 288 : 256
      const maximumHeight = 416
      const nextHeight = Math.min(Math.max(element.scrollHeight, minimumHeight), maximumHeight)

      setConsoleHeight(nextHeight)
      requestAnimationFrame(() => {
        element.scrollTo({ top: element.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" })
      })
    }

    updateConsoleViewport()
    window.addEventListener("resize", updateConsoleViewport)
    return () => window.removeEventListener("resize", updateConsoleViewport)
  }, [output, reducedMotion])

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-background/55 shadow-inner">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn("size-2 shrink-0 rounded-full", active ? "animate-pulse bg-emerald-500" : "bg-destructive")} aria-hidden="true" />
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            <p className="truncate text-xs text-muted-foreground" aria-live="polite">
              {active ? "正在执行，请保持此页面打开" : inactiveDescription}
            </p>
          </div>
        </div>
        <Badge variant="outline">{active ? "执行中" : "已停止"}</Badge>
      </div>
      <pre
        ref={consoleRef}
        tabIndex={0}
        aria-label={title}
        className="min-h-64 max-h-[26rem] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-72"
        style={{
          height: consoleHeight ?? undefined,
          overflowAnchor: "none",
          scrollbarGutter: "stable",
          transition: reducedMotion ? "none" : `height 460ms ${DEPLOYMENT_STAGE_EASE}`,
        }}
      >
        <code aria-live="polite" aria-relevant="additions text">
          {output.length === 0
            ? placeholder
            : output.map((chunk) => <InstallationOutputLine key={chunk.id} chunk={chunk} />)}
        </code>
      </pre>
    </section>
  )
}
