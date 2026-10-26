"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import {
  AlertTriangle, ArrowRight, ArrowUpCircle, CheckCircle2, CircleSlash, Download,
  HardDriveDownload, Info, Loader2, Monitor, RefreshCw, Server, XCircle,
} from "lucide-react"
import { useServerData } from "@/components/server-data-context"
import { ReleaseNotesCapsule } from "@/components/settings/release-notes-capsule"
import { useOnboarding } from "@/components/onboarding/onboarding-context"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { updateLocalControl } from "@/lib/local-control-server-client"
import type { LocalControlServerStatus } from "@/lib/local-control-server-types"
import { PANEL_VERSION_LABEL, formatReleaseVersion } from "@/lib/panel-version"
import { serverUpdateIssue } from "@/lib/product-update-status"
import {
  newerPanelInstallState, panelDownloadPercent, panelInstallActive, PANEL_INSTALL_LABELS,
  type PanelInstallState,
} from "@/lib/panel-install-progress"
import { cn } from "@/lib/utils"

type Entry = {
  version: string
  releaseType?: string
  publishedAt: string
  sizeBytes: number
  minPanelVersion?: string
  minServerVersion?: string
  minAgentVersion?: string
  title?: string
  notes?: string
}
type Index = { schemaVersion: number; sequence: number; releases: { panel: Entry; server: Entry; agent: Entry }; publishedAt: string }
type Check = { index: Index; stale: boolean; currentVersion: string | null }
type Runtime = {
  version: string
  apiVersion: number
  minPanelVersion: string
  agentArtifactVersion: string | null
  updateExecutor: boolean
  updateStatus: { phase: string; version: string; error?: string } | null
  updateMode?: string
  updateSourceConfigured?: boolean
  updateExecutorProtocol?: number | null
}
type UpdateBridge = { version?: string; check(force?: boolean): Promise<Check>; installPanel(sequence: number, version: string): Promise<{ phase: string; version: string }>;
  transferRelease?(kind: "server" | "agent", serverUrl: string, apiKey: string, sequence: number, version: string): Promise<unknown>;
  onAvailable?(callback: (check: Check) => void): (() => void) | undefined;
  getPanelInstallState?(): Promise<PanelInstallState>;
  onPanelInstallProgress?(callback: (state: PanelInstallState) => void): (() => void) | undefined;
  onTransferProgress?(callback: (percent: number) => void): (() => void) | undefined }

declare global { interface Window { nachoUpdates?: UpdateBridge } }

type Tone = "primary" | "positive" | "warning" | "danger" | "muted"
type Status = { label: string; tone: Tone }

