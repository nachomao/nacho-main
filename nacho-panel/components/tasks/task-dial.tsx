import { cn } from "@/lib/utils"

/* 240° 计时表盘：起点左下 150°，顺时针扫到右下 30°（SVG 坐标系，y 轴向下） */
const CX = 74
const CY = 74
const R = 56
const START_DEG = 150
const SWEEP_DEG = 240
const TICKS = 40

function polar(deg: number, radius: number) {
  const rad = (deg * Math.PI) / 180
  return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) }
}

const arcStart = polar(START_DEG, R)
const arcEnd = polar(START_DEG + SWEEP_DEG, R)
const ARC_PATH = `M ${arcStart.x} ${arcStart.y} A ${R} ${R} 0 1 1 ${arcEnd.x} ${arcEnd.y}`

export type DialTone = "primary" | "warning" | "idle"

export function TaskDial({
  progress,
  tone,
  value,
  caption,
  label,
}: {
  /** 0–1；idle 状态下忽略 */
  progress: number
  tone: DialTone
  value: string
  caption: string
  label: string
}) {
  const active = tone !== "idle"
  const pct = active ? Math.min(1, Math.max(0, progress)) : 0
  const head = polar(START_DEG + SWEEP_DEG * pct, R)
  const toneText = tone === "warning" ? "text-warning" : "text-primary"

  return (
    <div className="relative mx-auto w-full max-w-[200px] shrink-0 sm:mx-0 sm:w-[184px]">
      <svg viewBox="0 0 148 116" className={cn("w-full overflow-visible", toneText)} aria-hidden="true">
        {Array.from({ length: TICKS + 1 }, (_, i) => {
          const deg = START_DEG + (SWEEP_DEG * i) / TICKS
          const major = i % 5 === 0
          const a = polar(deg, 66)
          const b = polar(deg, major ? 72 : 69)
          const lit = active && i / TICKS <= pct
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              strokeLinecap="round"
              strokeWidth={major ? 1.6 : 1}
              stroke={lit ? "currentColor" : "var(--foreground)"}
              strokeOpacity={lit ? (major ? 0.9 : 0.55) : major ? 0.22 : 0.1}
            />
          )
        })}

        <path d={ARC_PATH} fill="none" strokeWidth="8" strokeLinecap="round" stroke="var(--foreground)" strokeOpacity="0.08" />
        {active && (
          <>
            <path
              d={ARC_PATH}
              fill="none"
              strokeWidth="8"
              strokeLinecap="round"
              stroke="currentColor"
              pathLength={100}
              strokeDasharray={`${pct * 100} 100`}
              className="transition-[stroke-dasharray] duration-700 ease-out"
            />
            <circle cx={head.x} cy={head.y} r="7" fill="currentColor" fillOpacity="0.18" />
            <circle cx={head.x} cy={head.y} r="3.6" fill="var(--foreground)" stroke="currentColor" strokeWidth="2" />
          </>
        )}
      </svg>

      <div className="pointer-events-none absolute inset-x-0 top-[27%] flex flex-col items-center text-center">
        <span className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground">{label}</span>
        <span
          className={cn(
            "mt-1 font-bold leading-none tracking-[-0.04em] tabular-nums",
            active ? "text-[30px] text-foreground" : "text-xl text-muted-foreground",
            tone === "warning" && "text-warning",
          )}
        >
          {value}
        </span>
        <span className={cn("mt-1.5 text-[11px]", tone === "warning" ? "text-warning" : "text-muted-foreground")}>
          {caption}
        </span>
      </div>
    </div>
  )
}
