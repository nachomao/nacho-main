"use client"

import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatTaskRunClock } from "@/lib/task-schedule-format"
import { isEventTrigger, type ScheduledTask } from "./task-model"

const HOUR = 60 * 60 * 1000
const HORIZON = 24 * HOUR
const LANE_GAP_PCT = 14
const MAX_LANES = 3
const TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]

/* 未来 24 小时内的下次执行分布；按横向位置分配泳道，避免名称互相遮挡 */
export function TaskTimeline({
  tasks,
  now,
  onPick,
}: {
  tasks: ScheduledTask[]
  now: number
  onPick: (id: string) => void
}) {
  const enabled = tasks.filter((t) => t.enabled)
  const upcoming = enabled
    .filter((t) => typeof t.nextRunAt === "number" && t.nextRunAt <= now + HORIZON)
    .sort((a, b) => (a.nextRunAt as number) - (b.nextRunAt as number))
  const laterCount = enabled.filter(
    (t) => !isEventTrigger(t.triggerId) && typeof t.nextRunAt === "number" && t.nextRunAt > now + HORIZON,
  ).length
  const eventCount = enabled.filter((t) => isEventTrigger(t.triggerId)).length
  const disabledCount = tasks.length - enabled.length
  const failedCount = tasks.filter((t) => t.lastStatus === "failed").length

  const laneEnds: number[] = []
  const markers = upcoming.map((t) => {
    const pct = Math.min(100, Math.max(0, (((t.nextRunAt as number) - now) / HORIZON) * 100))
    let lane = laneEnds.findIndex((end) => pct - end >= LANE_GAP_PCT)
    if (lane === -1) lane = laneEnds.length < MAX_LANES ? laneEnds.length : laneEnds.length - 1
    laneEnds[lane] = pct
    return { task: t, pct, lane, imminent: (t.nextRunAt as number) - now <= HOUR }
  })

  return (
    <section aria-label="未来 24 小时执行计划" className="mb-4 rounded-2xl border border-task-line bg-task-tile px-4 pb-3 pt-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="text-sm font-semibold">未来 24 小时</h3>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <li>
            <span className="font-semibold text-foreground tabular-nums">{upcoming.length}</span> 次待执行
          </li>
          {laterCount > 0 && (
            <li>
              <span className="font-semibold text-foreground tabular-nums">{laterCount}</span> 个更晚
            </li>
          )}
          {eventCount > 0 && (
            <li>
              <span className="font-semibold text-foreground tabular-nums">{eventCount}</span> 个事件触发
            </li>
          )}
          {disabledCount > 0 && (
            <li>
              <span className="font-semibold text-foreground tabular-nums">{disabledCount}</span> 个已停用
            </li>
          )}
          {failedCount > 0 && (
            <li className="flex items-center gap-1 text-negative">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="font-semibold tabular-nums">{failedCount}</span> 个最近失败
            </li>
          )}
        </ul>
      </div>

      <div className="relative mt-1 h-14 sm:h-[4.5rem]">
        {/* 基线与刻度 */}
        <div className="absolute inset-x-0 bottom-6 h-px bg-border" aria-hidden="true" />
        {TICKS.map((h) => (
          <div
            key={h}
            aria-hidden="true"
            className="absolute bottom-6 h-1.5 w-px bg-border"
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}
        {[0, 6, 12, 18, 24].map((h) => (
          <span
            key={h}
            aria-hidden="true"
            className={cn(
              "absolute bottom-0 font-mono text-[11px] text-muted-foreground",
              h === 0 ? "translate-x-0" : h === 24 ? "-translate-x-full" : "-translate-x-1/2",
              (h === 6 || h === 18) && "hidden sm:block",
            )}
            style={{ left: `${(h / 24) * 100}%` }}
          >
            {h === 0 ? "现在" : `+${h}h`}
          </span>
        ))}
        <span
          aria-hidden="true"
          className="absolute bottom-6 left-0 h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-primary ring-4 ring-primary/20"
        />

        {markers.length === 0 && (
          <p className="absolute inset-x-0 top-6 text-center text-xs text-muted-foreground">未来 24 小时内没有待执行的任务</p>
        )}

        {markers.map(({ task, pct, lane, imminent }) => {
          const alignRight = pct > 82
          const alignLeft = pct < 8
            const stem = 10 + lane * 20
          const clock = formatTaskRunClock(task.nextRunAt, task.timezone || "UTC")
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => onPick(task.id)}
              aria-label={`${task.name}，${clock ?? ""} 执行，定位到任务卡片`}
              title={`${task.name} · ${clock ?? ""}`}
              className="group/marker absolute bottom-6 w-0"
              style={{ left: `${pct}%` }}
            >
              <span
                aria-hidden="true"
                className={cn("absolute bottom-0 left-0 w-px -translate-x-1/2", imminent ? "bg-warning/60" : "bg-primary/50")}
                style={{ height: stem }}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "absolute bottom-0 left-0 h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-background transition-transform group-hover/marker:scale-125",
                  imminent ? "bg-warning" : "bg-primary",
                )}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "absolute hidden items-center gap-1.5 whitespace-nowrap rounded-md border border-task-line bg-background/80 px-1.5 py-0.5 text-[11px] font-medium text-foreground transition-colors group-hover/marker:border-primary/60 sm:flex",
                  alignRight ? "right-0" : alignLeft ? "left-0" : "left-0 -translate-x-1/2",
                )}
                style={{ bottom: stem }}
              >
                <span className={cn("font-mono tabular-nums", imminent ? "text-warning" : "text-primary")}>{clock}</span>
                <span className="max-w-24 truncate">{task.name}</span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
