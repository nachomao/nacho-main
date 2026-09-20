"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import {
  AlertCircle,
  Check,
  ChevronUp,
  CircleStop,
  Copy,
  Database,
  Loader2,
  MonitorSmartphone,
  Network,
  Play,
  RefreshCw,
  RotateCw,
  ServerCog,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  installLocalControl,
  runLocalControlAction,
  uninstallLocalControl,
  updateLocalControlAccessMode,
  updateLocalControlAutoStart,
  updateLocalControlPort,
  useLocalControlServer,
} from "@/lib/local-control-server-client"
import {
  LOCAL_CONTROL_UNINSTALL_CONFIRMATION,
  type LocalControlAccessMode,
  type LocalControlInstallLog,
  type LocalControlServerStatus,
} from "@/lib/local-control-server-types"
import type { ServerSource } from "@/components/onboarding/onboarding-context"

const statusCopy: Record<LocalControlServerStatus["runtimeStatus"], { label: string; className: string }> = {
  unsupported: { label: "当前不可用", className: "border-border bg-muted text-muted-foreground" },
  "not-installed": { label: "尚未安装", className: "border-border bg-muted text-muted-foreground" },
  stopped: { label: "已停止", className: "border-border bg-muted text-muted-foreground" },
  starting: { label: "正在启动", className: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300" },
  running: { label: "运行正常", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" },
  unhealthy: { label: "运行异常", className: "border-destructive/30 bg-destructive/10 text-destructive" },
}

type Operation = "install" | "start" | "stop" | "restart" | "repair" | "autoStart" | "accessMode" | "port" | "uninstall"

const operationCopy: Record<Operation, string> = {
  install: "正在安装依赖并启动服务…",
  start: "正在启动本地服务…",
  stop: "正在安全停止本地服务…",
  restart: "正在重启本地服务…",
  repair: "正在备份并重新构建服务…",
  autoStart: "正在更新登录后自启…",
  accessMode: "正在更新监听范围与防火墙…",
  port: "正在更新监听端口…",
  uninstall: "正在彻底卸载并清理本地数据…",
}

const LOCAL_CONTROL_STAGE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)"
type LocalControlStage = "setup" | "install" | "installed"

function LocalControlStagePanel({
  stage,
  active,
  compact = false,
  children,
}: {
  stage: LocalControlStage
  active: boolean
  compact?: boolean
  children: ReactNode
}) {
  return (
    <div
      data-local-control-stage={stage}
      data-active={active}
      aria-hidden={!active}
      inert={!active}
      className={cn("grid motion-reduce:transition-none", !active && "pointer-events-none")}
      style={{
        gridTemplateRows: active ? "1fr" : "0fr",
        transition: `grid-template-rows 720ms ${LOCAL_CONTROL_STAGE_EASE}`,
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn("flex flex-col motion-reduce:transition-none", compact ? "gap-4" : "gap-5")}
          style={{
            opacity: active ? 1 : 0,
            filter: active ? "blur(0px)" : "blur(14px)",
            transform: active ? "translateY(0) scale(1)" : "translateY(8px) scale(0.975)",
            transition: `opacity 440ms ease ${active ? "160ms" : "0ms"}, filter 520ms ease ${active ? "160ms" : "0ms"}, transform 620ms ${LOCAL_CONTROL_STAGE_EASE} ${active ? "140ms" : "0ms"}`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function copyText(value: string) {
  return navigator.clipboard.writeText(value)
}

function InfoCell({ label, value, mono = false, glass = false }: { label: string; value: string; mono?: boolean; glass?: boolean }) {
  return (
    <div className={cn("rounded-xl border px-3 py-2.5", glass ? "border-border/50 bg-background/28 shadow-sm" : "border-border/70 bg-background/35")}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-sm font-medium text-foreground", mono && "font-mono text-xs")}>{value}</p>
    </div>
  )
}

function AccessModeOption({
  mode,
  selected,
  title,
  description,
  icon: Icon,
  disabled,
  glass = false,
  onSelect,
}: {
  mode: LocalControlAccessMode
  selected: boolean
  title: string
  description: string
  icon: typeof MonitorSmartphone
  disabled?: boolean
  glass?: boolean
  onSelect: (mode: LocalControlAccessMode) => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={() => onSelect(mode)}
      className={cn(
        "flex min-w-0 flex-1 items-start gap-3 rounded-xl border p-3 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        selected
          ? glass
            ? "border-foreground/20 bg-foreground/[0.055] shadow-sm"
            : "border-primary/50 bg-primary/8"
          : glass
            ? "border-border/45 bg-background/20 hover:border-foreground/15 hover:bg-background/32"
            : "border-border/70 bg-background/30 hover:border-border hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
          selected
            ? glass
              ? "border border-foreground/15 bg-foreground/10 text-foreground"
              : "bg-primary text-primary-foreground"
            : glass
              ? "border border-border/50 bg-background/35 text-muted-foreground"
              : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {title}
          {selected && <Check className={cn("size-3.5", glass ? "text-foreground/70" : "text-primary")} aria-hidden="true" />}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}

function Prerequisite({ ready, label, detail, glass = false }: { ready: boolean; label: string; detail: string; glass?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5", glass ? "border-border/50 bg-background/28 shadow-sm" : "border-border/70 bg-background/30")}>
      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", ready ? "bg-emerald-500/12 text-emerald-500" : "bg-destructive/10 text-destructive")}>
        {ready ? <Check className="size-3.5" aria-hidden="true" /> : <X className="size-3.5" aria-hidden="true" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

type InstallationOutputChunk = {
  id: number
  content: string
}

function InstallationOutputLine({ chunk }: { chunk: InstallationOutputChunk }) {
  const lineRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const element = lineRef.current
    if (!element) return

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const animation = element.animate(
      reducedMotion
        ? [{ opacity: 0.55 }, { opacity: 1 }]
        : [
            { opacity: 0, filter: "blur(8px)", transform: "translateY(7px)" },
            { opacity: 1, filter: "blur(0px)", transform: "translateY(0)" },
          ],
      {
        duration: reducedMotion ? 160 : 480,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    )

    return () => animation.cancel()
  }, [chunk.id])

  return (
    <span ref={lineRef} className="block max-w-full">
      {chunk.content.replace(/\r?\n$/, "")}
    </span>
  )
}

function InstallationConsole({ output, active }: { output: InstallationOutputChunk[]; active: boolean }) {
  const consoleRef = useRef<HTMLPreElement>(null)
  const [consoleHeight, setConsoleHeight] = useState<number | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updateMotionPreference = () => setReducedMotion(media.matches)

    updateMotionPreference()
    media.addEventListener("change", updateMotionPreference)
    return () => media.removeEventListener("change", updateMotionPreference)
  }, [])

  useEffect(() => {
    const element = consoleRef.current
    if (!element) return

    const updateConsoleViewport = () => {
      const minimumHeight = window.matchMedia("(min-width: 640px)").matches ? 288 : 256
      const maximumHeight = 416
      const nextHeight = Math.min(Math.max(element.scrollHeight, minimumHeight), maximumHeight)

      setConsoleHeight(nextHeight)
      requestAnimationFrame(() => {
        element.scrollTo({ top: element.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" })
      })
    }

    updateConsoleViewport()
    window.addEventListener("resize", updateConsoleViewport)
    return () => window.removeEventListener("resize", updateConsoleViewport)
  }, [output, reducedMotion])

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-background/55 shadow-inner">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn("size-2 shrink-0 rounded-full", active ? "animate-pulse bg-emerald-500" : "bg-destructive")} aria-hidden="true" />
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-foreground">安装命令实时输出</h4>
            <p className="truncate text-xs text-muted-foreground" aria-live="polite">
              {active ? "正在执行，请保持此页面打开" : "安装未完成，可查看下方输出定位问题"}
            </p>
          </div>
        </div>
        <Badge variant="outline">{active ? "执行中" : "已停止"}</Badge>
      </div>
      <pre
        ref={consoleRef}
        tabIndex={0}
        aria-label="安装命令实时输出"
        className="min-h-64 max-h-[26rem] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-72"
        style={{
          height: consoleHeight ?? undefined,
          overflowAnchor: "none",
          scrollbarGutter: "stable",
          transition: reducedMotion ? "none" : `height 460ms ${LOCAL_CONTROL_STAGE_EASE}`,
        }}
      >
        <code aria-live="polite" aria-relevant="additions text">
          {output.length === 0
            ? "[Nacho] 正在准备安装命令…\n"
            : output.map((chunk) => <InstallationOutputLine key={chunk.id} chunk={chunk} />)}
        </code>
      </pre>
    </section>
  )
}

export function LocalControlServerManager({
  surface = "settings",
  currentSource,
  onConnected,
  onUninstalled,
  onCollapse,
}: {
  surface?: "onboarding" | "settings"
  currentSource?: ServerSource
  onConnected?: (source: Exclude<ServerSource, null>) => void
  onUninstalled?: () => void
  onCollapse?: () => void
}) {
  const { status, error: statusError, loading, refreshing, refresh } = useLocalControlServer(5_000)
  const [accessMode, setAccessMode] = useState<LocalControlAccessMode>("loopback")
  const [autoStart, setAutoStart] = useState(true)
  const [port, setPort] = useState("8443")
  const [operation, setOperation] = useState<Operation | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [installOutput, setInstallOutput] = useState<InstallationOutputChunk[]>([])
  const installOutputIdRef = useRef(0)
  const [installFailed, setInstallFailed] = useState(false)
  const [copied, setCopied] = useState<"api" | "key" | null>(null)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [uninstallConfirmation, setUninstallConfirmation] = useState("")

  useEffect(() => {
    if (status?.port && operation === null) setPort(String(status.port))
  }, [status?.port, operation])

  const busy = operation !== null
  const onboarding = surface === "onboarding"
  const isCurrent = Boolean(
    currentSource?.mode === "local" &&
    status?.connection &&
    currentSource.api === status.connection.api &&
    currentSource.key === status.connection.key &&
    (currentSource.agentApi || currentSource.api) === status.connection.agentApi,
  )

  function syncCurrentLocalSource(nextStatus: LocalControlServerStatus | null) {
    if (currentSource?.mode === "local" && nextStatus?.connection) {
      onConnected?.({ mode: "local", ...nextStatus.connection })
    }
  }

  async function perform<T>(nextOperation: Operation, task: () => Promise<T>) {
    setOperation(nextOperation)
    setOperationError(null)
    try {
      return await task()
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "操作失败，请重试")
      return null
    } finally {
      setOperation(null)
    }
  }

  async function handleInstall() {
    setOperation("install")
    setOperationError(null)
    setInstallFailed(false)
    setInstallOutput([])
    const selectedPort = Number(port)
    const appendOutput = (entry: LocalControlInstallLog) => {
      const content = entry.stream === "system" ? `[Nacho] ${entry.message}` : entry.message
      installOutputIdRef.current += 1
      const id = installOutputIdRef.current
      setInstallOutput((current) => [...current, { id, content }])
    }

    try {
      const nextStatus = await installLocalControl({ accessMode, autoStart, port: selectedPort }, appendOutput)
      if (surface !== "onboarding" && nextStatus.healthy && nextStatus.connection && onConnected) {
        onConnected({ mode: "local", ...nextStatus.connection })
      }
    } catch (error) {
      setInstallFailed(true)
      setOperationError(error instanceof Error ? error.message : "安装失败，请重试")
    } finally {
      setOperation(null)
    }
  }

  function resetInstallAttempt() {
    setInstallFailed(false)
    setInstallOutput([])
    setOperationError(null)
  }

  async function handleAction(action: "start" | "stop" | "restart" | "repair") {
    const nextStatus = await perform(action, () => runLocalControlAction(action))
    if (surface === "onboarding" && nextStatus?.healthy && nextStatus.connection && onConnected) {
      onConnected({ mode: "local", ...nextStatus.connection })
    } else {
      syncCurrentLocalSource(nextStatus)
    }
  }

  async function handleAccessMode(nextMode: LocalControlAccessMode) {
    if (!status?.installed) {
      setAccessMode(nextMode)
      return
    }
    const nextStatus = await perform("accessMode", () => updateLocalControlAccessMode(nextMode))
    syncCurrentLocalSource(nextStatus)
  }

  async function handlePort() {
    const nextStatus = await perform("port", () => updateLocalControlPort(Number(port)))
    syncCurrentLocalSource(nextStatus)
  }

  async function handleCopy(kind: "api" | "key", value: string) {
    await copyText(value)
    setCopied(kind)
    window.setTimeout(() => setCopied(null), 1_500)
  }

  async function handleUninstall() {
    const nextStatus = await perform("uninstall", () => uninstallLocalControl(uninstallConfirmation))
    if (!nextStatus) return
    setUninstallOpen(false)
    setUninstallConfirmation("")
    onUninstalled?.()
  }

  if (loading && !status) {
    return (
      <div
        className={cn(
          "relative flex min-h-52 items-center justify-center border",
          onboarding ? "border-0 bg-transparent px-5 py-6" : "rounded-2xl border-border bg-card/50",
        )}
        aria-live="polite"
      >
        {onboarding && onCollapse && (
          <Button type="button" variant="ghost" size="sm" className="absolute right-5 top-4 rounded-xl" data-source-collapse onClick={onCollapse}>
            <ChevronUp data-icon="inline-start" aria-hidden="true" />
            收起
          </Button>
        )}
        <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
        <span className="ml-2 text-sm text-muted-foreground">正在检查本机环境…</span>
      </div>
    )
  }

  if (!status) {
    return (
      <div className={cn("flex flex-col gap-3", onboarding && "p-5 sm:p-6")}>
        {onboarding && onCollapse && (
          <div className="flex justify-end">
            <Button type="button" variant="ghost" size="sm" className="rounded-xl" data-source-collapse onClick={onCollapse}>
              <ChevronUp data-icon="inline-start" aria-hidden="true" />
              收起
            </Button>
          </div>
        )}
        <Alert variant="destructive"><AlertCircle aria-hidden="true" /><AlertTitle>无法读取本机状态</AlertTitle><AlertDescription>{operationError || statusError || "请稍后重试。"}</AlertDescription></Alert>
      </div>
    )
  }

  const statusStyle = operation === "install"
    ? { label: "正在安装", className: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300" }
    : statusCopy[status.runtimeStatus]
  const runtimeMissing = !status.prerequisites.node || !status.prerequisites.npm
  const canInstall = status.platformSupported && status.prerequisites.source
  const showInstallConsole = operation === "install" || installFailed
  const activeStage: LocalControlStage = showInstallConsole ? "install" : status.installed ? "installed" : "setup"

  return (
    <div className="flex flex-col gap-4">
      <section className={cn("overflow-hidden border", onboarding ? "border-0 bg-transparent" : "rounded-2xl border-border bg-card/72 shadow-sm")}>
        <div className={cn("flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between", onboarding ? "border-border/45 bg-foreground/[0.018] px-5 py-5 sm:px-6" : "border-border/70 bg-gradient-to-br from-primary/7 via-transparent to-transparent px-4 py-4")}>
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn("flex shrink-0 items-center justify-center border shadow-sm", onboarding ? "size-11 rounded-2xl border-border/55 bg-background/35 text-foreground" : "size-10 rounded-xl border-primary/15 bg-primary/10 text-primary")}>
              <ServerCog className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-foreground">{onboarding ? "在此设备运行控制服务" : "本机控制服务"}</h3>
                <Badge variant="outline" className={statusStyle.className}>{statusStyle.label}</Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {onboarding ? "确认环境与访问范围后，将自动完成安装、配置和启动。" : "数据、日志和凭据均保存在当前 Windows 设备，不上传到 NachoPanel。"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {status.installed && (
              <Button variant="ghost" size="sm" disabled={busy || refreshing} onClick={() => void refresh()} aria-label="刷新本地服务状态">
                <RefreshCw data-icon="inline-start" className={cn(refreshing && "animate-spin")} aria-hidden="true" />
                刷新
              </Button>
            )}
            {onboarding && onCollapse && (
              <Button type="button" variant="ghost" size="sm" className="rounded-xl" data-source-collapse onClick={onCollapse}>
                <ChevronUp data-icon="inline-start" aria-hidden="true" />
                收起
              </Button>
            )}
          </div>
        </div>

        <div className={cn("flex flex-col", onboarding ? "gap-5 p-5 sm:p-6" : "gap-4 p-4")}>
          <div>
            <LocalControlStagePanel stage="setup" active={activeStage === "setup"} compact={!onboarding}>
              {!status.platformSupported && (
                <Alert className="border-amber-500/25 bg-amber-500/7 text-foreground">
                  <AlertCircle className="text-amber-500" aria-hidden="true" />
                  <AlertTitle>需要在 Windows 本机运行面板</AlertTitle>
                  <AlertDescription>
                    当前系统不能执行 Windows 服务管理。请使用 Windows 上的 NachoPanel，并确保完整的 server 项目目录与 Node.js 22+ 可用。
                  </AlertDescription>
                </Alert>
              )}
              <div className={cn(onboarding && "rounded-2xl border border-border/50 bg-card/32 p-4 shadow-sm backdrop-blur-md")}>
                <div className="mb-3 flex items-center gap-2">
                  <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px] font-semibold", onboarding ? "border border-border/70 bg-background/45 text-foreground shadow-sm" : "bg-primary text-primary-foreground")}>1</span>
                  <h4 className="text-sm font-semibold text-foreground">检查运行环境</h4>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Prerequisite
                    glass={onboarding}
                    ready={status.prerequisites.node}
                    label="Node.js 22+"
                    detail={status.prerequisites.node ? `当前版本 ${status.prerequisites.nodeVersion}` : "安装时重新检测并补齐"}
                  />
                  <Prerequisite
                    glass={onboarding}
                    ready={status.prerequisites.npm}
                    label="npm"
                    detail={status.prerequisites.npm ? "命令可用" : "安装时从 Node.js 目录重新检测"}
                  />
                  <Prerequisite glass={onboarding} ready={status.prerequisites.source} label="server 项目" detail={status.prerequisites.source ? "源码与管理脚本完整" : "目录或文件不完整"} />
                </div>
              </div>

              <fieldset disabled={busy || !status.platformSupported} className={cn(onboarding && "rounded-2xl border border-border/50 bg-card/32 p-4 shadow-sm backdrop-blur-md")}>
                <legend className={cn("flex items-center gap-2 text-sm font-semibold text-foreground", onboarding ? "mb-3 px-1" : "mb-2")}>
                  <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px] font-semibold", onboarding ? "border border-border/70 bg-background/45 text-foreground shadow-sm" : "bg-primary text-primary-foreground")}>2</span>
                  选择访问范围
                </legend>
                <div role="radiogroup" aria-label="本地服务访问范围" className="flex flex-col gap-2 sm:flex-row">
                  <AccessModeOption glass={onboarding} mode="loopback" selected={accessMode === "loopback"} title="仅此设备" description="默认且更安全；只允许当前电脑访问。" icon={MonitorSmartphone} onSelect={handleAccessMode} />
                  <AccessModeOption glass={onboarding} mode="lan" selected={accessMode === "lan"} title="同一局域网" description="允许私有网络中的其他设备连接。" icon={Network} onSelect={handleAccessMode} />
                </div>
              </fieldset>

              <div className={cn(onboarding && "rounded-2xl border border-border/50 bg-card/32 p-4 shadow-sm backdrop-blur-md")}>
                <div className="mb-3 flex items-center gap-2">
                  <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px] font-semibold", onboarding ? "border border-border/70 bg-background/45 text-foreground shadow-sm" : "bg-primary text-primary-foreground")}>3</span>
                  <h4 className="text-sm font-semibold text-foreground">确认本机设置</h4>
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
                  <label className={cn("flex items-center justify-between gap-4 rounded-xl border px-3 py-2.5", onboarding ? "border-border/50 bg-background/28 shadow-sm" : "border-border/70 bg-background/30")}>
                    <span>
                      <span className="block text-sm font-medium text-foreground">登录后自动启动</span>
                      <span className="block text-xs text-muted-foreground">仅写入当前 Windows 用户的 HKCU 启动项</span>
                    </span>
                    <Switch
                      checked={autoStart}
                      onCheckedChange={setAutoStart}
                      disabled={busy || !status.platformSupported}
                      aria-label="登录后自动启动"
                      className={cn(onboarding && "data-checked:!bg-foreground [&_[data-slot=switch-thumb]]:data-checked:!bg-background")}
                    />
                  </label>
                  <label className={cn("rounded-xl border px-3 py-2", onboarding ? "border-border/50 bg-background/28 shadow-sm" : "border-border/70 bg-background/30")}>
                    <span className="text-xs font-medium text-muted-foreground">监听端口</span>
                    <Input className="mt-1 h-7 font-mono text-xs" inputMode="numeric" value={port} disabled={busy || !status.platformSupported} onChange={(event) => setPort(event.target.value.replace(/\D/g, "").slice(0, 5))} aria-label="监听端口" />
                  </label>
                </div>
              </div>

              {runtimeMissing && (
                <Alert className="border-amber-500/25 bg-amber-500/7 text-foreground">
                  <ShieldCheck className="text-amber-500" aria-hidden="true" />
                  <AlertTitle>将重新检测并补齐运行环境</AlertTitle>
                  <AlertDescription>
                    {status.prerequisites.node && !status.prerequisites.npm
                      ? `已检测到 Node.js ${status.prerequisites.nodeVersion}。安装器会从该 Node.js 目录和 cmd.exe 重新查找 npm；仍不可用时才下载官方便携运行环境。`
                      : "安装器会优先复用面板正在使用的 Node.js 与系统已有 npm；仍不可用时才下载并校验官方便携运行环境。"}
                  </AlertDescription>
                </Alert>
              )}

              {accessMode === "lan" && (
                <Alert className="border-amber-500/25 bg-amber-500/7 text-foreground">
                  <ShieldCheck className="text-amber-500" aria-hidden="true" />
                  <AlertTitle>安装时会请求一次管理员授权</AlertTitle>
                  <AlertDescription>仅用于创建当前端口、Private 网络、LocalSubnet 范围的 Windows 防火墙入站规则。</AlertDescription>
                </Alert>
              )}

              <Button variant={onboarding ? "outline" : "default"} className={cn("w-full", onboarding ? "h-11 rounded-xl" : "h-10")} disabled={!canInstall || busy || !port} onClick={() => void handleInstall()}>
                <Play data-icon="inline-start" aria-hidden="true" />
                {onboarding ? (runtimeMissing ? "安装依赖并启动" : "安装并启动") : runtimeMissing ? "安装依赖与本地服务" : "安装并启动本地服务"}
              </Button>
            </LocalControlStagePanel>

            <LocalControlStagePanel stage="install" active={activeStage === "install"} compact={!onboarding}>
              <InstallationConsole output={installOutput} active={operation === "install"} />
              {installFailed && (
                <Button variant="outline" className="self-start" onClick={resetInstallAttempt}>
                  返回安装设置
                </Button>
              )}
            </LocalControlStagePanel>

            <LocalControlStagePanel stage="installed" active={activeStage === "installed"} compact={!onboarding}>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <InfoCell glass={onboarding} label="运行状态" value={status.healthy ? "健康" : status.running ? "异常" : "已停止"} />
                <InfoCell glass={onboarding} label="登录后自启" value={status.autoStartEnabled ? "已开启" : "未开启"} />
                <InfoCell glass={onboarding} label="访问范围" value={status.accessMode === "loopback" ? "仅此设备" : "同一局域网"} />
                <InfoCell glass={onboarding} label="监听端口" value={String(status.port)} mono />
              </div>

              {status.issues.length > 0 && (
                <Alert className="border-amber-500/25 bg-amber-500/7 text-foreground">
                  <AlertCircle className="text-amber-500" aria-hidden="true" />
                  <AlertTitle>需要处理</AlertTitle>
                  <AlertDescription>{status.issues.join("；")}</AlertDescription>
                </Alert>
              )}

              <div className={cn("flex flex-wrap items-end gap-2 rounded-xl border p-3", onboarding ? "border-border/50 bg-background/28" : "border-border/70 bg-background/30")}>
                <label className="min-w-40 flex-1">
                  <span className="text-xs font-medium text-muted-foreground">监听端口</span>
                  <Input className="mt-1 h-8 font-mono text-xs" inputMode="numeric" value={port} disabled={busy} onChange={(event) => setPort(event.target.value.replace(/\D/g, "").slice(0, 5))} aria-label="监听端口" />
                </label>
                <Button variant="outline" disabled={busy || !port || Number(port) === status.port} onClick={() => void handlePort()}>
                  <Network className="size-4" aria-hidden="true" />应用端口
                </Button>
              </div>

              {operation && (
                <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm text-foreground", onboarding ? "border-border/50 bg-background/28" : "border-primary/20 bg-primary/7")} aria-live="polite">
                  <Loader2 className={cn("size-4 animate-spin", onboarding ? "text-foreground/70" : "text-primary")} aria-hidden="true" />
                  {operationCopy[operation]}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {!status.running ? (
                  <Button disabled={busy} onClick={() => void handleAction("start")}>
                    <Play className="size-4" aria-hidden="true" />启动
                  </Button>
                ) : (
                  <Button variant="outline" disabled={busy} onClick={() => void handleAction("stop")}>
                    <CircleStop className="size-4" aria-hidden="true" />停止
                  </Button>
                )}
                <Button variant="outline" disabled={busy} onClick={() => void handleAction("restart")}>
                  <RotateCw className="size-4" aria-hidden="true" />重启
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void handleAction("repair")}>
                  <Wrench className="size-4" aria-hidden="true" />修复 / 升级
                </Button>
                {surface === "onboarding" && status.healthy && status.connection && (
                  <Button variant="outline" className="h-9 rounded-xl sm:ml-auto" disabled={busy} onClick={() => onConnected?.({ mode: "local", ...status.connection! })}>
                    使用此服务继续
                  </Button>
                )}
                {surface === "settings" && status.healthy && status.connection && (
                  <Button className="sm:ml-auto" disabled={busy || isCurrent} onClick={() => onConnected?.({ mode: "local", ...status.connection! })}>
                    {isCurrent ? "当前正在使用" : "使用本地连接"}
                  </Button>
                )}
              </div>
            </LocalControlStagePanel>
          </div>

          {operationError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>操作未完成</AlertTitle>
              <AlertDescription>{operationError}</AlertDescription>
            </Alert>
          )}
        </div>
      </section>

      {status.installed && surface === "settings" && (
        <>
          <section className="rounded-2xl border border-border bg-card/72 p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-foreground">运行与访问</h3>
            </div>
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-background/30 px-3 py-2.5">
                <span>
                  <span className="block text-sm font-medium text-foreground">登录后自动启动</span>
                  <span className="block text-xs text-muted-foreground">当前 Windows 用户登录后自动启动</span>
                </span>
                <Switch checked={status.autoStartEnabled} disabled={busy} onCheckedChange={(checked) => void perform("autoStart", () => updateLocalControlAutoStart(checked))} aria-label="登录后自动启动" />
              </label>
              <div>
                <p className="mb-2 text-sm font-medium text-foreground">访问范围</p>
                <div role="radiogroup" aria-label="本地服务访问范围" className="flex flex-col gap-2 sm:flex-row">
                  <AccessModeOption mode="loopback" selected={status.accessMode === "loopback"} title="仅此设备" description="绑定 127.0.0.1，不创建入站规则。" icon={MonitorSmartphone} disabled={busy} onSelect={handleAccessMode} />
                  <AccessModeOption mode="lan" selected={status.accessMode === "lan"} title="同一局域网" description="绑定 0.0.0.0，仅放行 Private + LocalSubnet。" icon={Network} disabled={busy} onSelect={handleAccessMode} />
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card/72 p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Database className="size-4 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-foreground">本地连接与数据</h3>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-background/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">API 地址</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate text-xs text-foreground">{status.connection?.api || "—"}</code>
                  {status.connection?.api && <Button size="icon-xs" variant="ghost" aria-label="复制 API 地址" onClick={() => void handleCopy("api", status.connection!.api)}>{copied === "api" ? <Check /> : <Copy />}</Button>}
                </div>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">Panel API Key</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate text-xs text-foreground">{status.connection ? "••••••••••••••••" : "—"}</code>
                  {status.connection?.key && <Button size="icon-xs" variant="ghost" aria-label="复制 Panel API Key" onClick={() => void handleCopy("key", status.connection!.key)}>{copied === "key" ? <Check /> : <Copy />}</Button>}
                </div>
              </div>
              <InfoCell label="SQLite 数据库" value={status.databasePath} mono />
              <InfoCell label="服务目录" value={status.serverDir} mono />
            </div>
            {status.accessMode === "lan" && status.localAddresses.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">局域网地址：{status.localAddresses.map((address) => `http://${address}:${status.port}`).join(" · ")}</p>
            )}
          </section>

          <section className="rounded-2xl border border-destructive/25 bg-destructive/4 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-destructive">危险操作</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">彻底卸载会停止服务，并删除依赖、构建产物、SQLite 数据、日志和运行状态。</p>
              </div>
              <Button variant="destructive" disabled={busy} onClick={() => setUninstallOpen(true)}>
                <Trash2 className="size-4" aria-hidden="true" />彻底卸载
              </Button>
            </div>
          </section>
        </>
      )}

      <Dialog open={uninstallOpen} onOpenChange={(open) => !busy && setUninstallOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>彻底卸载本地服务？</DialogTitle>
            <DialogDescription>此操作不可撤销。server 源码会保留，但本地数据库、日志、凭据、依赖和构建产物会被永久删除。</DialogDescription>
          </DialogHeader>
          <label className="space-y-2">
            <span className="text-sm text-foreground">请输入 <strong>{LOCAL_CONTROL_UNINSTALL_CONFIRMATION}</strong> 以确认：</span>
            <Input value={uninstallConfirmation} onChange={(event) => setUninstallConfirmation(event.target.value)} autoComplete="off" disabled={busy} />
          </label>
          {operationError && <p className="text-sm text-destructive" role="alert">{operationError}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setUninstallOpen(false)}>取消</Button>
            <Button variant="destructive" disabled={busy || uninstallConfirmation !== LOCAL_CONTROL_UNINSTALL_CONFIRMATION} onClick={() => void handleUninstall()}>
              {operation === "uninstall" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              确认彻底卸载
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
