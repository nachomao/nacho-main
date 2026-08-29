"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  Clock,
  RotateCw,
  FileTerminal,
  ListChecks,
  Loader2,
  LogIn,
  Monitor,
  MonitorCheck,
  Pencil,
  Play,
  Plus,
  Power,
  Repeat,
  Server,
  Settings2,
  Sparkles,
  Tag,
  Terminal,
  Trash2,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { useServerData } from "@/components/server-data-context"
import { usePanelResource } from "@/components/use-panel-resource"
import type { Client as PanelClient } from "@/components/clients/client-data"
import { useTasks, type OSType } from "./tasks-context"

/* ---------- 通用面板外壳：与脚本安装 / 客户端面板保持一致 ---------- */
function PanelShell({
  title,
  desc,
  action,
  children,
  className,
}: {
  title: string
  desc?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("card-glow flex w-full flex-col overflow-hidden rounded-3xl bg-card p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5 min-h-0 flex-1">{children}</div>
    </div>
  )
}

function Field({
  label,
  icon,
  hint,
  children,
}: {
  label: string
  icon?: React.ReactNode
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      {children}
      {hint && <span className="text-xs text-muted-foreground/70">{hint}</span>}
    </label>
  )
}

const inputCls =
  "h-11 w-full rounded-xl border border-border bg-surface/60 px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:bg-surface"

/* ---------- 目标客户端（按操作系统区分） ---------- */
type TaskClient = {
  id: string
  name: string
  ip: string
  os: string
  online: boolean
}

/* 把服务端 /clients 的真实客户端按任务的目标系统分类。
   macOS 客户端归入 linux 组：两者都走 POSIX 的 shell/cron 任务链路。 */
function groupClientsByOS(clients: PanelClient[]): Record<OSType, TaskClient[]> {
  const grouped: Record<OSType, TaskClient[]> = { windows: [], linux: [] }
  for (const c of clients) {
    const bucket: OSType = c.os === "Windows" ? "windows" : "linux"
    grouped[bucket].push({
      id: c.id,
      name: c.name,
      ip: c.ip,
      os: c.osName || c.os,
      online: c.status !== "offline",
    })
  }
  return grouped
}

/* ---------- 操作系统展示元数据 ---------- */
export const osMeta: Record<OSType, { label: string; icon: typeof Monitor; pathHint: string; pathPlaceholder: string }> = {
  windows: {
    label: "Windows",
    icon: Monitor,
    pathHint: "目标客户端上的绝对路径，例如 C:\\Scripts\\backup.bat",
    pathPlaceholder: "C:\\Scripts\\backup.bat",
  },
  linux: {
    label: "Linux",
    icon: Terminal,
    pathHint: "目标主机上的绝对路径，例如 /opt/scripts/backup.sh",
    pathPlaceholder: "/opt/scripts/backup.sh",
  },
}

/* ---------- 触发器类型（按操作系统区分） ---------- */
type TriggerKind = "interval" | "event" | "cron"
type TriggerDef = { id: string; label: string; icon: typeof Monitor; kind: TriggerKind; unit?: string }

const triggersByOS: Record<OSType, readonly TriggerDef[]> = {
  windows: [
    { id: "daily", label: "每天", icon: CalendarDays, kind: "interval", unit: "天" },
    { id: "weekly", label: "每周", icon: Repeat, kind: "interval", unit: "周" },
    { id: "logon", label: "登录时", icon: LogIn, kind: "event" },
    { id: "startup", label: "系统启动", icon: Power, kind: "event" },
  ],
  linux: [
    { id: "daily", label: "每天", icon: CalendarDays, kind: "interval", unit: "天" },
    { id: "weekly", label: "每周", icon: Repeat, kind: "interval", unit: "周" },
    { id: "boot", label: "开机时", icon: Power, kind: "event" },
    { id: "cron", label: "Cron", icon: Terminal, kind: "cron" },
  ],
}

type TriggerId = "daily" | "weekly" | "logon" | "startup" | "boot" | "cron"

function findTrigger(os: OSType, id: TriggerId): TriggerDef {
  return triggersByOS[os].find((t) => t.id === id) ?? triggersByOS[os][0]
}

function triggerSummary(os: OSType, id: TriggerId, time: string, interval: number, cron: string) {
  switch (id) {
    case "daily":
      return `每 ${interval} 天 · ${time}`
    case "weekly":
      return `每 ${interval} 周 · ${time}`
    case "logon":
      return "用户登录时"
    case "startup":
      return "系统启动时"
    case "boot":
      return "开机时（@reboot）"
    case "cron":
      return `Cron · ${cron}`
    default:
      return time
  }
}

/* ---------- 已有任务 ---------- */
type ScheduledTask = {
  id: string
  name: string
  os: OSType
  action: string
  /* 原始字段，便于编辑时精确回填 */
  program: string
  args: string
  triggerId: TriggerId
  time: string
  interval: number
  cron: string
  clientIds: string[]
  enabled: boolean
}

/* 由程序 + 参数拼出展示路径 */
function taskPath(t: Pick<ScheduledTask, "program" | "args">) {
  return t.args.trim() ? `${t.program} ${t.args}`.trim() : t.program
}

/* 为指定系统生成空白任务草稿 */
function blankTask(os: OSType): ScheduledTask {
  return {
    id: "",
    name: "",
    os,
    action: "运行程序",
    program: "",
    args: "",
    triggerId: "daily",
    time: "06:00",
    interval: 1,
    cron: "0 3 * * *",
    clientIds: [],
    enabled: true,
  }
}

/* ---------- 编辑弹窗外壳：沿用插件 / 安装对话框的模糊缩放揭示动效 ---------- */
function DialogShell({
  open,
  onClose,
  title,
  desc,
  icon,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  desc: string
  icon?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  // mounted 在退场动画期间保持挂载，shown 驱动渐显 / 渐隐
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)

  // 挂载 / 卸载：open 关闭时先播放渐隐，过渡结束后再卸载
  useEffect(() => {
    if (open) {
      setMounted(true)
      const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
      window.addEventListener("keydown", onKey)
      return () => window.removeEventListener("keydown", onKey)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), 460)
    return () => clearTimeout(t)
  }, [open, onClose])

  // 揭示：挂载后用双重 rAF 确保模糊帧先绘制，再切到清晰态，保证渐显动画
  useEffect(() => {
    if (!mounted || !open) return
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setShown(true))
    })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
    }
  }, [mounted, open])

  if (!mounted || typeof document === "undefined") return null

  // 通过 Portal 渲染到 body，脱离带 transform 的祖先（页面过渡容器），
  // 否则 fixed 会相对该祖先定位，导致弹窗底部超出视口被裁剪。
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        aria-label="关闭"
        onClick={onClose}
        className="fixed inset-0 bg-background/70 backdrop-blur-sm"
        style={{
          opacity: shown ? 1 : 0,
          transition: shown ? "opacity 360ms ease-out" : "opacity 420ms cubic-bezier(0.55,0,0.68,0.4)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card-glow relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-card"
        style={{
          transform: shown ? "translateY(0) scale(1)" : "translateY(12px) scale(0.97)",
          opacity: shown ? 1 : 0,
          filter: shown ? "blur(0px)" : "blur(8px)",
          // 入场用 ease-out（快速就位），退场用 ease-in（缓慢起步），让模糊渐隐全程可见、不突兀
          transition: shown
            ? "transform 460ms cubic-bezier(0.22,1,0.36,1), opacity 460ms ease-out, filter 460ms ease-out"
            : "transform 420ms cubic-bezier(0.55,0,0.68,0.4), opacity 420ms cubic-bezier(0.55,0,0.68,0.4), filter 420ms cubic-bezier(0.55,0,0.68,0.4)",
        }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border text-foreground">
              {icon ?? <Pencil className="h-5 w-5" />}
            </span>
            <div>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
            </div>
          </div>
          <button
            aria-label="关闭"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>

        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-border p-5">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ---------- 任务创建 / 编辑弹窗：统一表单，按操作系统自适应 ---------- */
function TaskFormDialog({
  open,
  mode,
  initial,
  clientsByOS,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean
  mode: "create" | "edit"
  clientsByOS: Record<OSType, TaskClient[]>
  submitting: boolean
  initial: ScheduledTask
  onClose: () => void
  onSubmit: (t: ScheduledTask) => void
}) {
  const [draft, setDraft] = useState<ScheduledTask>(initial)

  // 打开时（或初始任务变化时）回填草稿；关闭时保留上次草稿，让退场动画期间内容不闪烁
  useEffect(() => {
    if (open) setDraft({ ...initial, clientIds: [...initial.clientIds] })
  }, [open, initial])

  const os = draft.os
  const meta = osMeta[os]
  const MetaIcon = meta.icon
  const clients = clientsByOS[os]
  const triggers = triggersByOS[os]
  const currentTrigger = findTrigger(os, draft.triggerId)
  const isCreate = mode === "create"

  const set = (patch: Partial<ScheduledTask>) => setDraft((d) => ({ ...d, ...patch }))
  const onlineIds = clients.filter((c) => c.online).map((c) => c.id)
  const allOnlineSelected = onlineIds.length > 0 && onlineIds.every((id) => draft.clientIds.includes(id))

  const toggleClient = (id: string) =>
    set({ clientIds: draft.clientIds.includes(id) ? draft.clientIds.filter((x) => x !== id) : [...draft.clientIds, id] })
  const toggleAllOnline = () =>
    set({
      clientIds: allOnlineSelected
        ? draft.clientIds.filter((id) => !onlineIds.includes(id))
        : Array.from(new Set([...draft.clientIds, ...onlineIds])),
    })

  const cronValid = currentTrigger.kind !== "cron" || draft.cron.trim() !== ""
  const valid = draft.name.trim() !== "" && draft.program.trim() !== "" && draft.clientIds.length > 0 && cronValid
  const submit = () => {
    if (!valid) return
    onSubmit({
      ...draft,
      name: draft.name.trim(),
      program: draft.program.trim(),
      args: draft.args.trim(),
      cron: draft.cron.trim(),
    })
  }

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      icon={isCreate ? <CalendarPlus className="h-5 w-5" /> : <Pencil className="h-5 w-5" />}
      title={isCreate ? `新建 ${meta.label} 任务` : `编辑任务：${draft.name || "未命名任务"}`}
      desc={isCreate ? `在 ${meta.label} 客户端上批量创建计划任务` : "修改任务内容、触发方式与目标客户端"}
      footer={
        <>
          <button
            className="flex h-11 items-center gap-2 rounded-xl border border-border bg-surface/60 px-5 text-sm font-medium text-foreground transition-colors hover:bg-surface"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
            取消
          </button>
          <button
            className={cn(
              "flex h-11 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-95",
              (!valid || submitting) && "cursor-not-allowed opacity-40 hover:scale-100",
            )}
            onClick={submit}
            disabled={!valid || submitting}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isCreate ? (
              <Plus className="h-4 w-4" />
            ) : (
              <Pencil className="h-4 w-4" />
            )}
            {submitting ? "提交中…" : isCreate ? "创建任务" : "保存修改"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* 系统标识 */}
        <div className="flex items-center gap-2 self-start rounded-full border border-border bg-surface/60 px-3 py-1.5 text-xs font-medium text-foreground">
          <MetaIcon className="h-4 w-4 text-primary" />
          {meta.label} 客户端
        </div>

        <Field label="任务名称" icon={<Tag className="h-3.5 w-3.5" />}>
          <input className={inputCls} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="请输入任务名称" />
        </Field>
        <Field label="程序 / 脚本路径" icon={<FileTerminal className="h-3.5 w-3.5" />} hint={meta.pathHint}>
          <input
            className={cn(inputCls, "font-mono")}
            value={draft.program}
            onChange={(e) => set({ program: e.target.value })}
            placeholder={meta.pathPlaceholder}
          />
        </Field>
        <Field label="启动参数" icon={<Terminal className="h-3.5 w-3.5" />} hint="可选，传递给程序的命令行参数。">
          <input
            className={cn(inputCls, "font-mono")}
            value={draft.args}
            onChange={(e) => set({ args: e.target.value })}
            placeholder="请输入启动参数"
          />
        </Field>

        {/* 触发器 */}
        <Field label="触发器" icon={<Settings2 className="h-3.5 w-3.5" />}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {triggers.map((t) => {
              const active = draft.triggerId === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => set({ triggerId: t.id as TriggerId })}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-center transition-all duration-200",
                    active ? "border-primary bg-primary/15" : "border-border bg-surface/60 hover:bg-surface",
                  )}
                >
                  <t.icon className={cn("h-5 w-5", active ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn("text-xs font-medium", active ? "text-primary" : "text-foreground")}>{t.label}</span>
                </button>
              )
            })}
          </div>
        </Field>

        {/* 时间 / 间隔：仅 interval 类触发器显示 */}
        <div
          className="grid grid-cols-2 gap-4 overflow-hidden transition-all duration-300 ease-out"
          style={{
            maxHeight: currentTrigger.kind === "interval" ? "120px" : "0px",
            opacity: currentTrigger.kind === "interval" ? 1 : 0,
          }}
        >
          <Field label="执行时间" icon={<Clock className="h-3.5 w-3.5" />}>
            <input type="time" className={cn(inputCls, "font-mono")} value={draft.time} onChange={(e) => set({ time: e.target.value })} />
          </Field>
          <Field label={`重复间隔（${currentTrigger.unit || "天"}）`} icon={<Repeat className="h-3.5 w-3.5" />}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={30}
                className={cn(inputCls, "font-mono")}
                value={draft.interval}
                onChange={(e) => set({ interval: Math.max(1, Number(e.target.value)) })}
              />
              <span className="shrink-0 text-sm text-muted-foreground">{currentTrigger.unit || "天"}</span>
            </div>
          </Field>
        </div>

        {/* Cron 表达式：仅 cron 类触发器显示（Linux） */}
        <div
          className="overflow-hidden transition-all duration-300 ease-out"
          style={{
            maxHeight: currentTrigger.kind === "cron" ? "120px" : "0px",
            opacity: currentTrigger.kind === "cron" ? 1 : 0,
          }}
        >
          <Field label="Cron 表达式" icon={<Clock className="h-3.5 w-3.5" />} hint="标准 crontab 格式：分 时 日 月 周，例如 0 3 * * 1">
            <input
              className={cn(inputCls, "font-mono")}
              value={draft.cron}
              onChange={(e) => set({ cron: e.target.value })}
              placeholder="0 3 * * *"
            />
          </Field>
        </div>

        {/* 目标客户端 */}
        <div className="rounded-2xl border border-border bg-surface/40 p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm">
              <Server className="h-4 w-4 text-primary" />
              <span className="font-medium">目标客户端</span>
              <span className="rounded-full bg-primary/12 px-2.5 py-0.5 font-mono text-xs font-medium text-primary">
                已选 {draft.clientIds.length}
              </span>
            </span>
            <button
              type="button"
              onClick={toggleAllOnline}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all duration-200",
                allOnlineSelected
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                  : "border border-border bg-surface/60 text-foreground hover:bg-surface",
              )}
            >
              <MonitorCheck className="h-3.5 w-3.5" />
              全选在线
            </button>
          </div>

          <div className="mt-3 flex max-h-52 flex-col gap-2 overflow-y-auto pr-1">
            {clients.map((c) => {
              const checked = draft.clientIds.includes(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleClient(c.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200",
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

        {/* 摘要条 */}
        <div className="flex items-start gap-2.5 rounded-2xl border border-primary/30 bg-primary/8 px-4 py-3 text-xs leading-relaxed text-foreground">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            将{isCreate ? "向" : "更新"} <b className="text-primary">{draft.clientIds.length}</b> 台 {meta.label} 客户端
            {isCreate ? "下发" : "的任务"}：<b>{draft.name.trim() || "未命名任务"}</b>，触发方式{" "}
            <b>{triggerSummary(os, draft.triggerId, draft.time, draft.interval, draft.cron)}</b>。
          </span>
        </div>
      </div>
    </DialogShell>
  )
}

export function TasksView() {
  const ctx = useTasks()
  const { apiRequest, clients } = useServerData()

  /* 已有任务：来自服务端 /api/panel/tasks */
  const { data: tasks, setData: setTasks, loading, error, reload } = usePanelResource<ScheduledTask[]>("/tasks", [])
  const [removing, setRemoving] = useState<string[]>([])
  const [flashId, setFlashId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // 正在执行行内操作的任务 id，用于禁用重复点击
  const [busyIds, setBusyIds] = useState<string[]>([])

  /* 目标客户端来自真实客户端列表，不再使用演示常量 */
  const clientsByOS = useMemo(() => groupClientsByOS(clients), [clients])

  /* 编辑弹窗：为 null 时关闭，否则为正在编辑的任务 */
  const [editing, setEditing] = useState<ScheduledTask | null>(null)
  // 关闭编辑时保留最后一次任务，供退场动画期间继续渲染内容（无任务时用空白草稿兜底）
  const [lastEdited, setLastEdited] = useState<ScheduledTask>(() => blankTask("windows"))

  /* 操作系统筛选 */
  const [osFilter, setOsFilter] = useState<"all" | OSType>("all")

  const createOS = ctx?.createOS ?? null
  // 为「新建」对话框生成稳定的空白草稿（按所选系统记忆，避免每次渲染重置）
  const createInitial = useMemo(() => blankTask(createOS ?? "windows"), [createOS])

  const filtered = osFilter === "all" ? tasks : tasks.filter((t) => t.os === osFilter)
  const counts = {
    all: tasks.length,
    windows: tasks.filter((t) => t.os === "windows").length,
    linux: tasks.filter((t) => t.os === "linux").length,
  }

  /* 提交给服务端的任务载荷：id/时间戳由服务端生成，这里只发协议约定的字段 */
  const taskPayload = (t: ScheduledTask) => ({
    name: t.name,
    os: t.os,
    action: t.action,
    program: t.program,
    args: t.args,
    triggerId: t.triggerId,
    time: t.time,
    interval: t.interval,
    cron: t.cron,
    clientIds: t.clientIds,
    enabled: t.enabled,
  })

  const flash = (id: string) => {
    setFlashId(id)
    setTimeout(() => setFlashId(null), 1200)
  }

  /* 新建任务：POST /tasks，成功后用服务端返回的记录（含真实 id）入列 */
  const handleCreate = async (draft: ScheduledTask) => {
    if (submitting) return
    setSubmitting(true)
    setActionError(null)
    try {
      const created = await apiRequest<ScheduledTask>("/tasks", {
        method: "POST",
        body: JSON.stringify(taskPayload(draft)),
      })
      setTasks((list) => [created, ...list])
      flash(created.id)
      ctx?.closeCreate()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "创建任务失败")
    } finally {
      setSubmitting(false)
    }
  }

  /* 保存编辑：PATCH /tasks/:id */
  const saveEdit = async (updated: ScheduledTask) => {
    if (submitting) return
    setSubmitting(true)
    setActionError(null)
    try {
      const saved = await apiRequest<ScheduledTask>(`/tasks/${updated.id}`, {
        method: "PATCH",
        body: JSON.stringify(taskPayload(updated)),
      })
      setTasks((list) => list.map((x) => (x.id === saved.id ? saved : x)))
      flash(saved.id)
      setEditing(null)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "保存任务失败")
    } finally {
      setSubmitting(false)
    }
  }

  const startEdit = (t: ScheduledTask) => {
    setLastEdited(t)
    setEditing(t)
  }

  /* 删除：先等服务端确认，再播放移除动画，避免失败后条目已消失 */
  const handleDelete = async (id: string) => {
    if (busyIds.includes(id)) return
    setBusyIds((b) => [...b, id])
    setActionError(null)
    try {
      await apiRequest(`/tasks/${id}`, { method: "DELETE" })
      if (editing?.id === id) setEditing(null)
      setRemoving((r) => [...r, id])
      setTimeout(() => {
        setTasks((t) => t.filter((x) => x.id !== id))
        setRemoving((r) => r.filter((x) => x !== id))
      }, 360)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "删除任务失败")
    } finally {
      setBusyIds((b) => b.filter((x) => x !== id))
    }
  }

  /* 启停：POST /tasks/:id/enabled，以服务端返回的记录为准 */
  const toggleEnabled = async (task: ScheduledTask) => {
    if (busyIds.includes(task.id)) return
    setBusyIds((b) => [...b, task.id])
    setActionError(null)
    try {
      const saved = await apiRequest<ScheduledTask>(`/tasks/${task.id}/enabled`, {
        method: "POST",
        body: JSON.stringify({ enabled: !task.enabled }),
      })
      setTasks((list) => list.map((x) => (x.id === saved.id ? saved : x)))
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "切换任务状态失败")
    } finally {
      setBusyIds((b) => b.filter((x) => x !== task.id))
    }
  }

  /* 立即运行：POST /tasks/:id/dispatch，走真实命令下发链路 */
  const runNow = async (id: string) => {
    if (busyIds.includes(id)) return
    setBusyIds((b) => [...b, id])
    setActionError(null)
    try {
      await apiRequest(`/tasks/${id}/dispatch`, { method: "POST" })
      flash(id)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "下发任务失败")
    } finally {
      setBusyIds((b) => b.filter((x) => x !== id))
    }
  }

  const filterChips: { id: "all" | OSType; label: string; count: number }[] = [
    { id: "all", label: "全部", count: counts.all },
    { id: "windows", label: "Windows", count: counts.windows },
    { id: "linux", label: "Linux", count: counts.linux },
  ]

  return (
    <div data-tasks-scroll className="flex min-h-0 flex-1 flex-col overflow-auto pr-1">
      <PanelShell
        title="计划任务"
        desc="集中管理已下发的 Windows 与 Linux 批量计划任务。点击右上角「新建任务」即可创建。"
        className="min-h-0 flex-1"
        action={
          <SegmentedControl
            variant="pill"
            value={osFilter}
            onChange={setOsFilter}
            options={filterChips.map((c) => ({ id: c.id, label: c.label, badge: c.count }))}
          />
        }
      >
        {actionError && (
          <div className="mb-3 flex items-start gap-2.5 rounded-2xl border border-negative/30 bg-negative/10 px-4 py-3 text-xs leading-relaxed text-negative">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">{actionError}</span>
            <button type="button" onClick={() => setActionError(null)} className="shrink-0 font-medium underline">
              知道了
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">正在从服务端加载计划任务…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <AlertTriangle className="h-8 w-8 text-negative" />
            <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => void reload()}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background/40 px-3.5 text-xs font-medium transition-colors hover:bg-surface"
            >
              <RotateCw className="h-3.5 w-3.5" />
              重试
            </button>
          </div>
        ) : filtered.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {filtered.map((t) => {
              const isRemoving = removing.includes(t.id)
              const isFlash = flashId === t.id
              const isEditing = editing?.id === t.id
              const isBusy = busyIds.includes(t.id)
              return (
                <div
                  key={t.id}
                  className={cn(
                    "rounded-2xl border bg-surface/60 p-4 transition-all duration-300 ease-out",
                    isRemoving
                      ? "scale-95 opacity-0 blur-sm"
                      : isFlash || isEditing
                        ? "border-primary bg-primary/10 shadow-[0_0_0_3px_oklch(0.82_0.19_145_/_15%)]"
                        : "border-border hover:bg-surface",
                  )}
                  style={{ maxHeight: isRemoving ? 0 : 200, marginBottom: isRemoving ? -10 : 0 }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background/40">
                        {(() => {
                          const OSIcon = osMeta[t.os].icon
                          return <OSIcon className="h-5 w-5 text-primary" />
                        })()}
                      </span>
                      <div className="min-w-0 leading-tight">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold">{t.name}</p>
                          <span className="flex items-center gap-1 rounded-full border border-border bg-background/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {osMeta[t.os].label}
                          </span>
                          {isEditing ? (
                            <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                              <Pencil className="h-3 w-3" />
                              编辑中
                            </span>
                          ) : (
                            isFlash && (
                              <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                                <Sparkles className="h-3 w-3" />
                                已更新
                              </span>
                            )
                          )}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{taskPath(t)}</p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                        t.enabled ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", t.enabled ? "bg-primary" : "bg-muted-foreground/60")} />
                      {t.enabled ? "已启用" : "已禁用"}
                    </span>
                  </div>

                  {/* 元信息 */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-[3.25rem] text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Repeat className="h-3.5 w-3.5" />
                      {triggerSummary(t.os, t.triggerId, t.time, t.interval, t.cron)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Server className="h-3.5 w-3.5" />
                      {t.clientIds.length} 台客户端
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Play className="h-3.5 w-3.5" />
                      {t.action}
                    </span>
                  </div>

                  {/* 操作 */}
                  <div className="mt-3 flex items-center justify-end gap-2 border-t border-border/60 pt-3">
                    <button
                      type="button"
                      onClick={() => void toggleEnabled(t)}
                      disabled={isBusy}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background/40 px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface disabled:pointer-events-none disabled:opacity-50"
                    >
                      {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                      {t.enabled ? "禁用" : "启用"}
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      className={cn(
                        "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
                        isEditing
                          ? "border-primary bg-primary/12 text-primary"
                          : "border-border bg-background/40 text-foreground hover:bg-surface",
                      )}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => void runNow(t.id)}
                      disabled={isBusy}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background/40 px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" />
                      运行
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(t.id)}
                      disabled={isBusy}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background/40 px-3 text-xs font-medium text-negative transition-colors hover:bg-negative/10 disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      删除
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <CalendarClock className="h-8 w-8" />
            <p className="text-sm">
              {osFilter === "all" ? "暂无计划任务。" : `暂无 ${osMeta[osFilter].label} 任务。`}
              点击右上角「新建任务」创建。
            </p>
          </div>
        )}
      </PanelShell>

      {/* 新建任务弹窗：由顶栏「新建任务」下拉触发，并按所选系统初始化 */}
      <TaskFormDialog
        open={!!createOS}
        mode="create"
        initial={createInitial}
        clientsByOS={clientsByOS}
        submitting={submitting}
        onClose={() => ctx?.closeCreate()}
        onSubmit={handleCreate}
      />

      {/* 编辑任务弹窗 */}
      <TaskFormDialog
        open={!!editing}
        mode="edit"
        initial={editing ?? lastEdited}
        clientsByOS={clientsByOS}
        submitting={submitting}
        onClose={() => setEditing(null)}
        onSubmit={saveEdit}
      />
    </div>
  )
}
