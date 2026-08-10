"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ChevronDown,
  CircleAlert,
  Download,
  FileArchive,
  Info,
  Loader2,
  MonitorCheck,
  Package,
  RefreshCw,
  RotateCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Siren,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { logSources } from "@/lib/collect-logs"
import { useServerData } from "@/components/server-data-context"

/* 通用面板外壳：与脚本/任务面板保持一致 */
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

/* ---------- 严重级别元数据 ---------- */
type Severity = "critical" | "error" | "warning" | "info"

const severityMeta: Record<
  Severity,
  { label: string; icon: typeof Siren; text: string; bg: string; border: string; dot: string }
> = {
  critical: {
    label: "严重",
    icon: Siren,
    text: "text-negative",
    bg: "bg-negative/15",
    border: "border-negative/40",
    dot: "bg-negative",
  },
  error: {
    label: "错误",
    icon: ShieldAlert,
    text: "text-warning",
    bg: "bg-warning/15",
    border: "border-warning/40",
    dot: "bg-warning",
  },
  warning: {
    label: "警告",
    icon: AlertTriangle,
    text: "text-warning",
    bg: "bg-warning/10",
    border: "border-warning/25",
    dot: "bg-warning/70",
  },
  info: {
    label: "信息",
    icon: Info,
    text: "text-primary",
    bg: "bg-primary/12",
    border: "border-primary/30",
    dot: "bg-primary",
  },
}

const severityOrder: Severity[] = ["critical", "error", "warning", "info"]

/* ---------- 类别 ---------- */
const categories = ["系统日志", "应用崩溃", "安全审计", "磁盘存储", "网络连接", "服务异常"] as const
type Category = (typeof categories)[number]

/* ---------- 数据模型 ---------- */
type Finding = {
  id: string
  host: string
  severity: Severity
  category: Category
  title: string
  detail: string
  time: string
  read: boolean
}

type LogPackage = {
  id: string
  host: string
  category: Category
  sizeMB: number
  time: string
  findings: number
  status: "analyzed" | "analyzing" | "pending"
}

type CollectClient = {
  id: string
  name: string
  ip: string
  os: string
  online: boolean
}

/* 服务端 /health/findings 的行结构：category 为自由字符串，time 由 ts 派生 */
type ServerFinding = {
  id: string
  host: string
  severity: Severity
  category: string
  title: string
  detail?: string | null
  ts: number
  read: boolean | number
}

type ServerPackage = {
  id: string
  host: string
  category: string
  sizeMB: number
  ts: number
  findings: number
  status: LogPackage["status"]
}

