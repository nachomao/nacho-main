"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Download, RefreshCw, Server, Monitor, HardDriveDownload } from "lucide-react"
import { useServerData } from "@/components/server-data-context"
import { useOnboarding } from "@/components/onboarding/onboarding-context"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { updateLocalControl } from "@/lib/local-control-server-client"
import type { LocalControlServerStatus } from "@/lib/local-control-server-types"

type Entry = {
  version: string
  publishedAt: string
  sizeBytes: number
  minPanelVersion?: string
  minServerVersion?: string
  minAgentVersion?: string
  title?: string
  notes?: string
}
type Index = { schemaVersion: number; releases: { panel: Entry; server: Entry; agent: Entry }; publishedAt: string }
type Channel = "stable" | "beta" | "alpha"
type Check = { index: Index; stale: boolean; currentVersion: string | null; channel: Channel }
type Runtime = {
  version: string
  apiVersion: number
  minPanelVersion: string
  agentArtifactVersion: string | null
  updateExecutor: boolean
  updateStatus: { phase: string; version: string; error?: string } | null
  updateChannel?: Channel
}
type UpdateBridge = { version: string; check(force?: boolean): Promise<Check>; setChannel(channel: Channel): Promise<Check>; installPanel(): Promise<{ phase: string; version: string }>;
  transferRelease?(kind: "server" | "agent", serverUrl: string, apiKey: string): Promise<unknown>;
  onAvailable?(callback: (check: Check) => void): (() => void) | undefined;
  onTransferProgress?(callback: (percent: number) => void): (() => void) | undefined }

declare global { interface Window { nachoUpdates?: UpdateBridge } }

