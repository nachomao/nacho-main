"use client"

import { Monitor } from "lucide-react"
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts"
import { AnimatedNumber } from "@/components/animated-number"
import { useEffect, useState } from "react"
import { useServerData } from "@/components/server-data-context"

// 无数据时保留坐标轴与折线结构，数值归零使曲线贴底，等待服务端 API 填充
const emptyData = Array.from({ length: 6 }, (_, index) => ({ label: `-${5 - index}`, value: 0, clients: 0 }))

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl bg-foreground px-3 py-2 text-background shadow-lg">
      <p className="text-xs text-background/70">{label}</p>
      <p className="text-sm font-semibold">{payload[0].payload.clients} 在线客户端</p>
    </div>
  )
}

export function RevenueCard() {
  const { overview } = useServerData()
  const online = overview?.clients.online ?? 0
  const total = overview?.clients.total ?? 0
  const onlineRate = total ? Math.round((online / total) * 100) : 0
  const [data, setData] = useState(emptyData)

  useEffect(() => {
    if (!overview) return
    const now = new Date(overview.updatedAt)
    const label = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    setData((current) => [...current.slice(1), { label, value: online, clients: online }])
  }, [online, overview?.updatedAt])
  return (
    <div className="card-glow flex h-full w-full flex-col rounded-3xl bg-card p-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">在线客户端</h3>
          <p className="text-sm text-muted-foreground">实时采样</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Monitor className="h-7 w-7 text-muted-foreground" />
        <AnimatedNumber value={online} className="text-3xl font-bold tracking-tight" />
        <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-sm font-medium text-primary">
          <AnimatedNumber value={onlineRate} delay={200} suffix="%" /> 在线率
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">Active Clients</p>

      <div className="mt-4 min-h-[80px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="oklch(0.82 0.19 145)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="oklch(0.82 0.19 145)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              interval={0}
              padding={{ left: 12, right: 12 }}
              tick={{ fill: "oklch(0.68 0.02 150)", fontSize: 12 }}
            />
            <YAxis hide domain={[0, (max: number) => Math.max(max, 1)]} />
            <Tooltip
              cursor={{ stroke: "oklch(0.82 0.19 145)", strokeDasharray: 4 }}
              content={<ChartTooltip />}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="oklch(0.82 0.19 145)"
              strokeWidth={2.5}
              fill="url(#revFill)"
              dot={{ r: 3, fill: "oklch(0.82 0.19 145)" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