/* 相对时间：服务端只给时间戳，展示层统一转成「刚刚 / N 分钟前」 */
function relTime(ts: number) {
  const diff = Date.now() - ts
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

/* 服务端 category 是自由文本，落到面板固定类别上，未知值归入「系统日志」 */
function toCategory(value: string): Category {
  return (categories as readonly string[]).includes(value) ? (value as Category) : "系统日志"
}

/* 统计卡片 */
function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number
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

export function HealthView() {
  const { apiRequest, clients } = useServerData()
  const [findings, setFindings] = useState<Finding[]>([])
  const [packages, setPackages] = useState<LogPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reanalyzing, setReanalyzing] = useState<string[]>([])

  /* 采集目标来自真实客户端列表：日志采集仅支持 Windows Agent */
  const collectClients: CollectClient[] = useMemo(
    () =>
      clients
        .filter((c) => c.os === "Windows")
        .map((c) => ({ id: c.id, name: c.name, ip: c.ip, os: c.osName || c.os, online: c.status === "online" })),
    [clients],
  )

  /* 从服务端拉取发现项与日志包 */
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [findingRows, packageRows] = await Promise.all([
        apiRequest<ServerFinding[]>("/health/findings"),
        apiRequest<ServerPackage[]>("/health/packages"),
      ])
      setFindings(
        findingRows.map((f) => ({
          id: f.id,
          host: f.host,
          severity: f.severity,
          category: toCategory(f.category),
          title: f.title,
          detail: f.detail ?? "",
          time: relTime(f.ts),
          read: Boolean(f.read),
        })),
      )
      setPackages(
        packageRows.map((p) => ({
          id: p.id,
          host: p.host,
          category: toCategory(p.category),
          sizeMB: p.sizeMB,
          time: relTime(p.ts),
          findings: p.findings,
          status: p.status,
        })),
      )
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载健康数据失败")
    } finally {
      setLoading(false)
    }
  }, [apiRequest])

  useEffect(() => {
    void load()
  }, [load])

  /* 筛选：级别 + 类别 */
  const [levelFilter, setLevelFilter] = useState<"all" | Severity>("all")
  const [catFilter, setCatFilter] = useState<"all" | Category>("all")

  /* 日志包搜索 */
  const [query, setQuery] = useState("")

  /* 采集目标 */
  const [listOpen, setListOpen] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [collecting, setCollecting] = useState(false)

  /* 展开查看的发现项 */
  const [expanded, setExpanded] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)

  /* 统计 */
  const stats = useMemo(
    () => ({
      unread: findings.filter((f) => !f.read).length,
      critical: findings.filter((f) => f.severity === "critical").length,
      error: findings.filter((f) => f.severity === "error").length,
      packages: packages.length,
    }),
    [findings, packages],
  )

  const filteredFindings = findings.filter(
    (f) => (levelFilter === "all" || f.severity === levelFilter) && (catFilter === "all" || f.category === catFilter),
  )

  const q = query.trim().toLowerCase()
  const filteredPackages = packages.filter(
    (p) => q === "" || p.host.toLowerCase().includes(q) || p.category.toLowerCase().includes(q),
  )

  const onlineIds = collectClients.filter((c) => c.online).map((c) => c.id)
  const allOnlineSelected = onlineIds.length > 0 && onlineIds.every((id) => selected.includes(id))
  const selectedOnline = selected.filter((id) => onlineIds.includes(id))

  const toggleClient = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const toggleAllOnline = () =>
    setSelected((s) => (allOnlineSelected ? s.filter((id) => !onlineIds.includes(id)) : Array.from(new Set([...s, ...onlineIds]))))

  /* 标记已读：本地先行反馈，失败则回滚并提示（读状态持久化在服务端） */
  const markRead = async (id: string) => {
    setFindings((list) => list.map((f) => (f.id === id ? { ...f, read: true } : f)))
    try {
      await apiRequest(`/health/findings/${id}/read`, { method: "POST" })
    } catch (caught) {
      setFindings((list) => list.map((f) => (f.id === id ? { ...f, read: false } : f)))
      setActionError(caught instanceof Error ? caught.message : "标记已读失败")
    }
  }

  const markAllRead = async () => {
    const before = findings
    setFindings((list) => list.map((f) => ({ ...f, read: true })))
    try {
      await apiRequest("/health/findings/read-all", { method: "POST" })
    } catch (caught) {
      setFindings(before)
      setActionError(caught instanceof Error ? caught.message : "全部标记已读失败")
    }
  }

  /* 采集窗口：最近 24 小时，与单机日志采集面板使用同一套受限来源与条数上限 */
  const collectPayload = () => {
    const until = new Date()
    const since = new Date(until.getTime() - 24 * 60 * 60 * 1000)
    return {
      sources: [...logSources],
      sinceUtc: since.toISOString(),
      untilUtc: until.toISOString(),
      maxEntries: 500,
    }
  }

  /* 主动采集：向选中的在线客户端下发真实 collect-logs 命令 */
  const handleCollect = async () => {
    if (selectedOnline.length === 0 || collecting) return
    setCollecting(true)
    setActionError(null)
    try {
      await Promise.all(
        selectedOnline.map((id) =>
          apiRequest(`/clients/${encodeURIComponent(id)}/commands`, {
            method: "POST",
            body: JSON.stringify({ type: "collect-logs", payload: collectPayload() }),
          }),
        ),
      )
      // 命令已入队，结果由 Agent 回传后写入服务端；重新拉取以反映最新状态
      await load()
      setSelected([])
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "下发日志采集命令失败")
    } finally {
      setCollecting(false)
    }
  }

  /* 重新采集：对该日志包所属主机重新下发一次 collect-logs */
  const reanalyze = async (id: string) => {
    if (reanalyzing.includes(id)) return
    const pkg = packages.find((p) => p.id === id)
    const target = pkg && collectClients.find((c) => c.name === pkg.host || c.id === pkg.host)
    if (!target) {
      setActionError(`未找到日志包所属的在线客户端：${pkg?.host ?? id}`)
      return
    }
    if (!target.online) {
      setActionError(`客户端 ${target.name} 当前离线，采集命令尚未下发`)
      return
    }
    setReanalyzing((r) => [...r, id])
    setActionError(null)
    try {
      await apiRequest(`/clients/${encodeURIComponent(target.id)}/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "collect-logs", payload: collectPayload() }),
      })
      await load()
      setFlashId(id)
      setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1200)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "重新采集失败")
    } finally {
      setReanalyzing((r) => r.filter((x) => x !== id))
    }
  }

  const levelChips: { id: "all" | Severity; label: string }[] = [
    { id: "all", label: "全部级别" },
    ...severityOrder.map((s) => ({ id: s, label: severityMeta[s].label })),
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pr-1">
      {/* 加载失败：整页数据不可用时提供重试入口 */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-negative/30 bg-negative/10 px-4 py-3 text-xs leading-relaxed text-negative">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => void load()} className="flex shrink-0 items-center gap-1 font-medium underline">
            <RotateCw className="h-3 w-3" />
            重试
          </button>
        </div>
      )}

      {/* 写操作失败：不影响已加载的数据 */}
      {actionError && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-relaxed text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="shrink-0 font-medium underline">
            知道了
          </button>
        </div>
      )}

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<CircleAlert className="h-6 w-6" />} label="未读异常" value={stats.unread} tone="primary" />
        <StatCard icon={<Siren className="h-6 w-6" />} label="严重命中" value={stats.critical} tone="negative" />
        <StatCard icon={<ShieldAlert className="h-6 w-6" />} label="错误命中" value={stats.error} tone="warning" />
        <StatCard icon={<Package className="h-6 w-6" />} label="日志包" value={stats.packages} tone="muted" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 左列：健康发现项 + 日志包 */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* 健康发现项 */}
          <PanelShell
            title="健康发现项"
            desc="按客户端、严重级别和类别查看服务端分析结果。"
            action={
              stats.unread > 0 ? (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface/60 px-4 text-xs font-medium text-foreground transition-colors hover:bg-surface"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  全部标记已读
                </button>
              ) : (
                <span className="flex h-9 items-center gap-1.5 rounded-full bg-primary/12 px-3 text-xs font-medium text-primary">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  无未读
                </span>
              )
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
                      {c.id !== "all" && <span className={cn("h-1.5 w-1.5 rounded-full", severityMeta[c.id as Severity].dot)} />}
                      {c.label}
                    </button>
                  )
                })}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCatFilter("all")}
                  className={cn(
                    "flex h-8 items-center rounded-full px-3 text-xs font-medium transition-all duration-200",
                    catFilter === "all"
                      ? "bg-accent text-accent-foreground"
                      : "border border-border bg-surface/60 text-muted-foreground hover:bg-surface hover:text-foreground",
                  )}
                >
                  全部类别
                </button>
                {categories.map((cat) => {
                  const active = catFilter === cat
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCatFilter(cat)}
                      className={cn(
                        "flex h-8 items-center rounded-full px-3 text-xs font-medium transition-all duration-200",
                        active
                          ? "bg-accent text-accent-foreground"
                          : "border border-border bg-surface/60 text-muted-foreground hover:bg-surface hover:text-foreground",
                      )}
                    >
                      {cat}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 发现项列表 */}
            <div className="mt-4 flex flex-col gap-2.5">
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <p className="text-sm">正在从服务端加载发现项…</p>
                </div>
              ) : filteredFindings.length > 0 ? (
                filteredFindings.map((f) => {
                  const meta = severityMeta[f.severity]
                  const SevIcon = meta.icon
                  const open = expanded === f.id
                  return (
                    <div
                      key={f.id}
                      className={cn(
                        "rounded-2xl border bg-surface/60 transition-all duration-300",
                        f.read ? "border-border" : meta.border,
                        flashId === f.id && "ring-2 ring-primary/50",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setExpanded(open ? null : f.id)
                          if (!f.read) void markRead(f.id)
                        }}
                        className="flex w-full items-start gap-3 px-4 py-3.5 text-left"
                      >
                        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", meta.bg)}>
                          <SevIcon className={cn("h-5 w-5", meta.text)} />
                        </span>
                        <div className="min-w-0 flex-1 leading-tight">
                          <div className="flex flex-wrap items-center gap-2">
                            {!f.read && <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} />}
                            <p className={cn("truncate text-sm", f.read ? "font-medium" : "font-semibold")}>{f.title}</p>
                          </div>
                          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Server className="h-3 w-3" />
                              {f.host}
                            </span>
                            <span className="text-muted-foreground/40">·</span>
                            <span>{f.category}</span>
                            <span className="text-muted-foreground/40">·</span>
                            <span>{f.time}</span>
                          </p>
                        </div>
                        <span
                          className={cn(
                            "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                            meta.bg,
                            meta.text,
                          )}
                        >
                          {meta.label}
                        </span>
                        <ChevronDown
                          className={cn("mt-1.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300", open && "rotate-180")}
                        />
                      </button>
                      {/* 详情展开 */}
                      <div
                        className="overflow-hidden transition-all duration-300 ease-out"
                        style={{ maxHeight: open ? "120px" : "0px", opacity: open ? 1 : 0 }}
                      >
                        <p className="border-t border-border px-4 py-3 pl-16 text-xs leading-relaxed text-muted-foreground">
                          {f.detail}
                        </p>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                  <ShieldCheck className="h-8 w-8" />
                  <p className="text-sm">当前筛选条件下暂无健康发现项</p>
                </div>
              )}
            </div>
          </PanelShell>

          {/* 日志包 */}
          <PanelShell
            title="日志包"
            desc="上传后的 zip 保存在服务端本机，可下载或重新运行内置分析。"
            action={
              <span className="flex h-8 items-center gap-1.5 rounded-full bg-primary/12 px-3 text-xs font-medium text-primary">
                <FileArchive className="h-3.5 w-3.5" />共 {packages.length} 个
              </span>
            }
          >
            {/* 搜索 */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索日志包、主机名或类别"
                className="h-11 w-full rounded-xl border border-border bg-surface/60 pl-11 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:bg-surface"
              />
            </div>

            <div className="mt-4 flex flex-col gap-2.5">
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <p className="text-sm">正在从服务端加载日志包…</p>
                </div>
              ) : filteredPackages.length > 0 ? (
                filteredPackages.map((p) => {
                  // analyzing 取服务端状态，或本地正在下发重新采集命令
                  const analyzing = p.status === "analyzing" || reanalyzing.includes(p.id)
                  return (
                    <div
                      key={p.id}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl border border-border bg-surface/60 px-4 py-3.5 transition-all duration-300",
                        flashId === p.id && "ring-2 ring-primary/50",
                      )}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background/40">
                        <FileArchive className="h-5 w-5 text-muted-foreground" />
                      </span>
                      <div className="min-w-0 flex-1 leading-tight">
                        <p className="truncate text-sm font-medium">{p.host}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span>{p.category}</span>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="tabular-nums">{p.sizeMB} MB</span>
                          <span className="text-muted-foreground/40">·</span>
                          <span>{p.time}</span>
                        </p>
                      </div>
                      {/* 状态 / 命中数 */}
                      {analyzing ? (
                        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          分析中
                        </span>
                      ) : p.status === "pending" ? (
                        <span className="shrink-0 rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          待分析
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-primary/12 px-2.5 py-1 text-xs font-medium text-primary">
                          {p.findings} 项命中
                        </span>
                      )}
                      {/* 操作 */}
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          title="下载日志包"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background/40 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="重新采集并分析"
                          disabled={analyzing}
                          onClick={() => void reanalyze(p.id)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background/40 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <RefreshCw className={cn("h-4 w-4", analyzing && "animate-spin")} />
                        </button>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                  <Package className="h-8 w-8" />
                  <p className="text-sm">{query.trim() ? "未找到匹配的日志包" : "暂无日志包"}</p>
                </div>
              )}
            </div>
          </PanelShell>
        </div>

        {/* 右列：主动采集目标 */}
        <PanelShell
          title="主动采集目标"
          desc="选择在线客户端，主动拉取并分析其本地日志。"
          className="min-h-0"
          action={
            <button
              type="button"
              onClick={toggleAllOnline}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-full px-4 text-xs font-medium transition-all duration-200",
                allOnlineSelected
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                  : "border border-border bg-surface/60 text-foreground hover:bg-surface",
              )}
            >
              <MonitorCheck className="h-3.5 w-3.5" />
              全选在线
            </button>
          }
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="rounded-full bg-primary/12 px-2.5 py-0.5 font-mono text-xs font-medium text-primary">
                已选 {selected.length}
              </span>
              在线 {onlineIds.length} 台
            </span>
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {listOpen ? "收起客户端列表" : "展开客户端列表"}
              <ChevronDown className={cn("h-4 w-4 transition-transform duration-300", listOpen && "rotate-180")} />
            </button>
          </div>

          <div
            className="overflow-hidden transition-all duration-300 ease-out"
            style={{
              maxHeight: listOpen ? `${collectClients.length * 76 + 8}px` : "0px",
              opacity: listOpen ? 1 : 0,
              marginTop: listOpen ? "1rem" : "0px",
            }}
          >
            <div className="flex flex-col gap-2">
              {collectClients.map((c) => {
                const checked = selected.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleClient(c.id)}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all duration-200",
                      checked
                        ? "border-primary bg-primary/12 shadow-[0_0_0_3px_oklch(0.82_0.19_145_/_12%)]"
                        : "border-border bg-surface/60 hover:bg-surface",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-200",
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/40",
                      )}
                    >
                      {checked && (
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.ip} · {c.os}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                        c.online ? "bg-primary/12 text-primary" : "bg-negative/12 text-negative",
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", c.online ? "bg-primary" : "bg-negative")} />
                      {c.online ? "在线" : "离线"}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 采集说明 + 操作 */}
          <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-primary/30 bg-primary/8 px-4 py-3 text-xs leading-relaxed text-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              将向 <b className="text-primary">{selectedOnline.length}</b> 台在线客户端下发日志采集命令（最近 24 小时，最多 500 条），
              离线客户端将被跳过；结果由 Agent 回传后写入服务端。
            </span>
          </div>

          <button
            type="button"
            onClick={() => void handleCollect()}
            disabled={selectedOnline.length === 0 || collecting}
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.01] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          >
            {collecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Siren className="h-4 w-4" />}
            {collecting ? "正在采集分析…" : "主动采集日志"}
          </button>
          {selectedOnline.length === 0 && (
            <p className="mt-2 text-center text-xs text-muted-foreground/70">请至少选择 1 台在线客户端。</p>
          )}
        </PanelShell>
      </div>
    </div>
  )
}
