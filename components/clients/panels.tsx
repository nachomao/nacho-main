"use client"

import { useEffect, useRef, useState } from "react"
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  DownloadCloud,
  FolderCog,
  FolderPlus,
  Link2,
  Loader2,
  Monitor,
  RefreshCw,
  Search,
  Server,
  Terminal,
  AlertCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ClientCard } from "./client-card"
import type { Client } from "./client-data"
import { ClientManagementPanel } from "./extensions-panel"
import { useServerData } from "@/components/server-data-context"
import { useOnboarding } from "@/components/onboarding/onboarding-context"
import { defaultServerBaseUrl } from "@/lib/server-connection"
import { useConfirm } from "@/components/ui/confirm-dialog"

/* 通用面板外壳：标题 + 描述 + 内容 */
function PanelShell({
  title,
  desc,
  action,
  children,
}: {
  title: string
  desc: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="card-glow flex h-full w-full flex-col overflow-hidden rounded-3xl bg-card p-6">
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

/* 表单字段 */
function Field({
  label,
  icon,
  children,
}: {
  label: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      {children}
    </label>
  )
}

const inputCls =
  "h-11 rounded-xl border border-border bg-surface/60 px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:bg-surface"

/* 复制按钮：点击后短暂显示已复制状态 */
function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
        copied
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border bg-surface/80 text-muted-foreground hover:bg-surface hover:text-foreground",
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "已复制" : label}
    </button>
  )
}

/* 命令块：可选注释 + 等宽命令 + 复制按钮 */
function CommandBlock({
  step,
  comment,
  command,
  copyLabel = "复制命令",
}: {
  step?: string
  comment?: string
  command: string
  copyLabel?: string
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background/50">
      {comment && (
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
          {step && (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/15 text-[11px] font-semibold text-primary">
              {step}
            </span>
          )}
          <span className="text-xs text-muted-foreground"># {comment}</span>
        </div>
      )}
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <code className="min-w-0 flex-1 break-all font-mono text-[13px] leading-relaxed text-foreground">
          {command}
        </code>
        <CopyButton text={command} label={copyLabel} />
      </div>
    </div>
  )
}

