"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import {
  AlertTriangle, ArrowRight, ArrowUpCircle, Download, HardDriveDownload, Info, Loader2, Monitor, RefreshCw, Server, XCircle,
} from "lucide-react"
import { useServerData } from "@/components/server-data-context"
import { PanelInstallProgress, TransferProgress } from "@/components/settings/install-progress"
import { ReleaseNotesCapsule } from "@/components/settings/release-notes-capsule"
import { useOnboarding } from "@/components/onboarding/onboarding-context"
import { useConfirm } from "@/components/ui/confirm-dialog"
import type { LocalControlServerStatus } from "@/lib/local-control-server-types"
import { PANEL_VERSION_LABEL, formatReleaseVersion } from "@/lib/panel-version"
import {
  canOfferInstall, installationSourceNotice, versionOrder, type DesktopRelease, type GithubCheck,
  type ReleaseChannel, type ReleasePart, type UpdateSettings,
} from "@/lib/github-update-ui"
import { newerPanelInstallState, panelInstallActive, PANEL_INSTALL_LABELS, type PanelInstallState } from "@/lib/panel-install-progress"
import { cn } from "@/lib/utils"

type Entry = { version: string; releaseType: string; publishedAt: string | null; sizeBytes: number; title?: string; notes?: string }
type Runtime = {
  version: string; minPanelVersion: string; agentArtifactVersion: string | null; updateExecutor: boolean
  updateStatus: { phase: string; version?: string | null; error?: string } | null
  capabilities?: { productUpdatesV5?: boolean }
  updateExecutorProtocol?: number | null
}
type Tone = "primary" | "positive" | "warning" | "danger" | "muted"
type Status = { label: string; tone: Tone }
const channels: ReleaseChannel[] = ["stable", "beta", "alpha"]
const size = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1) + " MiB"
const formatTime = (value: string | Date) =>
  new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
const label = (entry?: Entry) => entry && formatReleaseVersion(entry.version, entry.releaseType)
const inlineButton = "rounded-xl border border-border bg-surface/60 px-3 py-2 text-xs font-medium hover:bg-surface disabled:opacity-50"
const field = "mt-1 w-full min-w-0 rounded-xl border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary"

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


function releaseEntry(part: ReleasePart | undefined, asset: "installer" | "source" | "agent"): Entry | undefined {
  const release = part?.release
  const sizeBytes = release?.sizeBytesByAsset[asset]
  if (!release || part?.status === "locked" || sizeBytes === undefined) return undefined
  return { version: release.target.version, releaseType: release.target.channel, publishedAt: release.publishedAt, sizeBytes, title: release.title, notes: release.notes }
}

function releaseStatus(part: ReleasePart | undefined, available: boolean, disconnected = false): Status {
  if (disconnected) return { label: "未连接", tone: "muted" }
  if (!part || part.status === "not-found") return { label: "暂无发布", tone: "muted" }
  if (part.status === "locked") return { label: "未放行", tone: "warning" }
  if (part.status === "stale") return { label: "缓存", tone: "warning" }
  if (part.status === "error") return { label: "未通过验证", tone: "danger" }
  return available ? { label: "可更新", tone: "primary" } : { label: "无更高版本", tone: "positive" }
}