const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`
const formatTime = (value: string | Date) =>
  new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
const releaseLabel = (entry?: Entry) => entry ? formatReleaseVersion(entry.version, entry.releaseType || "stable") : undefined

function compare(a: string | null, b: string) {
  if (!a || !/^\d+\.\d+\.\d+$/.test(a) || !/^\d+\.\d+\.\d+$/.test(b)) return null
  const x = a.split(".").map(Number), y = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

const TONE_TEXT: Record<Tone, string> = {
  primary: "text-primary",
  positive: "text-positive",
  warning: "text-warning",
  danger: "text-destructive",
  muted: "text-muted-foreground",
}
const TONE_BADGE: Record<Tone, string> = {
  primary: "bg-primary/12 text-primary ring-primary/25",
  positive: "bg-positive/12 text-positive ring-positive/25",
  warning: "bg-warning/12 text-warning ring-warning/25",
  danger: "bg-destructive/12 text-destructive ring-destructive/25",
  muted: "bg-surface text-muted-foreground ring-border",
}

export function UpdatesPanel() {
  const { apiRequest, transferProductUpdate, developerPreview } = useServerData()
  const { serverSource } = useOnboarding()
  const { confirm } = useConfirm()
  const [check, setCheck] = useState<Check | null>(null)
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [panelInstall, setPanelInstall] = useState<PanelInstallState | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const panelBusy = busy === "panel" || panelInstallActive(panelInstall)
  const anyBusy = Boolean(busy) || panelInstallActive(panelInstall)
  const refresh = useCallback(async (force = false) => {
    if (developerPreview) {
      // 预览模式不访问更新服务器，只展示服务端版本卡片。
      setCheck(null)
      setSourceError("开发者预览模式不检查更新")
    } else {
      try {
        const result = window.nachoUpdates
          ? await window.nachoUpdates.check(force)
          : await fetch("/api/product-updates", { cache: "no-store" }).then(async (response) => {
            const body = await response.json() as { ok: boolean; data?: Check; message?: string }
            if (!body.ok || !body.data) throw new Error(body.message || "检查更新失败")
            return body.data
          })
        setCheck(result)
        setSourceError(result.stale ? "网络暂不可用，显示上次验证的发布信息；缓存不能用于安装。" : null)
      } catch (error) {
        setCheck(null)
        setSourceError(error instanceof Error ? error.message : "检查更新失败")
      }
    }
    setCheckedAt(new Date())
    try {
      const nextRuntime = await apiRequest<Runtime>("/runtime-info")
      setRuntime(nextRuntime)
      setServerError(null)
    } catch (error) {
      setRuntime(null)
      if (serverSource?.mode === "local") {
        try {
          const response = await fetch("/api/local-control-server", { cache: "no-store" })
          const body = await response.json() as { ok: boolean; data?: LocalControlServerStatus }
          if (body.ok && body.data?.installed && body.data.version) {
            setRuntime({
              version: body.data.version, apiVersion: 0, minPanelVersion: "0.1.2",
              agentArtifactVersion: null, updateExecutor: false, updateStatus: null,
            })
            setServerError("本机服务尚未提供版本能力接口，升级后可读取 Agent 制品状态。")
            return
          }
        } catch { /* 沿用原始连接错误 */ }
      }
      setServerError(error instanceof Error ? error.message : "服务端尚未连接")
    }
  }, [apiRequest, developerPreview, serverSource?.mode])

  useEffect(() => {
    void refresh()
    const timer = developerPreview ? null : window.setInterval(() => void refresh(), 60_000)
    const unsubscribe = window.nachoUpdates?.onAvailable?.(() => void refresh(true))
    const stopProgress = window.nachoUpdates?.onTransferProgress?.(setProgress)
    return () => {
      if (timer) window.clearInterval(timer)
      unsubscribe?.()
      stopProgress?.()
    }
  }, [developerPreview, refresh])

  useEffect(() => {
    let active = true
    const bridge = window.nachoUpdates
    const accept = (state: PanelInstallState) => {
      if (active) setPanelInstall((current) => newerPanelInstallState(current, state))
    }
    const stop = bridge?.onPanelInstallProgress?.(accept)
    void bridge?.getPanelInstallState?.().then(accept).catch(() => {})
    return () => { active = false; stop?.() }
  }, [])

  async function manualRefresh() {
    if (checking) return
    setChecking(true)
    try { await refresh(true) } finally { setChecking(false) }
  }

  async function installPanel() {
    if (!check || anyBusy || !window.nachoUpdates) return
    if (!await confirm({
      title: "安装新版面板？", description: "面板将退出、安装并重新启动。当前本地设置会保留。",
      body: `${PANEL_VERSION_LABEL} → ${formatReleaseVersion(check.index.releases.panel.version, check.index.releases.panel.releaseType || "stable")}`,
      confirmLabel: "下载并安装", tone: "warning",
    })) return
    setSourceError(null)
    setPanelInstall((current) => ({
      revision: current?.revision ?? 0, phase: "preparing", version: check.index.releases.panel.version,
      downloadedBytes: 0, totalBytes: check.index.releases.panel.sizeBytes, error: null,
    }))
    setBusy("panel")
    try {
      await window.nachoUpdates.installPanel(check.index.sequence, check.index.releases.panel.version)
      // 旧桌面桥没有进度事件时也保留退出前的安装状态。
      setPanelInstall((current) => current ? { ...current, phase: "installing" } : current)
    } catch (error) {
      setPanelInstall((current) => current ? {
        ...current, phase: "failed", error: error instanceof Error ? error.message : "面板安装失败",
      } : current)
      setBusy(null)
    }
  }

  async function installServer() {
    if (!check || !runtime || anyBusy) return
    if (!await confirm({
      title: "升级服务端？", description: "升级期间连接将暂时断开，验证失败时会恢复旧版本。",
      body: `${runtime.version} → ${formatReleaseVersion(check.index.releases.server.version, check.index.releases.server.releaseType || "stable")}`,
      confirmLabel: "开始升级", tone: "warning",
    })) return
    setBusy("server")
    try {
      if (!check.currentVersion) throw new Error("需要 Windows 桌面面板才能发起服务端升级")
      const minAgent = check.index.releases.server.minAgentVersion
      if (minAgent) {
        const devices = await apiRequest<Array<{ os: string; status: string; version: string }>>("/clients")
        const incompatible = devices.filter((device) =>
          device.os === "Windows" && device.status !== "unregistered" &&
          (compare(device.version, minAgent) === null || compare(device.version, minAgent) === -1))
        if (incompatible.length) throw new Error(`${incompatible.length} 台 Agent 低于 ${minAgent}，请先手动更新`)
      }
      if (serverSource?.mode === "local") {
        await updateLocalControl(check.index.releases.server.version, check.currentVersion, check.index.sequence)
      } else if (check.index.schemaVersion === 4) {
        setServerError("源码传输完成后服务端将短暂重启；正在准备并验证源码。")
        await transferProductUpdate("server", { version: check.index.releases.server.version, sequence: check.index.sequence })
      } else {
        await apiRequest("/product-updates/server", {
          method: "POST",
          body: JSON.stringify({ version: check.index.releases.server.version, panelVersion: check.currentVersion }),
        })
      }
      await new Promise((resolve) => setTimeout(resolve, 3000))
      let completed = false
      for (let attempt = 0; attempt < 240; attempt++) {
        try {
          const state = await apiRequest<Runtime>("/runtime-info")
          setRuntime(state)
          if (state.version === check.index.releases.server.version &&
              (serverSource?.mode === "local" || state.updateStatus?.phase === "healthy")) {
            completed = true
            break
          }
          if (state.updateStatus?.phase === "failed" || state.updateStatus?.phase === "rolled-back") {
            throw new Error(`升级失败或已回滚：${state.updateStatus.error || state.updateStatus.phase}`)
          }
        } catch (error) {
          if (error instanceof Error && /失败或已回滚/.test(error.message)) throw error
        }
        await new Promise((resolve) => setTimeout(resolve, 5000))
      }
      if (!completed) throw new Error("服务端重启和健康验证超时，请检查升级状态")
      setServerError(null)
      await refresh(true)
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "升级请求失败")
    } finally { setBusy(null) }
  }

  async function syncAgent() {
    if (!runtime || anyBusy) return
    setBusy("agent")
    try {
      if (check?.index.schemaVersion === 4) {
        await transferProductUpdate("agent", { version: check.index.releases.agent.version, sequence: check.index.sequence })
      } else {
        await apiRequest("/product-updates/agent-artifact", {
          method: "POST", signal: AbortSignal.timeout(20 * 60_000),
        })
      }
      await refresh(true)
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Agent 制品准备失败")
    } finally { setBusy(null) }
  }

  const releases = check?.index.releases
  const localMode = serverSource?.mode === "local"
  const serverIssue = runtime ? serverUpdateIssue(runtime, localMode) : null
  const agentIssue = runtime ? serverUpdateIssue(runtime, localMode, "agent") : null
  const panelCompare = releases ? compare(check.currentVersion, releases.panel.version) : null
  const panelNew = panelCompare === -1
  const serverNew = releases && runtime ? compare(runtime.version, releases.server.version) === -1 : false
  const agentNew = Boolean(releases && runtime &&
    (!runtime.agentArtifactVersion || compare(runtime.agentArtifactVersion, releases.agent.version) === -1))
  const panelRequired = releases?.server.minPanelVersion && check
    ? compare(check.currentVersion, releases.server.minPanelVersion) === -1 : false
  const connectedPanelIncompatible = runtime && check
    ? compare(check.currentVersion, runtime.minPanelVersion) === -1 : false
  const desktop = typeof window !== "undefined" && Boolean(window.nachoUpdates)
  const stale = Boolean(check?.stale)
  const transferring = progress !== null && (busy === "server" || busy === "agent")

  const panelStatus: Status = !releases ? { label: "未取得", tone: "muted" }
    : panelNew ? { label: "可更新", tone: "primary" }
    : panelCompare === 1 ? { label: "高于推荐", tone: "warning" }
    : { label: "已是最新", tone: "positive" }
  const serverStatus: Status = !runtime ? { label: "未连接", tone: "muted" }
    : runtime.updateStatus?.phase === "failed" || runtime.updateStatus?.phase === "rolled-back" ? { label: "升级异常", tone: "danger" }
    : !releases ? { label: "未取得", tone: "muted" }
    : serverNew ? { label: "可更新", tone: "primary" }
    : { label: "已是最新", tone: "positive" }
  const agentStatus: Status = !runtime ? { label: "未连接", tone: "muted" }
    : !releases ? { label: "未取得", tone: "muted" }
    : agentNew ? { label: "待准备", tone: "primary" }
    : { label: "已就绪", tone: "positive" }

  const updateCount = [panelNew, serverNew, agentNew].filter(Boolean).length

  return (
    <div className="flex flex-col gap-4 pb-4">
      <OverviewCard
        releasesAvailable={Boolean(releases)}
        updateCount={updateCount}
        sequence={check?.index.sequence}
        publishedAt={check?.index.publishedAt}
        checkedAt={checkedAt}
        stale={stale}
        developerPreview={developerPreview}
        checking={checking}
        onCheck={() => void manualRefresh()}
      />

      {(developerPreview || (sourceError && !developerPreview) || connectedPanelIncompatible || serverError) && (
        <div className="flex flex-col gap-2">
          {developerPreview && (
            <Notice tone="info">开发者预览模式：使用内置演示数据，不访问更新服务器，更新检查与安装已禁用。</Notice>
          )}
          {sourceError && !developerPreview && <Notice tone="warning">{sourceError}</Notice>}
          {connectedPanelIncompatible && (
            <Notice tone="warning" alert>
              当前服务端要求面板至少 {runtime?.minPanelVersion}；请先升级面板。版本不兼容的操作需暂停，更新与连接设置仍可访问。
            </Notice>
          )}
          {serverError && <Notice tone="danger">{serverError}</Notice>}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ComponentCard
          icon={<Monitor className="size-5" />}
          title="Windows 面板"
          subtitle="桌面控制面板"
          status={panelStatus}
          current={PANEL_VERSION_LABEL}
          latest={releaseLabel(releases?.panel)}
          hasUpdate={panelNew}
          release={releases?.panel}
          note={!desktop ? "安装新版需使用 Windows 桌面面板。" : !releases ? "尚未取得发布信息。" :
            panelNew ? "新版本已就绪，安装时面板会自动重启。" : panelCompare === 1 ? "已安装版本高于推荐版本。" : "当前已是推荐版本。"}
          progress={panelInstall && panelInstall.phase !== "idle" ? <PanelInstallProgress state={panelInstall} /> : undefined}
          action={panelBusy ? PANEL_INSTALL_LABELS[panelInstall?.phase || "preparing"] : panelInstall?.phase === "failed" ? "重试下载并安装" : "下载并安装"}
          loading={panelBusy}
          disabled={!panelNew || !desktop || stale || anyBusy}
          onClick={() => void installPanel()}
        />
        <ComponentCard
          icon={<Server className="size-5" />}
          title="控制服务端"
          subtitle={localMode ? "本机部署" : "云端部署"}
          status={serverStatus}
          current={runtime?.version || "未连接"}
          latest={releaseLabel(releases?.server)}
          hasUpdate={serverNew}
          release={releases?.server}
          note={serverIssue || (panelRequired ? "需先升级面板后才能升级服务端。" : runtime?.updateStatus
            ? `执行状态：${runtime.updateStatus.phase}${runtime.updateStatus.error ? ` · ${runtime.updateStatus.error}` : ""}`
            : "服务端独立升级，失败时自动回滚到旧版本。")}
          noteTone={serverIssue || panelRequired ? "warning" : undefined}
          progress={transferring && busy === "server" ? <TransferProgress percent={progress} label="服务端源码传输" /> : undefined}
          action={busy === "server" ? "正在升级…" : localMode ? "升级本机服务" : "升级云端服务"}
          loading={busy === "server"}
          icon2={<ArrowUpCircle aria-hidden="true" className="size-4" />}
          disabled={!serverNew || stale || panelRequired || Boolean(serverIssue) || !desktop ||
            (!localMode && (!runtime?.updateExecutor || serverSource?.mode !== "cloud")) || anyBusy}
          onClick={() => void installServer()}
        />
        <ComponentCard
          icon={<HardDriveDownload className="size-5" />}
          title="Agent 制品"
          subtitle="与服务端同批发布"
          status={agentStatus}
          current={runtime?.agentArtifactVersion || "无"}
          currentLabel="已准备"
          latest={releaseLabel(releases?.agent)}
          hasUpdate={agentNew}
          release={releases?.agent}
          note={agentIssue && agentIssue !== serverIssue ? agentIssue : "制品准备完成后，仍需逐台或批量手动下发到客户端。"}
          noteTone={agentIssue && agentIssue !== serverIssue ? "warning" : undefined}
          progress={transferring && busy === "agent" ? <TransferProgress percent={progress} label="Agent 制品传输" /> : undefined}
          action={busy === "agent" ? "正在准备…" : "准备新版制品"}
          loading={busy === "agent"}
          icon2={<HardDriveDownload aria-hidden="true" className="size-4" />}
          disabled={!agentNew || stale || Boolean(agentIssue) || !runtime || anyBusy}
          onClick={() => void syncAgent()}
          footer={
            <Link href="/clients" className="group inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              前往「客户端 → 客户端更新」下发
              <ArrowRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </Link>
          }
        />
      </div>
    </div>
  )
}

function OverviewCard({ releasesAvailable, updateCount, sequence, publishedAt, checkedAt, stale, developerPreview, checking, onCheck }: {
  releasesAvailable: boolean; updateCount: number; sequence?: number; publishedAt?: string; checkedAt: Date | null
  stale: boolean; developerPreview: boolean; checking: boolean; onCheck: () => void
}) {
  const state: { title: string; desc: string; tone: Tone; icon: ReactNode } = developerPreview
    ? { title: "预览模式", desc: "更新检查已禁用，仅展示服务端版本信息。", tone: "muted", icon: <CircleSlash className="size-6" /> }
    : !releasesAvailable
      ? { title: "无法取得发布信息", desc: "请检查网络连接后重新检查更新。", tone: "warning", icon: <AlertTriangle className="size-6" /> }
      : updateCount > 0
        ? { title: `${updateCount} 项组件可更新`, desc: "建议先升级面板，再升级服务端并准备 Agent 制品。", tone: "primary", icon: <ArrowUpCircle className="size-6" /> }
        : { title: "所有组件均为推荐版本", desc: "更新服务器每分钟自动检查一次新发布。", tone: "positive", icon: <CheckCircle2 className="size-6" /> }

  return (
    <section aria-labelledby="updates-overview-title" className="card-glow flex flex-col gap-5 rounded-3xl bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-2xl ring-1", TONE_BADGE[state.tone])} aria-hidden="true">
          {state.icon}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="text-xs font-medium text-muted-foreground">产品更新</p>
          <h2 id="updates-overview-title" className="mt-1 text-lg font-semibold text-balance">{state.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">{state.desc}</p>
          <dl className="mt-3 flex flex-wrap gap-2 text-xs">
            {sequence !== undefined && <Meta label="发布序列" value={`#${sequence}`} />}
            {publishedAt && <Meta label="发布于" value={formatTime(publishedAt)} />}
            {checkedAt && <Meta label="上次检查" value={formatTime(checkedAt)} />}
            {stale && <Meta label="数据" value="缓存" tone="warning" />}
          </dl>
        </div>
      </div>
      <button
        type="button"
        onClick={onCheck}
        disabled={checking}
        aria-busy={checking}
        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 self-start rounded-xl border border-border bg-surface/60 px-4 text-sm font-medium transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60 sm:self-center"
      >
        <RefreshCw aria-hidden="true" className={cn("size-4", checking && "animate-spin motion-reduce:animate-none")} />
        {checking ? "检查中…" : "检查更新"}
      </button>
    </section>
  )
}

