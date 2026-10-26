"use client"

import { useEffect, useRef, useState } from "react"
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Loader2, PackageCheck, RotateCw, ShieldCheck,
  type LucideIcon,
} from "lucide-react"
import {
  estimateRemainingSeconds, formatRemaining, formatTransferRate, PANEL_INSTALL_LABELS,
  panelDownloadPercent, smoothTransferRate, type PanelInstallPhase, type PanelInstallState,
} from "@/lib/panel-install-progress"
import { cn } from "@/lib/utils"

type MeterTone = "primary" | "warning" | "positive" | "negative"

const TONE_TEXT: Record<MeterTone, string> = {
  primary: "text-primary",
  warning: "text-warning",
  positive: "text-positive",
  negative: "text-negative",
}

const PHASE_VISUAL: Record<PanelInstallPhase, { icon: LucideIcon; tone: MeterTone; spin?: boolean; live: boolean }> = {
  idle: { icon: ArrowDownToLine, tone: "primary", live: false },
  preparing: { icon: Loader2, tone: "primary", spin: true, live: true },
  downloading: { icon: ArrowDownToLine, tone: "primary", live: true },
  retrying: { icon: RotateCw, tone: "warning", spin: true, live: true },
  verifying: { icon: ShieldCheck, tone: "primary", live: true },
  installing: { icon: PackageCheck, tone: "positive", live: false },
  failed: { icon: AlertTriangle, tone: "negative", live: false },
}

const SAMPLE_WINDOW_MS = 500
const STALL_MS = 3000
const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`

/** 进度推送约每 200ms 一次：按 500ms 窗口采样并平滑；超过 3 秒没有新字节视为停滞，隐藏速率与剩余时间。 */
function useTransferRate(bytes: number, active: boolean) {
  const sample = useRef<{ time: number; bytes: number } | null>(null)
  const [rate, setRate] = useState<number | null>(null)

  useEffect(() => {
    if (!active) {
      sample.current = null
      setRate(null)
      return
    }
    const now = performance.now()
    const previous = sample.current
    if (!previous || bytes < previous.bytes) {
      sample.current = { time: now, bytes }
      return
    }
    const elapsed = now - previous.time
    if (elapsed >= SAMPLE_WINDOW_MS) {
      sample.current = { time: now, bytes }
      setRate((current) => smoothTransferRate(current, (bytes - previous.bytes) * 1000 / elapsed))
    }
    const stall = window.setTimeout(() => {
      sample.current = null
      setRate(null)
    }, STALL_MS)
    return () => window.clearTimeout(stall)
  }, [active, bytes])

  return rate
}

function ProgressMeter({ percent, label, valueText, tone, live }: {
  percent: number | null
  label: string
  valueText: string
  tone: MeterTone
  live: boolean
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={valueText}
      className="meter-track"
      data-tone={tone}
      data-indeterminate={percent === null ? "" : undefined}
    >
      {percent === null ? (
        <div className="meter-indeterminate" />
      ) : (
        <div className="meter-fill" style={{ width: `${percent}%` }}>
          {live && <div className="meter-sheen" />}
          <span className="meter-head" data-live={live ? "" : undefined} />
        </div>
      )}
    </div>
  )
}

function ProgressHeader({ icon: Icon, tone, spin, label, percent, alert }: {
  icon: LucideIcon
  tone: MeterTone
  spin?: boolean
  label: string
  percent: number | null
  alert?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <p
        role={alert ? "alert" : "status"}
        className={cn("flex min-w-0 items-start gap-1.5 text-sm font-medium leading-5", alert ? "text-negative" : "text-foreground")}
      >
        <Icon
          aria-hidden="true"
          className={cn("mt-0.5 size-4 shrink-0", TONE_TEXT[tone], spin && "animate-spin motion-reduce:animate-none")}
        />
        <span className="min-w-0 break-words">{label}</span>
      </p>
      {percent !== null && (
        <p
          aria-hidden="true"
          className="flex shrink-0 items-baseline gap-0.5 font-mono text-xl font-semibold leading-none tabular-nums text-foreground"
        >
          {percent}
          <span className="text-xs font-medium text-muted-foreground">%</span>
        </p>
      )}
    </div>
  )
}

function ProgressStats({ amount, pace }: { amount: string | null; pace: string[] }) {
  if (!amount && pace.length === 0) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs leading-5 tabular-nums text-muted-foreground">
      {amount && <span className="whitespace-nowrap">{amount}</span>}
      {pace.length > 0 && (
        <span className="ml-auto flex flex-wrap justify-end gap-x-2">
          {pace.map((part, index) => (
            <span key={part} className="whitespace-nowrap">
              {index > 0 && <span aria-hidden="true" className="mr-2 text-muted-foreground/50">·</span>}
              {part}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

export function TransferProgress({ percent, label }: { percent: number | null; label: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface/40 p-3.5">
      <ProgressHeader icon={ArrowUpFromLine} tone="primary" label={label} percent={percent} />
      <ProgressMeter
        percent={percent}
        tone="primary"
        live={percent !== 100}
        label={`${label}进度`}
        valueText={percent === null ? label : `${percent}%`}
      />
    </div>
  )
}

export function PanelInstallProgress({ state }: { state: PanelInstallState }) {
  const percent = panelDownloadPercent(state)
  const failed = state.phase === "failed"
  const downloading = state.phase === "downloading"
  const visual = PHASE_VISUAL[state.phase]
  const phaseLabel = PANEL_INSTALL_LABELS[state.phase]
  const rate = useTransferRate(state.downloadedBytes, downloading)
  const remaining = downloading ? estimateRemainingSeconds(state.downloadedBytes, state.totalBytes, rate) : null
  const amount = state.totalBytes !== null ? `${mib(state.downloadedBytes)} / ${mib(state.totalBytes)}` : null
  const pace = [
    downloading && rate !== null ? formatTransferRate(rate) : null,
    remaining !== null ? formatRemaining(remaining) : null,
  ].filter((part): part is string => part !== null)

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border p-3.5",
        failed ? "border-negative/30 bg-negative/8" : "border-border bg-surface/40",
      )}
    >
      <ProgressHeader
        icon={visual.icon}
        tone={visual.tone}
        spin={visual.spin}
        label={failed ? state.error || PANEL_INSTALL_LABELS.failed : phaseLabel}
        percent={failed ? null : percent}
        alert={failed}
      />
      {(!failed || percent !== null) && (
        <ProgressMeter
          percent={percent}
          tone={visual.tone}
          live={visual.live}
          label="面板安装包下载进度"
          valueText={percent === null ? phaseLabel : `${percent}% · ${phaseLabel}`}
        />
      )}
      <ProgressStats amount={amount} pace={pace} />
    </div>
  )
}
