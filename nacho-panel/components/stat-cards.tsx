"use client"

import { Monitor } from "lucide-react"
import { AnimatedNumber } from "@/components/animated-number"
import { useServerData } from "@/components/server-data-context"

/**
 * 卡片右下角的装饰性线性图标：超大描边、贴住卡片右缘并被圆角裁切，
 * 只填充版式留白，不进入无障碍树也不参与交互。
 */
function MonitorWatermark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute -right-[2%] bottom-[1.5%] h-auto w-[23.5%] text-white/45"
    >
      <rect x="2" y="3.2" width="20" height="13.2" rx="2.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M12 16.4v4.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M7.6 21.9h8.8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}

function AlertTriangleWatermark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute -right-[3.5%] bottom-[2%] h-auto w-[26%] text-white/35"
    >
      <path
        d="M21.73 18 13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 8.9v5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M12 17.9h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function DeviceTotalCard() {
  const { overview } = useServerData()
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-accent p-5 text-primary-foreground">
      <MonitorWatermark />
      <div className="flex items-start justify-between">
        <h3 className="text-lg font-semibold">设备总量 (PC)</h3>
      </div>
      <div className="mt-auto flex items-center gap-3 pt-4">
        <Monitor className="h-7 w-7 opacity-80" />
        <AnimatedNumber value={overview?.clients.total ?? 0} className="text-3xl font-bold tracking-tight" />
      </div>
      <p className="mt-2 text-sm text-primary-foreground/70">Total Computers</p>
    </div>
  )
}

export function AbnormalDeviceCard() {
  const { overview } = useServerData()
  const abnormal = (overview?.clients.warning ?? 0) + (overview?.clients.offline ?? 0)
  const total = overview?.clients.total ?? 0
  const abnormalRate = total ? Math.round((abnormal / total) * 100) : 0
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-[oklch(0.53_0.19_23)] to-[oklch(0.61_0.17_33)] p-5 text-white">
      <AlertTriangleWatermark />
      <div className="flex items-start justify-between">
        <h3 className="text-lg font-semibold">异常设备</h3>
      </div>
      <div className="mt-auto flex items-center gap-3 pt-4">
        <Monitor className="h-7 w-7 text-white/90" />
        <AnimatedNumber value={abnormal} className="text-3xl font-bold tracking-tight" />
        <span className="flex items-center gap-1 rounded-full bg-black/20 px-2.5 py-1 text-sm font-medium text-white">
          <AnimatedNumber value={abnormalRate} delay={200} suffix="%" /> 异常率
        </span>
      </div>
      <p className="mt-2 text-sm text-white/75">Abnormal Devices</p>
    </div>
  )
}
