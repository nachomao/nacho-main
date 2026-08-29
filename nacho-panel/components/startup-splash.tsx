"use client"

import { AlertTriangle, Loader2, RefreshCw, Settings2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useId, useState } from "react"
import { useServerData } from "@/components/server-data-context"
import { useStartupMotion } from "@/components/startup-motion-context"
import { useOnboarding } from "@/components/onboarding/onboarding-context"

const EASE = "cubic-bezier(0.32, 0.72, 0.24, 1)"

function StartupN({ onDrawn }: { onDrawn: () => void }) {
  const [drawing, setDrawing] = useState(false)
  const uid = useId().replace(/:/g, "")
  const block = `${uid}-startup-block`
  const diagonal = `${uid}-startup-diagonal`

  useEffect(() => {
    const start = window.setTimeout(() => setDrawing(true), 120)
    const done = window.setTimeout(onDrawn, 1_420)
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(done)
    }
  }, [onDrawn])

  return (
    <svg
      viewBox="0 0 44 44"
      fill="none"
      aria-hidden
      shapeRendering="geometricPrecision"
      className="h-[210px] w-[210px]"
    >
      <defs>
        <linearGradient id={block} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="oklch(1 0 0)" />
          <stop offset="100%" stopColor="oklch(0.85 0 0)" />
        </linearGradient>
        <linearGradient id={diagonal} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="oklch(0.7 0 0)" />
          <stop offset="100%" stopColor="oklch(0.5 0 0)" />
        </linearGradient>
      </defs>

      <polygon
        points="17,9 26,20.7 17,20.7"
        fill={`url(#${diagonal})`}
        style={{
          opacity: drawing ? 1 : 0,
          transform: drawing ? "translateY(0)" : "translateY(3px)",
          transformBox: "fill-box",
          transformOrigin: "center",
          transition: `opacity 520ms ease-out 600ms, transform 520ms ${EASE} 600ms`,
        }}
      />
      <polygon
        points="18,23.3 27,23.3 27,35"
        fill={`url(#${diagonal})`}
        style={{
          opacity: drawing ? 1 : 0,
          transform: drawing ? "translateY(0)" : "translateY(3px)",
          transformBox: "fill-box",
          transformOrigin: "center",
          transition: `opacity 520ms ease-out 690ms, transform 520ms ${EASE} 690ms`,
        }}
      />
      <rect
        x="8"
        y="7"
        width="8"
        height="30"
        rx="3"
        fill={`url(#${block})`}
        style={{
          clipPath: drawing ? "inset(0 0 0 0)" : "inset(100% 0 0 0)",
          transition: `clip-path 860ms ${EASE}`,
        }}
      />
      <rect
        x="28"
        y="7"
        width="8"
        height="30"
        rx="3"
        fill={`url(#${block})`}
        style={{
          clipPath: drawing ? "inset(0 0 0 0)" : "inset(0 0 100% 0)",
          transition: `clip-path 860ms ${EASE} 120ms`,
        }}
      />
      <rect x="8" y="7" width="8" height="5" rx="3" fill="white" fillOpacity="0.15" opacity={drawing ? 1 : 0} />
      <rect x="28" y="7" width="8" height="5" rx="3" fill="white" fillOpacity="0.15" opacity={drawing ? 1 : 0} />
    </svg>
  )
}

export function StartupSplash() {
  const { overview, error, refresh } = useServerData()
  const { release } = useStartupMotion()
  const { hydrated, auth } = useOnboarding()
  const router = useRouter()
  const [markDrawn, setMarkDrawn] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [hidden, setHidden] = useState(false)
  const handleMarkDrawn = useCallback(() => setMarkDrawn(true), [])

  const openConnectionSettings = useCallback(() => {
    setLeaving(true)
    release()
    router.push("/settings?tab=connection")
    window.setTimeout(() => setHidden(true), 1_050)
  }, [release, router])

  useEffect(() => {
    if (!hydrated || auth) return
    release()
    setHidden(true)
  }, [auth, hydrated, release])

  useEffect(() => {
    if (!markDrawn || !overview) return
    setLeaving(true)
    release()
    const timer = window.setTimeout(() => setHidden(true), 1_050)
    return () => window.clearTimeout(timer)
  }, [markDrawn, overview, release])

  if (hidden || (hydrated && !auth)) return null

  // 等待本地存储恢复期间只遮住底层首帧，不启动 N 动画。
  if (!hydrated) {
    return <div className="fixed inset-0 z-[200] bg-background" aria-hidden />
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="NachoPanel 正在连接服务端"
      className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden bg-background"
      style={{
        opacity: leaving ? 0 : 1,
        filter: leaving ? "blur(8px)" : "blur(0px)",
        transition: `opacity 1000ms ${EASE}, filter 1000ms ${EASE}`,
        pointerEvents: leaving ? "none" : "auto",
      }}
    >
      <div className="flex min-h-[310px] flex-col items-center justify-center">
        <StartupN onDrawn={handleMarkDrawn} />

        <div
          className="mt-5 flex min-h-16 flex-col items-center justify-start gap-3 text-center"
          style={{
            opacity: markDrawn ? 1 : 0,
            transform: markDrawn ? "translateY(0)" : "translateY(8px)",
            transition: `opacity 360ms ease, transform 420ms ${EASE}`,
          }}
        >
          {error ? (
            <>
              <div className="flex max-w-md items-center gap-2 text-sm text-negative">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="flex h-10 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <RefreshCw className="h-4 w-4" />
                  重新连接
                </button>
                <button
                  type="button"
                  onClick={openConnectionSettings}
                  className="flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:brightness-105"
                >
                  <Settings2 className="h-4 w-4" />
                  连接设置
                </button>
              </div>
            </>
          ) : !overview ? (
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>正在连接服务端</span>
              </div>
              <button
                type="button"
                onClick={openConnectionSettings}
                className="flex h-10 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Settings2 className="h-4 w-4" />
                连接设置
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