const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`
function compare(a: string | null, b: string) {
  if (!a || !/^\d+\.\d+\.\d+$/.test(a) || !/^\d+\.\d+\.\d+$/.test(b)) return null
  const x = a.split(".").map(Number), y = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

export function UpdatesPanel() {
  const { apiRequest, transferProductUpdate } = useServerData()
  const { serverSource } = useOnboarding()
  const { confirm } = useConfirm()
  const [check, setCheck] = useState<Check | null>(null)
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  async function changeChannel(next: Channel) {
    if (busy || next === check?.channel) return
    const prior = check?.channel || "stable"
    setBusy("channel")
    try {
      if (runtime) await apiRequest("/product-updates/channel", { method: "POST", body: JSON.stringify({ channel: next }) })
      try {
        if (window.nachoUpdates) await window.nachoUpdates.setChannel(next)
        else {
          const response = await fetch("/api/product-updates", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: next }),
          })
          const result = await response.json() as { ok: boolean; message?: string }
          if (!result.ok) throw new Error(result.message || "频道切换失败")
        }
      } catch (error) {
        if (runtime) await apiRequest("/product-updates/channel", { method: "POST", body: JSON.stringify({ channel: prior }) }).catch(() => null)
        throw error
      }
      await refresh(true)
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "频道切换失败")
    } finally { setBusy(null) }
  }

  const refresh = useCallback(async (force = false) => {
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
      setSourceError(error instanceof Error ? error.message : "检查更新失败")
    }
    try {
      setRuntime(await apiRequest<Runtime>("/runtime-info"))
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
              agentArtifactVersion: null, updateExecutor: false, updateStatus: null, updateChannel: "stable",
            })
            setServerError("本机服务尚未提供版本能力接口，升级后可读取 Agent 制品状态。")
            return
          }
        } catch { /* 沿用原始连接错误 */ }
      }
      setServerError(error instanceof Error ? error.message : "服务端尚未连接")
    }
  }, [apiRequest, serverSource?.mode])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 60_000)
    const unsubscribe = window.nachoUpdates?.onAvailable?.(() => void refresh(true))
    const stopProgress = window.nachoUpdates?.onTransferProgress?.(setProgress)
    return () => { window.clearInterval(timer); unsubscribe?.(); stopProgress?.() }
  }, [refresh])

  async function installPanel() {
    if (!check || busy || !window.nachoUpdates) return
    if (!await confirm({
      title: "安装新版面板？", description: "面板将退出、安装并重新启动。当前本地设置会保留。",
      body: `${check.currentVersion} → ${check.index.releases.panel.version}`,
      confirmLabel: "下载并安装", tone: "warning",
    })) return
    setBusy("panel")
    try { await window.nachoUpdates.installPanel() }
    catch (error) { setSourceError(error instanceof Error ? error.message : "面板安装失败") }
    finally { setBusy(null) }
  }

  async function installServer() {
    if (!check || !runtime || busy) return
    if (!await confirm({
      title: "升级服务端？", description: "升级期间连接将暂时断开，验证失败时会恢复旧版本。",
      body: `${runtime.version} → ${check.index.releases.server.version}`,
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
        await updateLocalControl(check.index.releases.server.version, check.currentVersion)
      } else if (check.index.schemaVersion === 3) {
        setServerError("源码传输完成后服务端将短暂重启；正在准备并验证源码。")
        await transferProductUpdate("server")
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
    if (!runtime || busy) return
    setBusy("agent")
    try {
      if (check?.index.schemaVersion === 3) {
        await transferProductUpdate("agent")
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
  const panelNew = releases ? compare(check.currentVersion, releases.panel.version) === -1 : false
  const serverNew = releases && runtime ? compare(runtime.version, releases.server.version) === -1 : false
  const agentNew = Boolean(releases && runtime &&
    (!runtime.agentArtifactVersion || compare(runtime.agentArtifactVersion, releases.agent.version) === -1))
  const panelRequired = releases?.server.minPanelVersion && check
    ? compare(check.currentVersion, releases.server.minPanelVersion) === -1 : false
  const connectedPanelIncompatible = runtime && check
    ? compare(check.currentVersion, runtime.minPanelVersion) === -1 : false
  const desktop = typeof window !== "undefined" && Boolean(window.nachoUpdates)

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">产品更新</h2>
          <p className="text-xs text-muted-foreground">更新服务器签署通知；面板和服务端从 GitHub 发布制品升级。</p>
        </div>
        <button type="button" onClick={() => void refresh(true)} className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-surface">
          <RefreshCw className="mr-2 inline size-4" />检查更新
        </button>
        <label className="text-sm">更新频道
          <select aria-label="更新频道" value={check?.channel || "stable"} disabled={Boolean(busy)}
            onChange={(event) => void changeChannel(event.target.value as Channel)}
            className="ml-2 rounded-lg border border-border bg-card px-2 py-2">
            <option value="stable">稳定版</option><option value="beta">公测版</option><option value="alpha">内测版</option>
          </select>
        </label>
      </div>
      {sourceError && <p role="status" className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">{sourceError}</p>}
      {connectedPanelIncompatible && <p role="alert" className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
        当前服务端要求面板至少 {runtime?.minPanelVersion}；请先升级面板。版本不兼容的操作需暂停，更新与连接设置仍可访问。
      </p>}
      {serverError && <p role="status" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{serverError}</p>}
      {progress !== null && busy && <p role="status" className="text-xs text-muted-foreground">制品传输 {progress}%</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        <UpdateCard icon={<Monitor className="size-5" />} title="Windows 面板" current={check?.currentVersion || (desktop ? "检测中" : "浏览器开发版")}
          release={releases?.panel} note={!desktop ? "安装新版需使用 Windows 桌面面板。" : panelNew ? "可安装新版" : "当前版本"}
          action="下载并安装" disabled={!panelNew || !desktop || Boolean(check?.stale) || Boolean(busy)} onClick={() => void installPanel()} />
        <UpdateCard icon={<Server className="size-5" />} title="控制服务端" current={runtime?.version || "未连接"}
          release={releases?.server} note={panelRequired ? "需先升级面板" : runtime?.updateStatus ? `执行状态：${runtime.updateStatus.phase}${runtime.updateStatus.error ? ` · ${runtime.updateStatus.error}` : ""}` : "服务端独立升级"}
          action={serverSource?.mode === "local" ? "升级本机服务" : "升级云端服务"}
          disabled={!serverNew || Boolean(check?.stale) || panelRequired || !desktop ||
            (serverSource?.mode !== "local" && (!runtime?.updateExecutor || serverSource?.mode !== "cloud")) || Boolean(busy)}
          onClick={() => void installServer()}
          extra={<div className="border-t border-border pt-3 text-xs">
            <p className="flex items-center gap-2 font-semibold"><HardDriveDownload className="size-4" />同批 Agent 制品</p>
            <p className="mt-2 text-muted-foreground">已准备 {runtime?.agentArtifactVersion || "无"} · 发布 {releases?.agent.version || "未取得"}。仍需逐台或批量手动下发。</p>
            <button type="button" disabled={!agentNew || Boolean(check?.stale) || !runtime || Boolean(busy)}
              onClick={() => void syncAgent()} className="mt-2 rounded-lg border border-border px-3 py-2 disabled:opacity-40">准备新版制品</button>
          </div>} />
      </div>
      <Link href="/clients" className="self-start text-sm text-primary hover:underline">前往「客户端 → 客户端更新」手动下发 Agent 更新 →</Link>
    </div>
  )
}

function UpdateCard({ icon, title, current, release, note, action, disabled, onClick, extra }: {
  icon: React.ReactNode; title: string; current: string; release?: Entry; note: string; action: string; disabled: boolean; onClick: () => void; extra?: React.ReactNode
}) {
  return <section className="flex min-h-52 flex-col gap-3 rounded-2xl border border-border bg-card p-5">
    <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
    <p className="text-sm">当前 <span className="font-mono">{current}</span> → 发布 <span className="font-mono">{release?.version ?? "未取得"}</span></p>
    {release && <p className="text-xs text-muted-foreground">{size(release.sizeBytes)} · {new Date(release.publishedAt).toLocaleString()}</p>}
    <p className="min-h-9 text-xs text-muted-foreground">{note}</p>
    {release?.title && <p className="text-xs font-medium">{release.title}</p>}
    {release?.notes && <p className="max-h-24 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{release.notes}</p>}
    {extra}
    <button type="button" disabled={disabled} onClick={onClick} className="mt-auto rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40">
      <Download className="mr-2 inline size-4" />{action}
    </button>
  </section>
}
