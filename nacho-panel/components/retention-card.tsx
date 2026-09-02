"use client"

import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react"
import { AnimatedNumber } from "@/components/animated-number"
import { useServerData, type LogEntry } from "@/components/server-data-context"
import { formatLogDateTime } from "@/lib/formatters"

type AlertLevel = "critical" | "warning" | "info" | "resolved"

type Alert = {
  id: string
  level: AlertLevel
  device: string
  message: string
  time: string
}

function toAlert(log: LogEntry): Alert {
  return {
    id: log.id,
    level: log.level === "error" ? "critical" : log.level === "warn" ? "warning" : "info",
    device: log.source,
    message: log.message,
    time: formatLogDateTime(log.ts),
  }
}

const levelConfig: Record<AlertLevel, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  critical: { icon: XCircle, color: "#ef4444", bg: "rgba(239,68,68,0.12)", label: "严重" },
  warning:  { icon: AlertTriangle, color: "#dce02d", bg: "rgba(220,224,45,0.12)", label: "警告" },
  info:     { icon: Clock, color: "oklch(0.82 0.19 145)", bg: "oklch(0.82 0.19 145 / 12%)", label: "提示" },
  resolved: { icon: CheckCircle2, color: "oklch(0.55 0.1 150)", bg: "oklch(0.55 0.1 150 / 12%)", label: "已处理" },
}

export function RetentionCard() {
  const { logs } = useServerData()
  const alerts = logs.map(toAlert)
  const critical = alerts.filter((a) => a.level === "critical").length
  const warning = alerts.filter((a) => a.level === "warning").length

  return (
    <div
      className="card-glow flex h-full w-full flex-col rounded-3xl bg-card p-6"
      style={{ fontFamily: 'var(--font-outfit), sans-serif' }}
    >
      {/* 头部 */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">系统日志</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">System Logs</p>
        </div>
      </div>

      {/* 统计徽标 */}
      <div className="mt-4 flex gap-3">
        <span
          className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: levelConfig.critical.bg, color: levelConfig.critical.color }}
        >
          <XCircle className="h-3.5 w-3.5" />
          严重 <AnimatedNumber value={critical} />
        </span>
        <span
          className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: levelConfig.warning.bg, color: levelConfig.warning.color }}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          警告 <AnimatedNumber value={warning} delay={150} />
        </span>
      </div>

      {/* 告警列表 */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2 overflow-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'oklch(0.35 0.02 150) transparent' }}>
        {alerts.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center text-muted-foreground">
            <Clock className="h-7 w-7 opacity-60" />
            <p className="text-sm">暂无系统日志</p>
          </div>
        )}
        {alerts.map((alert) => {
          const cfg = levelConfig[alert.level]
          const Icon = cfg.icon
          return (
            <div
              key={alert.id}
              className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-surface"
              style={{ background: cfg.bg }}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ background: `${cfg.color}22`, color: cfg.color }}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{alert.message}</p>
                <p className="text-xs text-muted-foreground">{alert.device}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: cfg.bg, color: cfg.color }}
                >
                  {cfg.label}
                </span>
                <span className="text-[10px] text-muted-foreground">{alert.time}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
