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
import { formatMetricPercent, statusMeta, type Client } from "./client-data"
import { OsLogo, resolveOsBrand } from "./os-logos"
import { ClientManagementPanel } from "./extensions-panel"
import { useServerData } from "@/components/server-data-context"
import { useOnboarding } from "@/components/onboarding/onboarding-context"
import { defaultServerBaseUrl } from "@/lib/server-connection"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { ReleaseNotesCapsule } from "@/components/settings/release-notes-capsule"
import { installCommands, installScriptUrl } from "@/lib/install-profiles"

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
      description: "历史命令记录一并删除，不可撤销。",
      // 优先展示 agent 上报的具体系统名，未上报时回退到系统大类
      body: `主机名：${client.hostname}\nIP 地址：${client.ip}\n操作系统：${client.osName?.trim() || client.os}`,
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
  const { developerPreview } = useServerData()
  const configuredUrl = serverSource?.mode === "local"
    ? serverSource.agentApi || serverSource.api
    : serverSource?.api || defaultServerBaseUrl()
  const [serverUrl, setServerUrl] = useState(configuredUrl)

  useEffect(() => setServerUrl(configuredUrl), [configuredUrl])

  const base = normalizeUrl(serverUrl) || "http://192.168.0.1:3000"

  return (
    <PanelShell
      title="客户端安装脚本"
      desc="通过当前控制服务端安装 Windows Agent"
    >
      <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
        {developerPreview && (
          <p className="rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-xs leading-5 text-primary">
            开发者预览模式：以下安装命令仅作界面展示，不会连接真实服务端。
          </p>
        )}
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
  const scriptUrl = installScriptUrl(base)
  const commands = installCommands(base)

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
            download="nacho.ps1"
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
          command={commands.standard}
        />
        <CommandBlock
          step="3"
          comment="下载后执行"
          command={commands.download}
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

        <Field label="部署链接（与控制服务端共用端口，可分发给自动化系统）" icon={<Link2 className="h-3.5 w-3.5" />}>
          <div className="flex items-center gap-2">
            <input readOnly value={scriptUrl} className={cn(inputCls, "flex-1 font-mono")} />
            <CopyButton text={scriptUrl} label="复制链接" />
          </div>
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">部署执行命令</span>
          <CommandBlock command={commands.boot} />
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
      setMessage(caught instanceof Error ? caught.message : "创建分组失败")
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
            <div className="flex items-center gap-3 p-1">
              {groupColors.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`选择颜色 ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    "h-9 w-9 rounded-full",
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

/* ---------- 面板四：客户端更新（左侧发版制品与覆盖率看板 + 右侧升级进度圆环卡片） ---------- */
export type UpdateCommand = {
  id: string
  status: "pending" | "sent" | "running" | "success" | "failed" | "canceled"
  result: string | null
}

export type UpdateClient = Client & {
  connected: boolean
  currentVersion: string
  targetVersion: string
  command: UpdateCommand | null
  phase: string | null
  skipReason: "not-windows" | "already-current" | "newer-than-release" | "invalid-version" | "active-update" | null
}

export type AgentUpdates = {
  release: { version: string; fileName: string; sha256: string; rid: "win-x64"; sizeBytes: number; publishedAt: string; title?: string; notes?: string }
  clients: UpdateClient[]
}

type QueueResult = {
  release: AgentUpdates["release"]
  queued: UpdateCommand[]
  skipped: Array<{ clientId: string; reason: string }>
}

type UpdateFilter = "all" | "active" | "available" | "current"

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

function shortenSha256(hash: string) {
  if (!hash || hash.length <= 16) return hash || "—"
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`
}

function formatRelativeSeen(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "未知"
  const diffMs = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

function parseUpdateResult(command: UpdateCommand | null) {
  try {
    return command?.result ? JSON.parse(command.result) as { fromVersion?: string; targetVersion?: string; error?: string; rollbackReason?: string } : null
  } catch {
    return null
  }
}

export type AgentReleaseNotes = { version: string; title?: string; notes?: string }

/** 服务端清单优先；缺失时回退到签名发布索引中同版本的 Agent 说明。 */
export function resolveAgentReleaseNotes(
  release: AgentReleaseNotes,
  signed: AgentReleaseNotes | null,
): { title?: string; notes?: string } {
  const matched = signed?.version === release.version ? signed : null
  return {
    title: release.title?.trim() || matched?.title?.trim() || undefined,
    notes: release.notes?.trim() || matched?.notes?.trim() || undefined,
  }
}

function resolveClientEffectivePhase(client: UpdateClient): string | null {
  return client.phase ?? (client.skipReason === "already-current" ? "already-current" : null)
}

function isClientUpToDate(client: UpdateClient): boolean {
  const phase = resolveClientEffectivePhase(client)
  return phase === "healthy" || phase === "already-current" || client.skipReason === "newer-than-release"
}

function isClientUpdateActive(client: UpdateClient): boolean {
  const phase = resolveClientEffectivePhase(client)
  return Boolean(phase && activePhases.has(phase)) || client.skipReason === "active-update"
}

type StepTone = "done" | "active" | "error" | "ready" | "idle"

function buildPipelineSteps(client: UpdateClient): Array<{ label: string; tone: StepTone }> {
  const phase = resolveClientEffectivePhase(client)
  const isCompleted = phase === "healthy" || phase === "already-current" || client.skipReason === "newer-than-release"
  if (isCompleted) {
    return [
      { label: "1. 版本比对 ✓", tone: "done" },
      { label: "2. 制品下载 ✓", tone: "done" },
      { label: "3. SHA256 校验 ✓", tone: "done" },
      { label: "4. 服务替换 ✓", tone: "done" },
      { label: "5. 健康确认 ✓", tone: "done" },
    ]
  }

  if (phase === "pending" || phase === "sent" || phase === "running") {
    const queueLabel = client.status === "offline"
      ? "1. 离线排队中 ⋯"
      : phase === "pending"
        ? "1. 队列挂起中 ⋯"
        : "1. 指令下发中 ⋯"
    return [
      { label: queueLabel, tone: "active" },
      { label: "2. 制品下载", tone: "idle" },
      { label: "3. SHA256 校验", tone: "idle" },
      { label: "4. 服务替换", tone: "idle" },
      { label: "5. 健康确认", tone: "idle" },
    ]
  }

  if (phase === "downloading") {
    return [
      { label: "1. 版本比对 ✓", tone: "done" },
      { label: "2. 制品下载中 ⋯", tone: "active" },
      { label: "3. SHA256 校验", tone: "idle" },
      { label: "4. 服务替换", tone: "idle" },
      { label: "5. 健康确认", tone: "idle" },
    ]
  }

  if (phase === "verified") {
    return [
      { label: "1. 版本比对 ✓", tone: "done" },
      { label: "2. 制品下载 ✓", tone: "done" },
      { label: "3. SHA256 校验 ✓", tone: "active" },
      { label: "4. 服务替换", tone: "idle" },
      { label: "5. 健康确认", tone: "idle" },
    ]
  }

  if (phase === "applying") {
    return [
      { label: "1. 版本比对 ✓", tone: "done" },
      { label: "2. 制品下载 ✓", tone: "done" },
      { label: "3. SHA256 校验 ✓", tone: "done" },
      { label: "4. 服务替换中 ⋯", tone: "active" },
      { label: "5. 健康确认", tone: "idle" },
    ]
  }

  if (phase === "rolled-back" || phase === "failed") {
    return [
      { label: "1. 版本比对 ✓", tone: "done" },
      { label: "2. 制品下载 ✓", tone: "done" },
      { label: "3. SHA256 校验 ✓", tone: "done" },
      { label: phase === "rolled-back" ? "4. 已触发回滚 !" : "4. 服务替换 !", tone: "error" },
      { label: "5. 升级未完成 ✕", tone: "error" },
    ]
  }

  // 待更新或版本异常
  if (client.skipReason === "invalid-version") {
    return [
      { label: "1. 版本号异常 !", tone: "error" },
      { label: "2. 制品下载", tone: "idle" },
      { label: "3. SHA256 校验", tone: "idle" },
      { label: "4. 服务替换", tone: "idle" },
      { label: "5. 健康确认", tone: "idle" },
    ]
  }

  return [
    { label: "1. 待下发更新", tone: "ready" },
    { label: "2. 制品下载", tone: "idle" },
    { label: "3. SHA256 校验", tone: "idle" },
    { label: "4. 服务替换", tone: "idle" },
    { label: "5. 健康确认", tone: "idle" },
  ]
}

const PIPELINE_TOTAL = 5

type PipelineTone = "done" | "active" | "error" | "ready"

type PipelineProgress = {
  tone: PipelineTone
  label: string
  count: number
}

function buildPipelineProgress(client: UpdateClient): PipelineProgress {
  const phase = resolveClientEffectivePhase(client)

  if (phase === "healthy") return { tone: "done", label: "升级流程已完成", count: PIPELINE_TOTAL }
  if (phase === "already-current") return { tone: "done", label: "已是最新版本", count: PIPELINE_TOTAL }
  if (client.skipReason === "newer-than-release") return { tone: "done", label: "版本高于发布清单", count: PIPELINE_TOTAL }

  if (phase === "pending" || phase === "sent" || phase === "running") {
    const label = client.status === "offline"
      ? "离线排队中"
      : phase === "pending"
        ? "队列挂起中"
        : "指令下发中"
    return { tone: "active", label, count: 1 }
  }

  if (phase === "downloading") return { tone: "active", label: "正在下载制品", count: 2 }
  if (phase === "verified") return { tone: "active", label: "SHA256 校验完成", count: 3 }
  if (phase === "applying") return { tone: "active", label: "正在替换服务", count: 4 }
  if (phase === "rolled-back") return { tone: "error", label: "服务替换失败，已回滚", count: 3 }
  if (phase === "failed") return { tone: "error", label: "升级失败", count: 3 }
  if (client.skipReason === "invalid-version") return { tone: "error", label: "版本号异常", count: 0 }

  return { tone: "ready", label: "等待下发升级指令", count: 0 }
}

const pipelineRingToneClass: Record<PipelineTone, string> = {
  done: "text-positive",
  active: "text-[#dce02d]",
  error: "text-destructive",
  ready: "text-primary",
}

const pipelineLabelToneClass: Record<PipelineTone, string> = {
  done: "text-positive",
  active: "text-[#dce02d]",
  error: "text-destructive",
  ready: "text-muted-foreground",
}

function PipelineRing({ tone, count }: { tone: PipelineTone; count: number }) {
  const radius = 7.5
  const circumference = 2 * Math.PI * radius
  const ratio = Math.max(0, Math.min(1, count / PIPELINE_TOTAL))

  return (
    <span
      className={cn("relative grid h-5 w-5 shrink-0 place-items-center", pipelineRingToneClass[tone])}
      aria-hidden="true"
    >
      <svg viewBox="0 0 20 20" className="absolute inset-0 -rotate-90">
        <circle cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeOpacity={0.16} strokeWidth={2.4} />
        {ratio > 0 && (
          <circle
            cx="10"
            cy="10"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
          />
        )}
      </svg>
      {tone === "done" ? (
        <Check className="relative h-2.5 w-2.5" strokeWidth={3} />
      ) : tone === "error" ? (
        <AlertCircle className="relative h-2.5 w-2.5" strokeWidth={2.6} />
      ) : tone === "ready" ? (
        <Download className="relative h-2.5 w-2.5" strokeWidth={2.6} />
      ) : (
        <span className="relative h-1 w-1 rounded-full bg-current" />
      )}
    </span>
  )
}

function UpdateBadge({ client, onUpdate }: { client: UpdateClient; onUpdate: () => void }) {
  const phase = resolveClientEffectivePhase(client)
  const active = phase ? activePhases.has(phase) : false
  if (phase === "healthy" || phase === "already-current") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-positive/25 bg-positive/12 px-3 py-1 text-xs font-medium text-positive">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        {phaseLabels[phase]}
      </span>
    )
  }
  if (active) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[#dce02d]/30 bg-[#dce02d]/15 px-3 py-1 text-xs font-medium text-[#dce02d]">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        {phaseLabels[phase!] ?? phase}
      </span>
    )
  }
  if (phase === "rolled-back" || phase === "failed") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-destructive/30 bg-destructive/12 px-3 py-1 text-xs font-medium text-destructive">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        {phaseLabels[phase]}
      </span>
    )
  }
  if (client.skipReason === "newer-than-release") {
    return (
      <span className="shrink-0 whitespace-nowrap rounded-full border border-border bg-background/50 px-3 py-1 text-xs text-muted-foreground">
        高于发布版
      </span>
    )
  }
  if (client.skipReason === "invalid-version") {
    return (
      <span className="shrink-0 whitespace-nowrap rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs text-destructive">
        版本异常
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onUpdate}
      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-95"
    >
      <Download className="h-3.5 w-3.5 shrink-0" />
      立即更新
    </button>
  )
}