export function UpdatesPanel() {
  const { apiRequest, transferProductUpdate, developerPreview } = useServerData()
  const { serverSource } = useOnboarding()
  const { confirm } = useConfirm()
  const [bridge, setBridge] = useState<typeof window.nachoUpdates>()
  const [settings, setSettings] = useState<UpdateSettings | null>(null)
  const [check, setCheck] = useState<GithubCheck | null>(null)
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [checking, setChecking] = useState(false)
  const [changing, setChanging] = useState(false)
  const [busy, setBusy] = useState<"panel" | "server" | "agent" | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [panelInstall, setPanelInstall] = useState<PanelInstallState | null>(null)
  const [profileText, setProfileText] = useState("")
  const [fingerprintText, setFingerprintText] = useState("")
  const [formOpen, setFormOpen] = useState(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    setBridge(window.nachoUpdates)
    return () => { mounted.current = false }
  }, [])

  const localMode = serverSource?.mode === "local"
  const refreshRuntime = useCallback(async () => {
    try {
      const value = await apiRequest<Runtime>("/runtime-info")
      if (mounted.current) { setRuntime(value); setServerError(null) }
    } catch (error) {
      if (localMode && !developerPreview) {
        try {
          const response = await fetch("/api/local-control-server", { cache: "no-store" })
          const body = await response.json() as { ok: boolean; data?: LocalControlServerStatus }
          if (body.ok && body.data?.installed && body.data.version) {
            if (mounted.current) setRuntime({ version: body.data.version, minPanelVersion: "0.0.0", agentArtifactVersion: null, updateExecutor: false, updateStatus: null })
            return
          }
        } catch { /* 保留原连接错误。 */ }
      }
      if (mounted.current) {
        setRuntime(null)
        setServerError(error instanceof Error ? error.message : "控制服务端尚未连接")
      }
    }
  }, [apiRequest, developerPreview, localMode])

  const refresh = useCallback(async (force = false) => {
    if (developerPreview || !bridge) return
    try {
      const result = await bridge.check(force)
      if (mounted.current) setCheck(result)
    } catch (error) {
      if (mounted.current) {
        setCheck(null)
        setNotice({ text: error instanceof Error ? error.message : "GitHub 更新检查失败", error: true })
      }
    }
  }, [bridge, developerPreview])

  useEffect(() => { void refreshRuntime() }, [refreshRuntime])
  useEffect(() => {
    if (!bridge || developerPreview) return
    let active = true
    const update = (state: PanelInstallState) => { if (active) setPanelInstall((previous) => newerPanelInstallState(previous, state)) }
    void bridge.readSettings().then(value => { if (active) setSettings(value) }).catch(error => {
      if (active) setNotice({ text: String(error), error: true })
    })
    void refresh()
    void bridge.getPanelInstallState?.().then(update).catch(() => {})
    const stopA = bridge.onAvailable?.(result => { if (active) setCheck(result) })
    const stopB = bridge.onPanelInstallProgress?.(update)
    const stopC = bridge.onTransferProgress?.(setProgress)
    return () => { active = false; stopA?.(); stopB?.(); stopC?.() }
  }, [bridge, developerPreview, refresh])

  async function checkNow() {
    setChecking(true)
    setNotice(null)
    try { await Promise.all([refresh(true), refreshRuntime()]) } finally { setChecking(false) }
  }
  async function change(action: () => Promise<UpdateSettings>) {
    setChanging(true)
    setNotice(null)
    try {
      setSettings(await action())
      setCheck(null)
      await refresh()
      return true
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "更新设置变更失败", error: true })
      return false
    } finally { setChanging(false) }
  }

  async function waitForServer(version: string) {
    for (let attempt = 0; attempt < 240 && mounted.current; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      const next = await apiRequest<Runtime>("/runtime-info").catch(() => null)
      if (!next || !mounted.current) continue
      setRuntime(next)
      if (next.updateStatus?.version !== version) continue
      if (next.updateStatus.phase === "failed" || next.updateStatus.phase === "rolled-back") {
        throw new Error("升级失败或已回滚：" + (next.updateStatus.error || next.updateStatus.phase))
      }
      if (next.version === version && next.updateStatus.phase === "healthy") return
    }
    if (mounted.current) throw new Error("服务端健康确认超时，请检查升级状态")
  }

  const panelPart = check?.components.panel
  const serverPart = check?.components.server
  const panelEntry = releaseEntry(panelPart, "installer")
  const serverEntry = releaseEntry(serverPart, "source")
  const agentEntry = releaseEntry(serverPart, "agent")
  const panelBusy = busy === "panel" || panelInstallActive(panelInstall)
  const anyBusy = Boolean(busy || changing || checking || panelInstallActive(panelInstall))
  const panelNew = canOfferInstall(panelPart, check?.currentVersion ?? bridge?.version ?? null)
  const serverNew = canOfferInstall(serverPart, runtime?.version ?? null)
  const agentNew = Boolean(runtime && canOfferInstall(serverPart, runtime.agentArtifactVersion, true))
  const panelRequired = versionOrder(check?.currentVersion, serverPart?.release?.compatibility.minPanelVersion) === -1
  const needsHost = !localMode && (!runtime?.updateExecutor || runtime.updateExecutorProtocol !== 5)
  const needsTransport = runtime?.capabilities?.productUpdatesV5 !== true
  const source = settings?.profiles.find(profile => profile.id === settings.profileId)
  const selectedMatches = Boolean(check && settings && check.profileId === settings.profileId && check.channel === settings.channel)

  async function apply(kind: "panel" | "server" | "agent", release?: DesktopRelease | null) {
    if (!release || !bridge || anyBusy || developerPreview || !selectedMatches) return
    const warning = installationSourceNotice(release)
    const title = kind === "panel" ? "安装新版面板？" : kind === "server" ? "升级控制服务端？" : "准备新版 Agent 制品？"
    if (!await confirm({
      title,
      description: kind === "panel" ? "验证完成后面板将退出、安装并重新启动。" :
        kind === "server" ? "升级期间连接会中断，验证失败会回滚。" : "这里只准备制品，不下发安装命令。",
      body: formatReleaseVersion(release.target.version, release.target.channel) + (warning ? "\n" + warning : ""),
      confirmLabel: kind === "agent" ? "下载并准备" : "下载并升级", tone: "warning",
    })) return
    setBusy(kind)
    setNotice(null)
    setProgress(null)
    try {
      if (kind === "panel") await bridge.installPanel(release.target)
      else if (kind === "server" && localMode) await bridge.installLocalServer(release.target)
      else {
        await transferProductUpdate(kind, release.target)
        if (kind === "server") await waitForServer(release.target.version)
      }
      if (kind !== "panel" && mounted.current) await refreshRuntime()
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "更新未完成", error: true })
    } finally { if (mounted.current) { setBusy(null); setProgress(null) } }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-4">
      <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">GitHub 更新</h2>
            <p className="mt-1 text-xs text-muted-foreground">面板与服务端独立检查，安装由你确认。</p>
            {check?.checkedAt && <p className="mt-1 text-xs text-muted-foreground">检查于 {formatTime(check.checkedAt)}</p>}
          </div>
          <button type="button" className={cn(inlineButton, "inline-flex items-center gap-2")} disabled={!bridge || developerPreview || anyBusy} onClick={() => void checkNow()}>
            <RefreshCw className={cn("size-3.5", checking && "animate-spin motion-reduce:animate-none")} />{checking ? "正在检查" : "检查更新"}
          </button>
        </header>
        {developerPreview ? <Notice tone="info">开发者预览模式不检查更新。</Notice> : !bridge ?
          <Notice tone="info">使用 Windows 桌面版检查和安装更新。</Notice> : settings ? (
          <>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <label className="min-w-0 text-xs font-medium">更新来源
                <select className={field} value={settings.profileId} disabled={anyBusy}
                  onChange={e => { const id = e.target.value; void change(() => bridge.select(id, settings.channel)) }}>
                  {settings.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.official ? "官方" : "非官方 · " + profile.label}</option>)}
                </select>
              </label>
              <label className="min-w-0 text-xs font-medium">发布渠道
                <select className={field} value={settings.channel} disabled={anyBusy}
                  onChange={e => { const channel = e.target.value as ReleaseChannel; void change(() => bridge.select(settings.profileId, channel)) }}>
                  {channels.map(channel => <option key={channel} value={channel}>{channel[0].toUpperCase() + channel.slice(1)}</option>)}
                </select>
              </label>
            </div>
            {source && !source.official && <Notice tone="warning" alert>
              <div className="min-w-0 space-y-1 break-all"><p>非官方来源 · {source.label}</p>
                <p>{source.repositories[settings.channel].panel} / {source.repositories[settings.channel].server}</p>
                <p className="font-mono">{source.signerFingerprint}</p></div>
            </Notice>}
            <p className="text-xs text-muted-foreground">
              设备身份与签名密钥已由系统在后台自动托管与跟随轮换，无需手动输入或导入任何密钥。
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={inlineButton} disabled={anyBusy} aria-expanded={formOpen} onClick={() => setFormOpen(!formOpen)}>添加非官方来源</button>
              {source && !source.official && <button type="button" className={inlineButton} disabled={anyBusy}
                onClick={async () => {
                  if (await confirm({ title: "移除该非官方来源？", description: "移除后切回官方 Stable，不自动降级。", confirmLabel: "移除来源", tone: "warning" }))
                    await change(() => bridge.removeProfile(source.id))
                }}>移除当前来源</button>}
            </div>
            {formOpen && <form className="grid gap-3 rounded-xl border border-border p-3" onSubmit={async event => {
              event.preventDefault()
              if (!await confirm({ title: "信任非官方签名者？", description: "请从仓库之外核对完整公钥指纹。签名有效不代表该版本由 Nacho 发布。", confirmLabel: "信任该来源", tone: "warning" })) return
              if (await change(() => bridge.trustProfile(profileText, fingerprintText.trim().toLowerCase()))) {
                setFormOpen(false); setProfileText(""); setFingerprintText("")
              }
            }}>
              <label className="text-xs">来源配置 JSON
                <textarea className={cn(field, "font-mono")} rows={3} required maxLength={8192} value={profileText} onChange={e => setProfileText(e.target.value)} />
              </label>
              <label className="text-xs">从独立来源核对的 Ed25519 SHA-256 指纹
                <input className={cn(field, "font-mono")} required maxLength={64} pattern="[0-9A-Fa-f]{64}" autoComplete="off"
                  value={fingerprintText} onChange={e => setFingerprintText(e.target.value)} />
              </label>
              <button type="submit" className={cn(inlineButton, "justify-self-start")} disabled={anyBusy}>核对并保存</button>
            </form>}
          </>
        ) : null}
      </section>
      {notice && <Notice tone={notice.error ? "danger" : "info"}>{notice.text}</Notice>}
      {serverError && <Notice tone="warning">{serverError}</Notice>}
      {([["面板", panelPart], ["服务端", serverPart]] as const).map(([component, part]) =>
        part && ["locked", "stale", "error"].includes(part.status) && <Notice key={component} tone="warning">
          {component}：{part.message ?? (part.status === "stale" ? "显示上次验证的结果；缓存不能用于安装。" : "当前未取得可用的已验证发行。")}
        </Notice>)}

      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ComponentCard icon={<Monitor className="size-5" />} title="Windows 面板" subtitle="桌面控制面板"
          status={releaseStatus(panelPart, panelNew)} current={PANEL_VERSION_LABEL} latest={label(panelEntry)} hasUpdate={panelNew} release={panelEntry}
          note={panelEntry && panelPart?.release ? (installationSourceNotice(panelPart.release) ?? "安装时面板会退出并重启。") : "尚未取得可用的面板版本。"}
          progress={panelInstall && panelInstall.phase !== "idle" ? <PanelInstallProgress state={panelInstall} /> : undefined}
          action={panelBusy ? PANEL_INSTALL_LABELS[panelInstall?.phase || "preparing"] : "下载并安装"} loading={panelBusy}
          disabled={!panelNew || !selectedMatches || developerPreview || anyBusy} onClick={() => void apply("panel", panelPart?.release)} />
        <ComponentCard icon={<Server className="size-5" />} title="控制服务端" subtitle={localMode ? "本机部署" : "远程部署"}
          status={releaseStatus(serverPart, serverNew, !runtime)} current={runtime?.version || "未连接"} latest={label(serverEntry)} hasUpdate={serverNew} release={serverEntry}
          note={panelRequired ? "该版本需要更新的面板。" : runtime && (needsHost || (!localMode && needsTransport)) ?
            "远程控制端需先手动迁移到支持 GitHub v5 的升级执行器。" : runtime?.updateStatus?.phase ?
            "最近一次升级：" + runtime.updateStatus.phase : "安装由控制端验签并执行。"}
          progress={busy === "server" && progress !== null ? <TransferProgress percent={progress} label="服务端源码传输" /> : undefined}
          action={busy === "server" ? "正在升级…" : localMode ? "升级本机服务" : "升级远程服务"} loading={busy === "server"}
          icon2={<ArrowUpCircle className="size-4" />} disabled={!serverNew || !selectedMatches || !runtime || !bridge || developerPreview || anyBusy || panelRequired || needsHost || (!localMode && needsTransport)}
          onClick={() => void apply("server", serverPart?.release)} />
        <ComponentCard icon={<HardDriveDownload className="size-5" />} title="Agent 制品" subtitle="与服务端同版本"
          status={releaseStatus(serverPart, agentNew, !runtime)} current={runtime?.agentArtifactVersion || "无"} currentLabel="已准备" latest={label(agentEntry)}
          hasUpdate={agentNew} release={agentEntry} note={needsTransport && runtime ? "控制服务端需支持 GitHub v5 制品暂存。" : "准备完成后，仍需在客户端更新页手动下发。"}
          progress={busy === "agent" && progress !== null ? <TransferProgress percent={progress} label="Agent 制品传输" /> : undefined}
          action={busy === "agent" ? "正在准备…" : "准备新版制品"} loading={busy === "agent"} disabled={!agentNew || !selectedMatches || !bridge || developerPreview || anyBusy || needsTransport || panelRequired}
          onClick={() => void apply("agent", serverPart?.release)} footer={<Link href="/clients" className="text-xs text-primary hover:underline">前往客户端更新</Link>} />
      </div>
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
          {release.publishedAt && <span className="tabular-nums">发布于 {formatTime(release.publishedAt)}</span>}
        </p>
      )}

      <p className={cn("break-words text-xs leading-relaxed text-pretty", noteTone ? TONE_TEXT[noteTone] : "text-muted-foreground")}>{note}</p>

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