/* ---------- 面板一：客户端列表 ---------- */
export function ClientsPanel() {
  const [query, setQuery] = useState("")
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [managingClientId, setManagingClientId] = useState<string | null>(null)
  /* 离场层与方向，与顶部标签切换（clients-view）使用同一套卡片平移动画 */
  const [exiting, setExiting] = useState<{ kind: "list" } | { kind: "manage"; client: Client } | null>(null)
  const [direction, setDirection] = useState<1 | -1>(1)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { clients, groups, loading, refreshing, refresh, apiRequest } = useServerData()
  const { confirm } = useConfirm()
  const error: string | null = null
  const managingClient = clients.find((client) => client.id === managingClientId) ?? null
  const filtered = clients.filter(
    (c) =>
      c.name.includes(query) ||
      c.hostname.toLowerCase().includes(query.toLowerCase()) ||
      c.ip.includes(query),
  )

  async function deleteClient(client: Client, origin?: HTMLElement) {
    const accepted = await confirm({
      title: `删除“${client.name}”？`,
      description: "历史命令记录会一并删除，不可撤销。",
      body: `主机名：${client.hostname}\nIP 地址：${client.ip}`,
      confirmLabel: "删除",
      tone: "danger",
      origin,
    })
    if (!accepted) return
    setDeletingId(client.id)
    try {
      await apiRequest(`/clients/${encodeURIComponent(client.id)}`, { method: "DELETE" })
      await refresh()
    } finally {
      setDeletingId(null)
    }
  }

  /* 进入管理面板：列表卡片上移离场，管理卡片从下方贴上来 */
  const enterManage = (client: Client) => {
    setDirection(1)
    setExiting({ kind: "list" })
    setManagingClientId(client.id)
    if (exitTimer.current) clearTimeout(exitTimer.current)
    // 与 animate-panel-exit 动画时长保持一致
    exitTimer.current = setTimeout(() => setExiting(null), 500)
  }

  /* 返回列表：管理卡片下移离场，列表卡片从上方贴下来 */
  const exitManage = () => {
    if (!managingClient) return
    setDirection(-1)
    setExiting({ kind: "manage", client: managingClient })
    setManagingClientId(null)
    if (exitTimer.current) clearTimeout(exitTimer.current)
    exitTimer.current = setTimeout(() => setExiting(null), 500)
  }

  const managePanel = (client: Client) => <ClientManagementPanel client={client} onBack={exitManage} />

  const listPanel = (
    <PanelShell
      title="客户端"
      desc={`当前管理 ${clients.length} 台设备 · ${groups.length} 个分组`}
      action={
        <div className="flex items-center gap-2">
          <button type="button" title="刷新客户端" aria-label="刷新客户端" onClick={() => void refresh()} disabled={refreshing} className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface/60 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </button>
          <div className="flex h-10 w-full max-w-[220px] items-center gap-2 rounded-full border border-border bg-surface/60 px-3.5">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索名称 / 主机 / IP"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </div>
        </div>
      }
    >
      <div className="h-full overflow-auto px-1 pb-1 pt-2">
        {loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="h-7 w-7 animate-spin" /></div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <AlertCircle className="h-8 w-8 text-negative" />
            <p className="max-w-md text-sm">{error}</p>
            <button type="button" onClick={() => void refresh()} className="rounded-lg bg-surface px-3 py-2 text-sm text-foreground">重新连接</button>
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((c) => (
              <ClientCard
                key={c.id}
                client={c}
                deleting={deletingId === c.id}
                onManage={enterManage}
                onDelete={deleteClient}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Monitor className="h-8 w-8" />
            <p className="text-sm">未找到匹配的客户端</p>
          </div>
        )}
      </div>
    </PanelShell>
  )

  const enterClass = direction === 1 ? "animate-panel-enter" : "animate-panel-enter-down"
  const exitClass = direction === 1 ? "animate-panel-exit" : "animate-panel-exit-down"

  return (
    <div className="relative h-full w-full overflow-hidden">
      {exiting && (
        <div key={`exit-${exiting.kind}`} className={cn("pointer-events-none absolute inset-0", exitClass)} aria-hidden>
          {exiting.kind === "manage" ? managePanel(exiting.client) : listPanel}
        </div>
      )}
      <div
        key={managingClient ? `manage-${managingClient.id}` : "list"}
        className={cn("absolute inset-0", exiting && enterClass)}
      >
        {managingClient ? managePanel(managingClient) : listPanel}
      </div>
    </div>
  )
}

/* 补全协议：IP:端口 -> http://IP:端口 */
function normalizeUrl(raw: string) {
  const v = raw.trim().replace(/\/+$/, "")
  if (!v) return ""
  return /^https?:\/\//i.test(v) ? v : `http://${v}`
}

/* ---------- 面板二：客户端安装脚本 ---------- */
export function AddClientPanel() {
  const { serverSource } = useOnboarding()
  const configuredUrl = serverSource?.mode === "cloud" ? serverSource.api : defaultServerBaseUrl()
  const [serverUrl, setServerUrl] = useState(configuredUrl)

  useEffect(() => setServerUrl(configuredUrl), [configuredUrl])

  const base = normalizeUrl(serverUrl) || "http://192.168.0.1:3000"

  return (
    <PanelShell
      title="客户端安装脚本"
      desc="通过当前控制服务端安装 Windows Agent"
    >
      <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
        {/* Linux Agent 尚未实现，首阶段仅展示可用的 Windows 安装入口。 */}
        <Field label="服务器地址（ServerUrl）" icon={<Server className="h-3.5 w-3.5" />}>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            className={cn(inputCls, "font-mono")}
            placeholder="http://192.168.0.1:3000"
          />
          <span className="text-xs text-muted-foreground/70">
            支持填写 IP:端口，保存时会自动补全协议
          </span>
        </Field>

        <WindowsInstall base={base} />
      </div>
    </PanelShell>
  )
}

/* Windows：PowerShell 安装脚本（保持不变） */
function WindowsInstall({ base }: { base: string }) {
  const installPath = "C:\\Program Files\\Nacho\\Agent"
  const scriptUrl = `${base}/install.ps1`
  const iwrCmd = `irm "${scriptUrl}" | iex`
  const wgetCmd = `iwr "${scriptUrl}" -OutFile install.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File .\\install.ps1`
  const deployCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm '${scriptUrl}' | iex"`

  return (
    <>
      {/* 概述条 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface/60 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
            <Terminal className="h-5 w-5 text-primary" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-medium">PowerShell 安装脚本</p>
            <p className="text-xs text-muted-foreground">在目标 Windows 机器上以管理员身份运行</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={scriptUrl}
            download="install.ps1"
            target="_blank"
            rel="noreferrer"
            className="flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-95"
          >
            <DownloadCloud className="h-4 w-4" />
            下载脚本
          </a>
        </div>
      </div>

      {/* 安装路径 */}
      <Field label="安装路径（InstallPath）" icon={<FolderCog className="h-3.5 w-3.5" />}>
        <input
          readOnly
          value={installPath}
          className={cn(inputCls, "font-mono")}
        />
        <span className="text-xs text-muted-foreground/70">
          当前安装器固定使用该机器级目录
        </span>
      </Field>

      {/* 命令步骤 */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">部署命令</h3>
          <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-muted-foreground">
            安装脚本由当前控制服务端动态生成
          </span>
        </div>

        <div className="rounded-xl border border-border bg-background/50 px-4 py-3">
          <p className="text-xs text-muted-foreground"># 1. 打开 PowerShell（脚本会自动弹 UAC 请求管理员权限）</p>
        </div>

        <CommandBlock
          step="2"
          comment="PowerShell 一键部署"
          command={iwrCmd}
        />
        <CommandBlock
          step="3"
          comment="下载后执行"
          command={wgetCmd}
        />
      </div>

      {/* 一键部署模式 */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface/40 p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/15 text-[11px] font-semibold text-primary">
            4
          </span>
          <h3 className="text-sm font-semibold">一键部署模式</h3>
        </div>

        <Field label="部署链接（与控制服务端共用端口，可分���给自动化系统）" icon={<Link2 className="h-3.5 w-3.5" />}>
          <div className="flex items-center gap-2">
            <input readOnly value={scriptUrl} className={cn(inputCls, "flex-1 font-mono")} />
            <CopyButton text={scriptUrl} label="复制链接" />
          </div>
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">部署执行命令</span>
          <CommandBlock command={deployCmd} />
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground/80">
          说明：部署脚本、版本清单和 Agent 制品均由当前控制服务端的同一地址与端口提供。
        </p>
      </div>
    </>
  )
}

/* ---------- 面板三：添加分组 ---------- */
const groupColors = [
  "oklch(0.82 0.19 145)",
  "oklch(0.5 0.15 200)",
  "oklch(0.72 0.16 60)",
  "oklch(0.6 0.25 350)",
  "#dce02d",
]

export function AddGroupPanel() {
  const [color, setColor] = useState(groupColors[0])
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const { apiRequest, refresh } = useServerData()

  async function createGroup(event: React.FormEvent) {
    event.preventDefault()
    const nextName = name.trim()
    if (!nextName || saving) return
    setSaving(true)
    setMessage("")
    try {
      await apiRequest<string[]>("/groups", { method: "POST", body: JSON.stringify({ name: nextName }) })
      setName("")
      setMessage("分组已创建")
      await refresh()
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "创建分组���败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <PanelShell title="添加分组" desc="创建新的客户端分组以便集中管理">
      <form className="flex h-full flex-col" onSubmit={createGroup}>
        <div className="grid grid-cols-1 gap-4 overflow-auto pr-1">
          <Field label="分组名称" icon={<FolderPlus className="h-3.5 w-3.5" />}>
            <input value={name} onChange={(event) => setName(event.target.value)} className={inputCls} placeholder="例如：研发环境" />
          </Field>
          <Field label="分组描述">
            <textarea
              className={cn(inputCls, "h-24 resize-none py-3 leading-relaxed")}
              placeholder="简要描述该分组的用途"
            />
          </Field>
          <Field label="标识颜色">
            <div className="flex items-center gap-3">
              {groupColors.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`选择颜色 ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    "h-9 w-9 rounded-full transition-transform duration-200 hover:scale-110",
                    color === c && "ring-2 ring-foreground ring-offset-2 ring-offset-card",
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-3 border-t border-border pt-4">
          {message && <span className="mr-auto self-center text-sm text-muted-foreground">{message}</span>}
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-95"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
            创建分组
          </button>
        </div>
      </form>
    </PanelShell>
  )
}

/* ---------- 面板四：客户端更新 ---------- */
/* ---------- 面板四：客户端更新 ---------- */
type UpdateCommand = {
  id: string
  status: "pending" | "sent" | "running" | "success" | "failed" | "canceled"
  result: string | null
}

type UpdateClient = Client & {
  connected: boolean
  currentVersion: string
  targetVersion: string
  command: UpdateCommand | null
  phase: string | null
  skipReason: "not-windows" | "already-current" | "newer-than-release" | "invalid-version" | "active-update" | null
}

type AgentUpdates = {
  release: { version: string; fileName: string; sha256: string; rid: "win-x64"; sizeBytes: number; publishedAt: string }
  clients: UpdateClient[]
}

type QueueResult = {
  release: AgentUpdates["release"]
  queued: UpdateCommand[]
  skipped: Array<{ clientId: string; reason: string }>
}

const activePhases = new Set(["pending", "sent", "running", "downloading", "verified", "applying"])
const phaseLabels: Record<string, string> = {
  pending: "已排队",
  sent: "等待执行",
  running: "执行中",
  downloading: "下载中",
  verified: "校验完成",
  applying: "应用中",
  healthy: "健康确认",
  "already-current": "已是最新",
  "rolled-back": "已回滚",
  failed: "失败",
  canceled: "已取消",
}

function humanBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`
}

function parseUpdateResult(command: UpdateCommand | null) {
  try {
    return command?.result ? JSON.parse(command.result) as { fromVersion?: string; targetVersion?: string; error?: string; rollbackReason?: string } : null
  } catch {
    return null
  }
}

function UpdateBadge({ client, onUpdate }: { client: UpdateClient; onUpdate: () => void }) {
  const phase = client.phase ?? (client.skipReason === "already-current" ? "already-current" : null)
  const active = phase ? activePhases.has(phase) : false
  if (phase === "healthy" || phase === "already-current") return (
    <span className="flex items-center gap-1.5 rounded-full bg-primary/12 px-3 py-1 text-xs font-medium text-primary">
      <CheckCircle2 className="h-3.5 w-3.5" />{phaseLabels[phase]}
    </span>
  )
  if (active) return (
    <span className="flex items-center gap-1.5 rounded-full bg-[#dce02d]/15 px-3 py-1 text-xs font-medium text-[#dce02d]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />{phaseLabels[phase!] ?? phase}
    </span>
  )
  if (phase === "rolled-back" || phase === "failed") return (
    <span className="flex items-center gap-1.5 rounded-full bg-destructive/12 px-3 py-1 text-xs font-medium text-destructive">
      <AlertCircle className="h-3.5 w-3.5" />{phaseLabels[phase]}
    </span>
  )
  if (client.skipReason === "newer-than-release") return <span className="text-xs text-muted-foreground">高于发布版</span>
  if (client.skipReason === "invalid-version") return <span className="text-xs text-destructive">版本异常</span>
  return (
    <button type="button" onClick={onUpdate} className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted">
      <Download className="h-3.5 w-3.5" />立即更新
    </button>
  )
}

export function ClientUpdatePanel() {
  const { apiRequest, refresh } = useServerData()
  const { confirm } = useConfirm()
  const [updates, setUpdates] = useState<AgentUpdates | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastQueue, setLastQueue] = useState<QueueResult | null>(null)

  async function load() {
    try {
      setUpdates(await apiRequest<AgentUpdates>("/agent-updates"))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取升级状态失败")
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 1_000)
    return () => window.clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiRequest])

  async function queue(scope: "all" | "clients", clientIds: string[] = []) {
    if (!updates || submitting) return
    const candidates = scope === "all" ? updates.clients.filter((item) => item.skipReason === null) : updates.clients.filter((item) => clientIds.includes(item.id))
    const online = candidates.filter((item) => item.status !== "offline").length
    const offline = candidates.length - online
    const expectedSkipped = updates.clients.length - candidates.length
    const accepted = await confirm({
      title: scope === "all" ? "为全部可升级客户端创建升级命令？" : "为所选客户端创建升级命令？",
      description: "升级期间 Agent 会短暂重连，命令支持断线重试与回滚。",
      body: `目标版本：v${updates.release.version}\n制品大小：${humanBytes(updates.release.sizeBytes)}\n立即执行：${online} 台在线\n离线排队：${offline} 台\n预计跳过：${expectedSkipped} 台`,
      confirmLabel: "创建升级命令",
      tone: "warning",
    })
    if (!accepted) return
    setSubmitting(true)
    try {
      const result = await apiRequest<QueueResult>("/agent-updates", {
        method: "POST",
        body: JSON.stringify(scope === "all" ? { scope } : { scope, clientIds }),
      })
      setLastQueue(result)
      await Promise.all([load(), refresh()])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建升级命令失败")
    } finally {
      setSubmitting(false)
    }
  }

  const rows = updates?.clients ?? []
  const available = rows.filter((item) => item.skipReason === null).length

  return (
    <PanelShell
      title="客户端更新"
      desc={updates ? `最新版本 v${updates.release.version} · ${new Date(updates.release.publishedAt).toLocaleString()} · ${humanBytes(updates.release.sizeBytes)} · ${available} 台可更新` : "正在读取服务���发布清���"}
      action={
        <button type="button" onClick={() => void queue("all")} disabled={!updates || submitting || available === 0} className="flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-50">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}全部更新
        </button>
      }
    >
      <div className="h-full overflow-auto pr-1">
        {error && <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
        {lastQueue && <div className="mb-3 rounded-xl border border-border bg-surface/60 px-3 py-2 text-xs text-muted-foreground">已排队 {lastQueue.queued.length} 台，跳过 {lastQueue.skipped.length} 台。</div>}
        {rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"><Monitor className="h-8 w-8" /><p className="text-sm">暂无 Windows 客户端</p></div>
        ) : <div className="flex flex-col gap-2">
          {rows.map((client) => {
            const result = parseUpdateResult(client.command)
            return (
              <div key={client.id} className="rounded-2xl border border-border bg-surface/60 px-4 py-3.5 transition-colors hover:bg-surface">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background/40"><Monitor className="h-5 w-5 text-muted-foreground" /></span>
                    <div className="min-w-0 leading-tight">
                      <p className="truncate text-sm font-medium">{client.name}</p>
                      <p className="text-xs text-muted-foreground"><span className="font-mono">{client.currentVersion || "未知"}</span>{client.currentVersion !== client.targetVersion && <> → <span className="font-mono text-primary">{client.targetVersion}</span></>}</p>
                      {client.status === "offline" && client.phase === "pending" && <p className="mt-1 text-xs text-[#dce02d]">等待上线</p>}
                    </div>
                  </div>
                  <UpdateBadge client={client} onUpdate={() => void queue("clients", [client.id])} />
                </div>
                {(result?.error || result?.rollbackReason) && <div className="mt-3 rounded-xl bg-destructive/8 px-3 py-2 text-xs text-destructive">{result.error || result.rollbackReason}{result.fromVersion && ` · 已恢复 ${result.fromVersion}`}</div>}
              </div>
            )
          })}
        </div>}
      </div>
    </PanelShell>
  )
}