export function ClientUpdateCard({
  client,
  onUpdate,
}: {
  client: UpdateClient
  onUpdate: () => void
}) {
  const brand = resolveOsBrand(client.os, client.osName)
  const status = statusMeta[client.status] ?? statusMeta.offline
  const result = parseUpdateResult(client.command)
  const steps = buildPipelineSteps(client)
  const progress = buildPipelineProgress(client)
  const isActive = isClientUpdateActive(client)
  const isFailed = client.phase === "failed" || client.phase === "rolled-back"
  const versionChanged = client.currentVersion !== client.targetVersion

  const connectionDesc = client.status === "offline"
    ? client.phase === "pending"
      ? "离线 · 等待上线"
      : "离线"
    : client.connected
      ? `${status.label} (WS 实时)`
      : `${status.label} (HTTP 轮询)`

  const metricsSummary = client.status !== "offline" && client.metrics
    ? `CPU ${formatMetricPercent(client.metrics.cpu)}% / 内存 ${formatMetricPercent(client.metrics.memory)}%`
    : `上次心跳 ${formatRelativeSeen(client.lastSeen)}`

  return (
    <div
      className={cn(
        "flex flex-col gap-3.5 rounded-2xl border bg-surface/60 p-4 transition-colors hover:bg-surface",
        isActive
          ? "border-[#dce02d]/35"
          : isFailed
            ? "border-destructive/35"
            : "border-border",
      )}
    >
      {/* 卡片头部：OS 徽标 + 设备身份/环境负载 + 版本演进与操作 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-xs"
            style={{ backgroundColor: brand.color }}
            title={brand.label}
          >
            <OsLogo brand={brand} className="h-5 w-5 text-white" />
          </span>

          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-foreground">{client.name}</p>
              <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-medium", status.text)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
                {connectionDesc}
              </span>
              {client.group && (
                <span className="shrink-0 rounded-md border border-border bg-background/40 px-2 py-0.5 text-xs text-muted-foreground">
                  {client.group}
                </span>
              )}
              {client.tags?.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="max-w-24 truncate rounded-md border border-border/70 px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>

            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted-foreground">
              <span>主机: {client.hostname}</span>
              <span className="text-border" aria-hidden>·</span>
              <span>IP: {client.ip}</span>
              <span className="text-border" aria-hidden>·</span>
              <span className="font-sans">{brand.label}</span>
              <span className="text-border" aria-hidden>·</span>
              <span className="font-sans">{metricsSummary}</span>
            </p>
          </div>
        </div>

        {/* 右侧：版本号胶囊 + 状态/更新动作 */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/50 px-2.5 py-1 font-mono text-xs text-foreground">
            <span>v{client.currentVersion || "未知"}</span>
            {versionChanged && (
              <>
                <span className="text-muted-foreground">→</span>
                <strong className="font-semibold text-primary">v{client.targetVersion}</strong>
              </>
            )}
          </span>
          <UpdateBadge client={client} onUpdate={onUpdate} />
        </div>
      </div>

      {/* 五步升级进度：圆环 + 当前步骤，悬停查看完整步骤 */}
      <div
        className="flex min-w-0 items-center gap-2.5 border-t border-border/70 pt-3"
        title={steps.map((step) => step.label).join(" · ")}
        aria-label={`升级进度：${progress.label}，${progress.count} / ${PIPELINE_TOTAL}`}
      >
        <PipelineRing tone={progress.tone} count={progress.count} />
        <span className={cn("min-w-0 flex-1 truncate text-xs font-medium", pipelineLabelToneClass[progress.tone])}>
          {progress.label}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/80">
          {progress.count} / {PIPELINE_TOTAL}
        </span>
      </div>

      {/* 错误或回滚详情 */}
      {(result?.error || result?.rollbackReason) && (
        <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {result.error || result.rollbackReason}
          {result.fromVersion && ` · 已恢复 v${result.fromVersion}`}
        </div>
      )}
    </div>
  )
}

export function ClientUpdatePanel() {
  const { apiRequest, refresh, developerPreview } = useServerData()
  const { confirm } = useConfirm()
  const [updates, setUpdates] = useState<AgentUpdates | null>(null)
  const [signedAgentRelease, setSignedAgentRelease] = useState<AgentReleaseNotes | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastQueue, setLastQueue] = useState<QueueResult | null>(null)
  const [filter, setFilter] = useState<UpdateFilter>("all")
  const [copiedSha, setCopiedSha] = useState(false)

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

  useEffect(() => {
    if (developerPreview || !updates?.release.version || updates.release.notes) return
    const controller = new AbortController()
    void fetch("/api/product-updates", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null
        const payload = await response.json().catch(() => null) as {
          ok?: boolean
          data?: { index?: { releases?: { agent?: AgentReleaseNotes } } }
        } | null
        return payload?.ok ? payload.data?.index?.releases?.agent ?? null : null
      })
      .then((agent) => {
        if (!controller.signal.aborted && agent?.version) setSignedAgentRelease(agent)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [developerPreview, updates?.release.notes, updates?.release.version])

  async function copyReleaseSha() {
    if (!updates?.release.sha256) return
    try {
      await navigator.clipboard.writeText(updates.release.sha256)
      setCopiedSha(true)
      window.setTimeout(() => setCopiedSha(false), 1600)
    } catch {
      setCopiedSha(false)
    }
  }

  async function queue(scope: "all" | "clients", clientIds: string[] = []) {
    if (!updates || submitting) return
    const windowsClients = updates.clients.filter((item) => item.os === "Windows" && item.skipReason !== "not-windows")
    const candidates = scope === "all"
      ? windowsClients.filter((item) => item.skipReason === null)
      : windowsClients.filter((item) => clientIds.includes(item.id))
    const online = candidates.filter((item) => item.status !== "offline").length
    const offline = candidates.length - online
    const expectedSkipped = windowsClients.length - candidates.length
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

  // 只展示 Windows 客户端（与真实服务端 /agent-updates 一致，兼容预览模式包含的 Linux 演示节点）
  const rows = (updates?.clients ?? []).filter((item) => item.os === "Windows" && item.skipReason !== "not-windows")
  const totalCount = rows.length
  const upToDateCount = rows.filter(isClientUpToDate).length
  const activeCount = rows.filter(isClientUpdateActive).length
  const availableCount = rows.filter((item) => item.skipReason === null).length
  const releaseNotes = updates
    ? resolveAgentReleaseNotes(updates.release, signedAgentRelease)
    : { title: undefined, notes: undefined }

  const upToDatePct = totalCount > 0 ? Math.round((upToDateCount / totalCount) * 100) : 0
  const activePct = totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0
  const availablePct = totalCount > 0 ? Math.max(0, 100 - upToDatePct - activePct) : 0

  const filteredRows = rows.filter((client) => {
    if (filter === "active") return isClientUpdateActive(client)
    if (filter === "available") return client.skipReason === null
    if (filter === "current") return isClientUpToDate(client)
    return true
  })

  const filterButtons: Array<{ id: UpdateFilter; label: string; count: number; highlight?: string }> = [
    { id: "all", label: "全部", count: totalCount },
    { id: "active", label: "进行中", count: activeCount, highlight: activeCount > 0 ? "border-[#dce02d]/35 text-[#dce02d]" : undefined },
    { id: "available", label: "待更新", count: availableCount, highlight: availableCount > 0 ? "border-primary/35 text-primary" : undefined },
    { id: "current", label: "已最新", count: upToDateCount },
  ]

  return (
    <PanelShell
      title="客户端更新"
      desc={
        updates
          ? "基于控制服务端签名发布清单，向 Windows Agent 分发升级命令与回滚保护"
          : "正在读取服务端发布清单"
      }
      action={
        <div className="flex flex-wrap items-center gap-1.5">
          {filterButtons.map((item) => {
            const selected = filter === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                  selected
                    ? "border-primary/45 bg-primary/15 text-primary"
                    : item.highlight ?? "border-border bg-surface/60 text-muted-foreground hover:bg-surface hover:text-foreground",
                )}
              >
                {item.label} ({item.count})
              </button>
            )
          })}
        </div>
      }
    >
      <div className="flex h-full flex-col gap-4 overflow-x-hidden overflow-y-auto pr-1">
        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[310px_minmax(0,1fr)]">
          {/* 左侧：发版制品与覆盖率看板 */}
          <aside className="flex min-w-0 flex-col justify-between gap-4 rounded-2xl border border-border bg-surface/50 p-4">
            <div className="flex min-w-0 flex-col gap-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted-foreground">当前发布清单 (latest.json)</span>
                <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-positive/25 bg-positive/12 px-2.5 py-0.5 text-xs font-medium text-positive">
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                  {updates ? "SHA256 已核验" : "读取中"}
                </span>
              </div>

              {/* 版本主卡片 */}
              <div className="rounded-xl border border-primary/30 bg-primary/10 p-3.5">
                <p className="text-xs font-medium text-primary">Windows Agent 正式版</p>
                <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-2xl font-bold tracking-tight text-foreground">
                    {updates ? `v${updates.release.version}` : "—"}
                  </span>
                  <span className="font-mono text-xs text-primary/90">
                    {updates ? `${updates.release.rid} · ${humanBytes(updates.release.sizeBytes)}` : "正在获取..."}
                  </span>
                </div>
              </div>

              {/* 制品元数据 */}
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-background/45 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-muted-foreground">制品文件名</span>
                  <span className="truncate font-mono text-foreground" title={updates?.release.fileName}>
                    {updates?.release.fileName ?? "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-muted-foreground">发布时间</span>
                  <span className="truncate text-foreground">
                    {updates ? new Date(updates.release.publishedAt).toLocaleString() : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-muted-foreground">校验指纹</span>
                  {updates ? (
                    <button
                      type="button"
                      onClick={() => void copyReleaseSha()}
                      title={`点击复制完整 SHA-256：${updates.release.sha256}`}
                      className="inline-flex items-center gap-1 font-mono text-primary transition-opacity hover:opacity-80"
                    >
                      <span>{shortenSha256(updates.release.sha256)}</span>
                      {copiedSha ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </button>
                  ) : (
                    <span className="font-mono text-muted-foreground">—</span>
                  )}
                </div>
              </div>

              {/* 全网版本覆盖率 */}
              <div className="rounded-xl border border-border bg-background/45 p-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">全网版本覆盖率</span>
                  <span className="font-mono font-semibold text-foreground">
                    {upToDateCount} / {totalCount} 台已就绪 ({upToDatePct}%)
                  </span>
                </div>
                <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-surface">
                  {upToDatePct > 0 && (
                    <div
                      className="h-full bg-positive transition-all duration-300"
                      style={{ width: `${upToDatePct}%` }}
                    />
                  )}
                  {activePct > 0 && (
                    <div
                      className="h-full bg-[#dce02d] transition-all duration-300"
                      style={{ width: `${activePct}%` }}
                    />
                  )}
                  {availablePct > 0 && (
                    <div
                      className="h-full bg-primary/55 transition-all duration-300"
                      style={{ width: `${availablePct}%` }}
                    />
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    <strong className="font-mono text-positive">{upToDateCount}</strong> 已最新
                  </span>
                  <span>
                    <strong className="font-mono text-[#dce02d]">{activeCount}</strong> 排队中
                  </span>
                  <span>
                    <strong className="font-mono text-primary">{availableCount}</strong> 待更新
                  </span>
                </div>
              </div>

              {(releaseNotes.title || releaseNotes.notes) && (
                <ReleaseNotesCapsule title={releaseNotes.title} notes={releaseNotes.notes} bodyMaxHeightClass="max-h-64" />
              )}

              {lastQueue && (
                <div className="rounded-xl border border-border bg-background/45 px-3 py-2 text-xs text-muted-foreground">
                  最近操作：已排队 <strong className="font-mono text-foreground">{lastQueue.queued.length}</strong> 台，跳过{" "}
                  <strong className="font-mono text-foreground">{lastQueue.skipped.length}</strong> 台。
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void queue("all")}
              disabled={!updates || submitting || availableCount === 0}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.01] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {availableCount > 0
                ? `全部更新 (${availableCount})`
                : activeCount > 0
                  ? "全部更新（已全部入队）"
                  : "全部更新"}
            </button>
          </aside>

          {/* 右侧：升级进度圆环卡片列表 */}
          <div className="flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-x-hidden lg:overflow-y-auto lg:pr-1">
            {rows.length === 0 ? (
              <div className="flex min-h-[240px] flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-surface/40 text-muted-foreground">
                <Monitor className="h-8 w-8" />
                <p className="text-sm">暂无 Windows 客户端</p>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="flex min-h-[240px] flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-surface/40 text-muted-foreground">
                <Monitor className="h-8 w-8" />
                <p className="text-sm">当前筛选条件下暂无客户端</p>
              </div>
            ) : (
              filteredRows.map((client) => (
                <ClientUpdateCard
                  key={client.id}
                  client={client}
                  onUpdate={() => void queue("clients", [client.id])}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </PanelShell>
  )
}