function Meta({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className={cn("flex items-center gap-1.5 rounded-full bg-surface/80 px-2.5 py-1 ring-1 ring-border", tone && TONE_BADGE[tone])}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

function Notice({ tone, alert = false, children }: { tone: "info" | "warning" | "danger"; alert?: boolean; children: ReactNode }) {
  const styles = {
    info: { box: "border-primary/25 bg-primary/8", icon: <Info className="size-4 text-primary" /> },
    warning: { box: "border-warning/25 bg-warning/8", icon: <AlertTriangle className="size-4 text-warning" /> },
    danger: { box: "border-destructive/25 bg-destructive/8", icon: <XCircle className="size-4 text-destructive" /> },
  }[tone]
  return (
    <p role={alert ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm leading-relaxed text-foreground/90", styles.box)}>
      <span aria-hidden="true" className="mt-0.5 shrink-0">{styles.icon}</span>
      <span className="min-w-0 break-words">{children}</span>
    </p>
  )
}

function ComponentCard({
  icon, icon2, title, subtitle, status, current, currentLabel = "当前版本", latest, hasUpdate, release, note, noteTone,
  progress, action, loading = false, disabled, onClick, footer,
}: {
  icon: ReactNode; icon2?: ReactNode; title: string; subtitle: string; status: Status; current: string; currentLabel?: string
  latest?: string; hasUpdate: boolean; release?: Entry; note: string; noteTone?: "warning"; progress?: ReactNode
  action: string; loading?: boolean; disabled: boolean; onClick: () => void; footer?: ReactNode
}) {
  const ready = !disabled && !loading
  return (
    <section aria-label={title} className="card-glow flex flex-col gap-4 rounded-3xl bg-card p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-surface/60 text-foreground" aria-hidden="true">
            {icon}
          </span>
          <div className="min-w-0 leading-tight">
            <h3 className="truncate text-sm font-semibold">{title}</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1", TONE_BADGE[status.tone])}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          {status.label}
        </span>
      </header>

      <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface/40 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted-foreground">{currentLabel}</p>
          <p className="mt-1 truncate font-mono text-sm font-semibold tabular-nums" title={current}>{current}</p>
        </div>
        <ArrowRight aria-hidden="true" className={cn("size-4 shrink-0", hasUpdate ? "text-primary" : "text-muted-foreground/50")} />
        <div className="min-w-0 flex-1 text-right">
          <p className="text-[11px] text-muted-foreground">最新发布</p>
          <p className={cn("mt-1 truncate font-mono text-sm font-semibold tabular-nums", hasUpdate ? "text-primary" : latest ? "text-foreground" : "text-muted-foreground")} title={latest}>
            {latest ?? "未取得"}
          </p>
        </div>
      </div>

      {release && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{size(release.sizeBytes)}</span>
          <span aria-hidden="true" className="size-1 rounded-full bg-muted-foreground/40" />
          <span className="tabular-nums">发布于 {formatTime(release.publishedAt)}</span>
        </p>
      )}

      <p className={cn("text-xs leading-relaxed text-pretty", noteTone ? TONE_TEXT[noteTone] : "text-muted-foreground")}>{note}</p>

      {(release?.title || release?.notes) && <ReleaseNotesCapsule title={release.title} notes={release.notes} />}

      {progress}

      <div className="mt-auto flex flex-col gap-3 pt-1">
        <button
          type="button"
          disabled={disabled}
          aria-busy={loading}
          onClick={onClick}
          className={cn(
            "inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed",
            ready ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : loading ? "bg-primary/80 text-primary-foreground"
              : "border border-border bg-surface/50 text-muted-foreground",
          )}
        >
          {loading
            ? <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            : icon2 ?? <Download aria-hidden="true" className="size-4" />}
          {action}
        </button>
        {footer && <div className="flex justify-center">{footer}</div>}
      </div>
    </section>
  )
}

function ProgressTrack({ percent, label, valueText }: { percent: number | null; label: string; valueText: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={valueText}>
      <div
        className={cn("h-full rounded-full bg-primary", percent === null
          ? "w-1/3 animate-pulse motion-reduce:animate-none"
          : "transition-[width] duration-200 motion-reduce:transition-none")}
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </div>
  )
}

function TransferProgress({ percent, label }: { percent: number | null; label: string }) {
  return (
    <div role="status" className="flex flex-col gap-2 rounded-2xl border border-border bg-surface/40 p-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="text-foreground">{label}</span>
        {percent !== null && <span className="font-mono tabular-nums text-muted-foreground">{percent}%</span>}
      </div>
      <ProgressTrack percent={percent} label={`${label}进度`} valueText={percent === null ? label : `${percent}%`} />
    </div>
  )
}

function PanelInstallProgress({ state }: { state: PanelInstallState }) {
  const percent = panelDownloadPercent(state)
  const failed = state.phase === "failed"
  return (
    <div className={cn("flex flex-col gap-2 rounded-2xl border p-3 text-xs", failed ? "border-destructive/30 bg-destructive/8" : "border-border bg-surface/40")}>
      <div className="flex items-center justify-between gap-3">
        <p role={failed ? "alert" : "status"} className={failed ? "break-words text-destructive" : "text-foreground"}>
          {failed ? state.error || PANEL_INSTALL_LABELS.failed : PANEL_INSTALL_LABELS[state.phase]}
        </p>
        {!failed && percent !== null && <span className="font-mono tabular-nums text-muted-foreground">{percent}%</span>}
      </div>
      {!failed && (
        <ProgressTrack percent={percent} label="面板安装包下载进度"
          valueText={percent === null ? PANEL_INSTALL_LABELS[state.phase] : `${percent}% · ${PANEL_INSTALL_LABELS[state.phase]}`} />
      )}
      {state.totalBytes !== null && (
        <p className="tabular-nums text-muted-foreground">已下载 {size(state.downloadedBytes)} / {size(state.totalBytes)}</p>
      )}
    </div>
  )
}
