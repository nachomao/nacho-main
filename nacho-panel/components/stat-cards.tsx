"use client"

import { Monitor } from "lucide-react"
import { AnimatedNumber } from "@/components/animated-number"
import { useServerData } from "@/components/server-data-context"

export function BitcoinCard() {
  const { overview } = useServerData()
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-accent p-5 text-primary-foreground">
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

export function MarketCapCard() {
  const { overview } = useServerData()
  const abnormal = (overview?.clients.warning ?? 0) + (overview?.clients.offline ?? 0)
  const total = overview?.clients.total ?? 0
  const abnormalRate = total ? Math.round((abnormal / total) * 100) : 0
  return (
    <div className="card-glow flex flex-1 flex-col rounded-3xl bg-card p-5">
      <div className="flex items-start justify-between">
        <h3 className="text-lg font-semibold">异常设备</h3>
      </div>
      <div className="mt-auto flex items-center gap-3 pt-4">
        <Monitor className="h-7 w-7 text-muted-foreground" />
        <AnimatedNumber value={abnormal} className="text-3xl font-bold tracking-tight" />
        <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-sm font-medium text-primary">
          <AnimatedNumber value={abnormalRate} delay={200} suffix="%" /> 异常率
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">Abnormal Devices</p>
    </div>
  )
}
