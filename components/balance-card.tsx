"use client"

import { ChevronDown, ChevronsUpDown } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatedNumber } from "@/components/animated-number"
import { RollingNumber } from "@/components/rolling-number"
import { useServerData } from "@/components/server-data-context"
import {
  Area,
  ComposedChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts"

// 无数据时保留坐标轴与折线结构，读数归零使 CPU/内存曲线贴底，等待服务端 API 填充
const baseSeries = [
  { low: 0, high: 0 },
  { low: 0, high: 0 },
  { low: 0, high: 0 },
  { low: 0, high: 0 },
  { low: 0, high: 0 },
  { low: 0, high: 0 },
  { low: 0, high: 0 },
]

// 数据点数量 = 最多保留的小时数（含当前小时，即覆盖过去 7 个整点）
const POINTS = baseSeries.length

// 生成跟随当前时间的标签：最右为当前整点（最新），向左每点回退 1 小时（最旧）
function buildTimeData() {
  const now = new Date()
  return baseSeries.map((d, i) => {
    const t = new Date(now)
    // i = POINTS-1 时为当前小时，往左依次减 1 小时
    t.setHours(now.getHours() - (POINTS - 1 - i), 0, 0, 0)
    const hh = String(t.getHours()).padStart(2, "0")
    return { ...d, month: `${hh}:00` }
  })
}

const yTicks = [100, 80, 60, 40, 20, 0]

function Legend({ color, label, hatch }: { color?: string; label: string; hatch?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-3.5 w-3.5 rounded"
        style={{
          backgroundColor: color ?? "oklch(0.4 0.01 150)",
          backgroundImage: hatch
            ? "repeating-linear-gradient(45deg, transparent, transparent 2px, oklch(1 0 0 / 25%) 2px, oklch(1 0 0 / 25%) 4px)"
            : undefined,
        }}
      />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

// Recharts margin 配置
const CHART_MARGIN = { top: 32, right: 4, left: 0, bottom: 0 }

export function BalanceCard() {
  const { overview } = useServerData()
  const cpu = overview?.resources.cpu ?? 0
  const memory = overview?.resources.memory ?? 0
  // 跟随当前时间的图表数据；默认选中最右（最新）的整点
  const [data, setData] = useState(buildTimeData)
  const [selectedIndex, setSelectedIndex] = useState(POINTS - 1)

  // 每次服务端轮询完成后追加一个真实资源采样点。
  useEffect(() => {
    if (!overview) return
    const now = new Date(overview.updatedAt)
    const month = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    setData((current) => [...current.slice(1), { low: memory, high: cpu, month }])
    setSelectedIndex(POINTS - 1)
  }, [cpu, memory, overview?.updatedAt])

  const [chartSize, setChartSize] = useState<{ width: number; height: number } | null>(null)

  // 记录折线各数据点在图表坐标系中的实际 x/y 像素位置（由 dot 渲染回调写入）
  const dotYsRef = useRef<Record<number, number>>({})
  const dotXsRef = useRef<Record<number, number>>({})
  // 所选点的真实 x 像素位置，胶囊据此定位（取自 Recharts 实际渲染坐标，避免几何误差）
  const [pillX, setPillX] = useState<number | null>(null)
  // 图表容器与 Y 轴标签列的 DOM 节点，用于换算「按坐标轴标签读到的百分比」
  const containerNodeRef = useRef<HTMLDivElement | null>(null)
  const labelColRef = useRef<HTMLDivElement | null>(null)
  // 徽标显示的 CPU 占用值：按所选点折线在 0~100% 标签轴上的实际视觉位置换算
  const [cpuValue, setCpuValue] = useState(0)

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    containerNodeRef.current = node
    if (!node) return
    const observer = new ResizeObserver(() => {
      const { width, height } = node.getBoundingClientRect()
      setChartSize({ width, height })
    })
    observer.observe(node)
  }, [])

  // 把所选点的折线像素位置映射到 Y 轴标签（100% 在顶、0% 在底）所定义的刻度上。
  // Recharts 的尺寸测量与折线渲染是异步的，因此用 rAF 轮询直到取得该点像素位置。
  useEffect(() => {
    let raf = 0
    let tries = 0
    const measure = () => {
      const node = containerNodeRef.current
      const labelCol = labelColRef.current
      const cy = dotYsRef.current[selectedIndex]
      const cx = dotXsRef.current[selectedIndex]
      if (cx != null) setPillX(cx)
      // 无数据（选中点读数为 0）时徽标直接归零，避免图表内边距造成的几何偏差读数
      const point = data[selectedIndex]
      if (point && point.high === 0 && point.low === 0) {
        setCpuValue(0)
        if (cx != null) return
      }
      if (node && labelCol && cy != null) {
        const contTop = node.getBoundingClientRect().top
        const spans = Array.from(labelCol.querySelectorAll("span"))
        if (spans.length >= 2) {
          const centers = spans.map((s, i) => {
            const r = s.getBoundingClientRect()
            return { y: r.top + r.height / 2 - contTop, v: yTicks[i] }
          })
          const top = centers[0]
          const bottom = centers[centers.length - 1]
          const ratio = (cy - top.y) / (bottom.y - top.y) // 顶部=0 → 100%，底部=1 → 0%
          const value = top.v + ratio * (bottom.v - top.v)
          setCpuValue(Math.round(Math.max(0, Math.min(100, value))))
          return
        }
      }
      if (tries++ < 30) raf = requestAnimationFrame(measure)
    }
    raf = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(raf)
  }, [selectedIndex, chartSize, data])

  // 胶囊位置取所选点的真实渲染 x，再钳制以免徽标在首/末点处溢出图表
  // 22 = 徽标半宽（44/2），保证徽标也完整留在图表内
  const pillLeft =
    pillX != null && chartSize
      ? Math.max(22, Math.min(chartSize.width - 22, pillX))
      : null
  const pillTop = CHART_MARGIN.top
  const pillHeight = chartSize ? chartSize.height - CHART_MARGIN.top - 40 : 0
  const badgeTop = pillTop - 26 - 4

  return (
    <div className="card-glow flex h-full w-full flex-col rounded-3xl bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">服务端负载</p>
          <div className="mt-2 flex items-center gap-3">
            <AnimatedNumber value={cpu} suffix="%" className="text-3xl font-bold tracking-tight" />
          </div>
        </div>

        <div className="flex flex-col items-end gap-4">
          <div className="flex items-center gap-5">
            <Legend color="#329ee0" label="CPU" />
            <Legend color="#dcde52" label="Memory" />
            <Legend label="Idle" hatch />
          </div>
        </div>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 gap-3">
        <div ref={labelColRef} className="flex flex-col justify-between py-1 text-xs text-muted-foreground">
          {yTicks.map((t) => (
            <span key={t}>{t} %</span>
          ))}
        </div>

        {/* relative 容器：图表 + 绝对定位的胶囊叠加层 */}
        <div ref={containerRef} className="relative min-h-[80px] flex-1 [&_*:focus]:outline-none [&_.recharts-surface]:outline-none">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={CHART_MARGIN}
              onClick={(e) => {
                if (e?.activeTooltipIndex != null) {
                  setSelectedIndex(Number(e.activeTooltipIndex))
                }
              }}
              style={{ cursor: "pointer" }}
            >
              <defs>
                <pattern id="hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                  <rect width="8" height="8" fill="oklch(0.3 0.02 150)" />
                  <line x1="0" y1="0" x2="0" y2="8" stroke="oklch(1 0 0 / 12%)" strokeWidth="3" />
                </pattern>
              </defs>
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                padding={{ left: 24, right: 24 }}
                tick={{ fill: "oklch(0.68 0.02 150)", fontSize: 12 }}
                interval={0}
              />
              <YAxis hide domain={[0, 100]} />
              <Area
                type="monotone"
                dataKey="high"
                stroke="#329ee0"
                strokeWidth={2}
                fill="url(#hatch)"
                dot={(dotProps: any) => {
                  // 记录每个点的实际像素位置，供徽标按坐标轴标签换算占用值、胶囊精确定位
                  dotYsRef.current[dotProps.index] = dotProps.cy
                  dotXsRef.current[dotProps.index] = dotProps.cx
                  if (dotProps.index === selectedIndex) return <g key={dotProps.key} />
                  return <circle key={dotProps.key} cx={dotProps.cx} cy={dotProps.cy} r={3} fill="#329ee0" />
                }}
              />
              <Area
                type="monotone"
                dataKey="low"
                stroke="#dcde52"
                strokeWidth={2}
                fill="oklch(0.2 0.01 150)"
                dot={(dotProps: any) => {
                  if (dotProps.index === selectedIndex) return <g key={dotProps.key} />
                  return <circle key={dotProps.key} cx={dotProps.cx} cy={dotProps.cy} r={3} fill="#dcde52" />
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>

          {/* 胶囊叠加层，通过绝对定位确保始终在最顶层，CSS transition ��动平移动画 */}
          {pillLeft != null && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{ zIndex: 10 }}
            >
              <svg width="100%" height="100%" overflow="visible">
                <g style={{ transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)", transform: `translateX(${pillLeft}px)` }}>
                  {/* 胶囊本体 */}
                  <rect
                    x={-13}
                    y={pillTop}
                    width={26}
                    height={pillHeight}
                    rx={13}
                    ry={13}
                    fill="oklch(0.2 0.01 150)"
                    stroke="oklch(0.92 0.2 100)"
                    strokeWidth={2.5}
                  />
                  {/* 徽标：CPU 占���值，带 iOS 风格数字滚动动画 */}
                  <foreignObject x={-22} y={badgeTop} width={44} height={22} overflow="visible">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 44,
                        height: 22,
                        borderRadius: 11,
                        backgroundColor: "#329ee0",
                        color: "oklch(0.14 0.02 150)",
                        fontSize: 11,
                        fontWeight: 700,
                        lineHeight: 1,
                      }}
                    >
                      <RollingNumber value={cpuValue} suffix="%" duration={650} />
                    </div>
                  </foreignObject>
                </g>
              </svg>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
