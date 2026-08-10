"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  AlertTriangle,
  Bug,
  ChevronDown,
  CircleAlert,
  Info,
  Search,
  Server,
  ListFilter,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useLogs } from "./logs-context"

/* 通用面板外壳：与健康/脚本/任务面板保持一致 */
function PanelShell({
  title,
  desc,
  action,
  children,
  className,
}: {
  title: string
  desc: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("card-glow flex w-full flex-col overflow-hidden rounded-3xl bg-card p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
        </div>
        {action}
      </div>
      <div className="mt-5 min-h-0 flex-1">{children}</div>
    </div>
  )
}

/* ---------- 级别元数据 ---------- */
type Level = "error" | "warn" | "info" | "debug"

const levelMeta: Record<
  Level,
  { label: string; icon: typeof Info; text: string; bg: string; border: string; dot: string }
> = {
  error: {
    label: "ERROR",
    icon: CircleAlert,
    text: "text-negative",
    bg: "bg-negative/15",
    border: "border-negative/40",
    dot: "bg-negative",
  },
  warn: {
    label: "WARN",
    icon: AlertTriangle,
    text: "text-warning",
    bg: "bg-warning/15",
    border: "border-warning/40",
    dot: "bg-warning",
  },
  info: {
    label: "INFO",
    icon: Info,
    text: "text-primary",
    bg: "bg-primary/12",
    border: "border-primary/30",
    dot: "bg-primary",
  },
  debug: {
    label: "DEBUG",
    icon: Bug,
    text: "text-muted-foreground",
    bg: "bg-surface",
    border: "border-border",
    dot: "bg-muted-foreground/60",
  },
}

const levelOrder: Level[] = ["error", "warn", "info", "debug"]

/* ---------- 来源：由服务端日志动态提供，面板不再内置模拟来源 ---------- */
const sources: readonly string[] = []
type Source = string

/* ---------- 数据模型 ---------- */
type LogEntry = {
  id: string
  time: string
  ts: number
  level: Level
  source: Source
  message: string
  detail?: string
}

/* 时间格式化 HH:MM:SS.mmm */
function fmt(ts: number) {
  const d = new Date(ts)
  const p = (n: number, l = 2) => String(n).padStart(l, "0")
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/* ---------- 初始日志：由服务端 API 获取，面板不再内置模拟数据 ---------- */
function makeInitial(): LogEntry[] {
  return []
}

/* ---------- 实时日志候选：由服务端实时推送，面板不再内置模拟数据 ---------- */
const liveCandidates: Omit<LogEntry, "id" | "time" | "ts">[] = []

/* 统计卡片 */
function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  tone: "primary" | "negative" | "warning" | "muted"
}) {
  const toneCls = {
    primary: "text-primary bg-primary/12",
    negative: "text-negative bg-negative/15",
    warning: "text-warning bg-warning/15",
    muted: "text-muted-foreground bg-surface",
  }[tone]
  return (
    <div className="card-glow flex items-center gap-4 rounded-3xl bg-card p-5">
      <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", toneCls)}>{icon}</span>
      <div className="leading-tight">
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

export function LogsView() {
  const logsCtx = useLogs()
  // 实时跟随状态由顶栏功能区共享控制（暂停/继续按钮已移入顶栏）
  const live = logsCtx?.live ?? true
  // 初始为空，挂载后（仅客户端）再生成基于 Date.now() 的演示数据，
  // 避免服务端/客户端时间戳不一致导致的水合失败（hydration mismatch）
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [levelFilter, setLevelFilter] = useState<"all" | Level>("all")
  const [sourceFilter, setSourceFilter] = useState<"all" | Source>("all")
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
  const counterRef = useRef(0)

  /* 挂载后在客户端生成初始演示数据（避免 SSR 时间戳不一致） */
  useEffect(() => {
    setLogs(makeInitial())
  }, [])

  /* 实时跟随：定时向列表头部追加一条随机日志 */
  useEffect(() => {
    if (!live || liveCandidates.length === 0) return
    const timer = setInterval(() => {
      const pick = liveCandidates[Math.floor(Math.random() * liveCandidates.length)]
      const ts = Date.now()
      counterRef.current += 1
      const entry: LogEntry = { ...pick, id: `log-${ts}-${counterRef.current}`, ts, time: fmt(ts) }
      setLogs((prev) => [entry, ...prev].slice(0, 200))
      setFlashId(entry.id)
      setTimeout(() => setFlashId((cur) => (cur === entry.id ? null : cur)), 900)
    }, 2600)
    return () => clearInterval(timer)
  }, [live])

  /* 统计 */
  const stats = useMemo(() => {
    const now = Date.now()
    const lastMin = logs.filter((l) => now - l.ts <= 60_000).length
    return {
      total: logs.length,
      error: logs.filter((l) => l.level === "error").length,
      warn: logs.filter((l) => l.level === "warn").length,
      rate: lastMin,
    }
  }, [logs])

  const q = query.trim().toLowerCase()
  const filtered = logs.filter(
    (l) =>
      (levelFilter === "all" || l.level === levelFilter) &&
      (sourceFilter === "all" || l.source === sourceFilter) &&
      (q === "" || l.message.toLowerCase().includes(q) || l.source.toLowerCase().includes(q)),
  )

  const levelChips: { id: "all" | Level; label: string }[] = [
    { id: "all", label: "全部级别" },
    ...levelOrder.map((l) => ({ id: l, label: levelMeta[l].label })),
  ]

  const clearLogs = () => {
    setLogs([])
    setExpanded(null)
  }

  const exportLogs = () => {
    const text = [...filtered]
      .reverse()
      .map((l) => `[${l.time}] ${levelMeta[l.level].label.padEnd(5)} ${l.source} - ${l.message}`)
      .join("\n")
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `system-logs-${Date.now()}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* 向顶栏功能区注册导出/清空的具体实现（每次渲染刷新，确保闭包捕获最新 filtered/logs） */
  useEffect(() => {
    logsCtx?.registerHandlers({ exportLogs, clearLogs })
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pr-1">
      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<Activity className="h-6 w-6" />} label="日志总条数" value={stats.total} tone="primary" />
        <StatCard icon={<CircleAlert className="h-6 w-6" />} label="错误 ERROR" value={stats.error} tone="negative" />
        <StatCard icon={<AlertTriangle className="h-6 w-6" />} label="警告 WARN" value={stats.warn} tone="warning" />
        <StatCard icon={<Server className="h-6 w-6" />} label="近 1 分钟" value={`${stats.rate} 条`} tone="muted" />
      </div>

      {/* 日志控制台 */}
      <PanelShell
        title="实时日志控制台"
        desc="聚合客户端与服务端运行日志，可按级别、来源筛选并全文检索。"
        action={
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
              live ? "bg-primary/12 text-primary" : "bg-surface text-muted-foreground",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", live ? "animate-pulse bg-primary" : "bg-muted-foreground/60")} />
            {live ? "实时跟随中" : "已暂停"}
          </span>
        }
      >
        {/* 筛选条 */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {levelChips.map((c) => {
              const active = levelFilter === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setLevelFilter(c.id)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all duration-200",
                    active
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                      : "border border-border bg-surface/60 text-muted-foreground hover:bg-surface hover:text-foreground",
                  )}
                >
                  {c.id !== "all" && <span className={cn("h-1.5 w-1.5 rounded-full", levelMeta[c.id as Level].dot)} />}
                  {c.label}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex h-8 items-center gap-1 pr-1 text-xs text-muted-foreground">
              <ListFilter className="h-3.5 w-3.5" />
              来源
            </span>
            <button
              type="button"
              onClick={() => setSourceFilter("all")}
              className={cn(
                "flex h-8 items-center rounded-full px-3 text-xs font-medium transition-all duration-200",
                sourceFilter === "all"
                  ? "bg-accent text-accent-foreground"
                  : "border border-border bg-surface/60 text-muted-foreground hover:bg-surface hover:text-foreground",
              )}
            >
              全部来源
            </button>
            {sources.map((s) => {
              const active = sourceFilter === s
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSourceFilter(s)}
                  className={cn(
                    "flex h-8 items-center rounded-full px-3 text-xs font-medium transition-all duration-200",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "border border-border bg-surface/60 text-muted-foreground hover:bg-surface hover:text-foreground",
                  )}
                >
                  {s}
                </button>
              )
            })}
          </div>

          {/* 搜索 */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="全文检索日志内容或来源"
              className="h-11 w-full rounded-xl border border-border bg-surface/60 pl-11 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:bg-surface"
            />
          </div>
        </div>

        {/* 日志列表 */}
        <div ref={listRef} className="mt-4 flex max-h-[52vh] flex-col gap-1.5 overflow-auto pr-1">
          {filtered.length > 0 ? (
            filtered.map((l) => {
              const meta = levelMeta[l.level]
              const open = expanded === l.id
              const hasDetail = Boolean(l.detail)
              return (
                <div
                  key={l.id}
                  className={cn(
                    "rounded-xl border bg-surface/40 transition-all duration-300",
                    meta.border,
                    flashId === l.id && "ring-2 ring-primary/50",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => hasDetail && setExpanded(open ? null : l.id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2.5 text-left",
                      hasDetail ? "cursor-pointer" : "cursor-default",
                    )}
                  >
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{l.time}</span>
                    <span
                      className={cn(
                        "flex w-16 shrink-0 items-center justify-center gap-1 rounded-md py-0.5 text-[11px] font-semibold",
                        meta.bg,
                        meta.text,
                      )}
                    >
                      {meta.label}
                    </span>
                    <span className="hidden w-36 shrink-0 items-center gap-1 truncate font-mono text-xs text-muted-foreground sm:flex">
                      <Server className="h-3 w-3 shrink-0" />
                      <span className="truncate">{l.source}</span>
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{l.message}</span>
                    {hasDetail && (
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300",
                          open && "rotate-180",
                        )}
                      />
                    )}
                  </button>
                  {hasDetail && (
                    <div
                      className="overflow-hidden transition-all duration-300 ease-out"
                      style={{ maxHeight: open ? "120px" : "0px", opacity: open ? 1 : 0 }}
                    >
                      <p className="border-t border-border px-3 py-2.5 pl-[92px] font-mono text-xs leading-relaxed text-muted-foreground">
                        {l.detail}
                      </p>
                    </div>
                  )}
                </div>
              )
            })
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Info className="h-8 w-8" />
              <p className="text-sm">当前筛选条件下暂无日志记录</p>
            </div>
          )}
        </div>
      </PanelShell>
    </div>
  )
}
