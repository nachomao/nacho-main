"use client"

import { useEffect, useState } from "react"
import { Clock3, RotateCcw, ShieldAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AIChatTimer } from "@/lib/ai/chat-events"
import { activeTimerElapsedMs, formatTimerDuration } from "@/lib/ai/task-timer"

function timerText(timer: AIChatTimer, elapsedSeconds: number, due: boolean) {
  const total = formatTimerDuration(timer.afterSeconds)
  const remaining = formatTimerDuration(Math.max(0, timer.afterSeconds - elapsedSeconds))
  const label = (timer.label || timer.reminder || "检查任务进度").replace(/\s+/g, " ").trim()
  if (timer.state === "wake-failed") return "计时器到期，但 AI 引擎仍忙碌"
  if (timer.state === "canceled") return "计时器已取消"
  if (timer.state === "fired") return "计时器已触发 · AI 正在检查进度…"
  if (timer.pausedAt !== undefined) return "等待人工确认 · 计时暂停"
  if (due) return "已到检查点 · 等待当前工具结束"
  return `${timer.fallback ? "默认检查点" : "AI 计时器"} ${remaining} · ${label}`
}

export function TaskTimerLine({
  timer,
  capReached,
  live,
  done,
  onRestart,
}: {
  timer?: AIChatTimer
  capReached?: boolean
  live: boolean
  done: boolean
  onRestart?: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const state = timer?.state
  const paused = timer?.pausedAt !== undefined
  const tick = live && !done && !paused && (state === "set" || state === "waiting")

  useEffect(() => {
    if (!tick) return undefined
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [tick, state, paused])

  if (!timer && !capReached) return null
  if (done && state !== "wake-failed" && !capReached) return null
  if (!timer && !capReached) return null

  if (capReached) {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-negative/30 bg-negative/5 px-2.5 py-1.5 text-[11px] text-negative">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {done ? "已达到 2 小时安全上限 · 已停止" : "已达到 2 小时安全上限 · 正在总结"}
        </span>
      </div>
    )
  }

  const elapsedSeconds = timer ? activeTimerElapsedMs(timer, now) / 1_000 : 0
  const due = timer ? elapsedSeconds >= timer.afterSeconds && timer.state === "waiting" : false
  const total = timer?.afterSeconds ?? 0
  const percent = total > 0 ? Math.min(100, Math.max(0, (elapsedSeconds / total) * 100)) : 0
  const failed = timer?.state === "wake-failed"
  const muted = timer?.state === "canceled"
  const text = timer ? timerText(timer, elapsedSeconds, due) : ""
  const showBar = timer && (timer.state === "set" || timer.state === "waiting") && !done

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-lg border px-2.5 py-1.5 text-[11px]",
        failed
          ? "border-negative/35 bg-negative/5 text-negative"
          : due
            ? "border-warning/35 bg-warning/5 text-warning"
            : muted
              ? "border-border/50 bg-foreground/[0.02] text-muted-foreground/60"
              : "border-border/60 bg-foreground/[0.03] text-muted-foreground",
      )}
      title={timer?.reminder || undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Clock3 className="h-3.5 w-3.5 shrink-0" />
        <span className={cn("min-w-0 flex-1 truncate", failed && "font-medium")}>{text}</span>
        {failed && onRestart ? (
          <button
            type="button"
            onClick={onRestart}
            className="flex shrink-0 items-center gap-1 rounded-md border border-negative/40 bg-negative/10 px-2 py-0.5 text-[10px] font-medium text-negative transition-colors hover:bg-negative/20"
            title="会丢失该会话的模型上下文，界面历史保留"
          >
            <RotateCcw className="h-3 w-3" />
            重启 AI 引擎
          </button>
        ) : null}
      </div>
      {showBar ? (
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-border/50">
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", due ? "bg-warning" : "bg-primary/70")}
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
    </div>
  )
}
