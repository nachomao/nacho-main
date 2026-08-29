"use client"

import { AlertCircle, ChevronRight, RefreshCw } from "lucide-react"
import Link from "next/link"
import { useServerData } from "@/components/server-data-context"

export function PageHeader() {
  const { overview, error, refreshing, refresh } = useServerData()
  const tickers = [
    { value: overview?.tasks.total ?? 0, unit: "任务", color: "#dce02d" },
    { value: (overview?.clients.warning ?? 0) + (overview?.clients.offline ?? 0), unit: "异常", color: "#d32323" },
    { value: overview?.clients.online ?? 0, unit: "运行", color: "#4dd35c" },
  ]
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl font-bold tracking-tight">仪表盘</h1>

      <div className="flex flex-wrap items-center gap-5">
        {tickers.map((t, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="h-5 w-5 rounded-full" style={{ backgroundColor: t.color }} />
            <span className="font-semibold tabular-nums">{t.value}</span>
            <span className="text-muted-foreground">{t.unit}</span>
          </div>
        ))}

        <button type="button" onClick={() => void refresh()} disabled={refreshing} title={error || "刷新仪表盘"} aria-label={error ? `重新连接：${error}` : "刷新仪表盘"} className={error ? "text-negative" : "text-muted-foreground"}>
          {error ? <AlertCircle className="h-4 w-4" /> : <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />}
        </button>
        <Link href="/clients" className="flex items-center gap-1 text-sm font-medium text-foreground" style={{ backgroundColor: "rgba(0, 0, 0, 0.28)", color: "#cfcfcf", padding: "4px 8px", borderRadius: "6px" }}>
          查看全部设备 <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  )
}
