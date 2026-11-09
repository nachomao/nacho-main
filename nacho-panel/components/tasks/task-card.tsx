"use client"

import { AlertTriangle, Loader2, Pencil, Play, Repeat, Server, Sparkles, Trash2, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  formatTaskRemaining,
  formatTaskRunClock,
  formatTaskRunDateTime,
  taskRunStatusLabel,
  taskScheduleProgress,
} from "@/lib/task-schedule-format"
import { isEventTrigger, osMeta, taskPath, triggerSummary, type ScheduledTask } from "./task-model"

const IMMINENT_MS = 60 * 60 * 1000

const statusTone: Record<string, string> = {
  success: "bg-positive/12 text-positive",
  failed: "bg-negative/12 text-negative",
  retrying: "bg-warning/12 text-warning",
  none: "bg-muted text-muted-foreground",
}

export function TaskCard({
  task,
  now,
  isRemoving,
  isFlash,
  isEditing,
  isBusy,
  onToggle,
  onEdit,
  onRun,
  onDelete,
}: {
  task: ScheduledTask
  now: number
  isRemoving: boolean
  isFlash: boolean
  isEditing: boolean
  isBusy: boolean
  onToggle: () => void
  onEdit: () => void
  onRun: () => void
  onDelete: () => void
}) {
  const timezone = task.timezone || "UTC"
  const nextRunText = formatTaskRunDateTime(task.nextRunAt, timezone)
  const lastRunText = formatTaskRunDateTime(task.lastRunAt, timezone)
  const nextClock = formatTaskRunClock(task.nextRunAt, timezone)
  const remaining = formatTaskRemaining(task.nextRunAt, now)
  const progress = taskScheduleProgress(
    { enabled: task.enabled, nextRunAt: task.nextRunAt, lastRunAt: task.lastRunAt, createdAt: task.createdAt },
    now,
  )
  const eventTrigger = isEventTrigger(task.triggerId)
  const scheduled = task.enabled && !eventTrigger && !!nextClock
  const imminent = scheduled && typeof task.nextRunAt === "number" && task.nextRunAt - now <= IMMINENT_MS
  const lastStatus = task.lastStatus ?? null
  const showError = (lastStatus === "failed" || lastStatus === "retrying") && !!task.lastError
  const OSIcon = osMeta[task.os].icon
  const schedule = triggerSummary(task.os, task.triggerId, task.time, task.interval, task.cron)

  return (
    <article
      id={`task-${task.id}`}
      aria-label={task.name}
      className={cn(
        "group flex scroll-mt-4 flex-col rounded-2xl border bg-task-tile shadow-[inset_0_1px_0_0_oklch(1_0_0/6%)] transition-all duration-300 ease-out",
        isRemoving
          ? "scale-95 opacity-0 blur-sm"
          : isFlash || isEditing
            ? "border-primary/70 shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_18%,transparent)]"
            : "border-task-line hover:border-border",
        !task.enabled && !isRemoving && "opacity-80",
      )}
      style={{ maxHeight: isRemoving ? 0 : 1200, marginBottom: isRemoving ? -10 : 0 }}
    >
      {/* 标题行 */}
      <header className="flex items-start justify-between gap-3 p-4 pb-0">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-task-line",
              task.enabled ? "bg-primary/10 text-primary" : "bg-muted/60 text-muted-foreground",
            )}
          >
            <OSIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-sm font-semibold leading-tight text-pretty">{task.name}</h3>
              <span className="rounded-md bg-foreground/5 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {osMeta[task.os].label}
              </span>
              {isEditing ? (
                <span className="flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                  <Pencil className="h-3 w-3" aria-hidden="true" />
                  编辑中
                </span>
              ) : (
                isFlash && (
                  <span className="flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    已更新
                  </span>
                )
              )}
            </div>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={taskPath(task)}>
              {taskPath(task)}
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={task.enabled}
          aria-label={`${task.enabled ? "禁用" : "启用"}任务：${task.name}`}
          onClick={onToggle}
          disabled={isBusy}
          className="flex shrink-0 items-center gap-2 rounded-full py-1 pl-2.5 pr-1 text-xs font-medium transition-colors hover:bg-foreground/5 disabled:pointer-events-none disabled:opacity-60"
        >
          <span className={cn("hidden sm:inline", task.enabled ? "text-positive" : "text-muted-foreground")}>
            {task.enabled ? "已启用" : "已停用"}
          </span>
          <span
            className={cn(
              "relative h-5 w-9 rounded-full transition-colors duration-200",
              task.enabled ? "bg-positive" : "bg-muted",
            )}
          >
            <span
              className={cn(
                "absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-foreground transition-transform duration-200",
                task.enabled && "translate-x-4",
              )}
            >
              {isBusy && <Loader2 className="h-3 w-3 animate-spin text-background" aria-hidden="true" />}
            </span>
          </span>
        </button>
      </header>

      {/* 下次执行：时间 + 倒计时 + 周期进度 */}
      <div className="mx-4 mt-4 rounded-xl border border-task-line bg-background/40 p-3.5">
        {scheduled ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
              <div className="flex items-baseline gap-2 whitespace-nowrap">
                <span
                  className={cn(
                    "font-mono text-2xl font-semibold leading-none tracking-tight tabular-nums sm:text-3xl",
                    imminent ? "text-warning" : "text-foreground",
                  )}
                >
                  {nextClock}
                </span>
                <span className="font-mono text-xs text-muted-foreground" title={nextRunText ?? undefined}>
                  {nextRunText?.slice(5, 10)}
                </span>
              </div>
              <div className="whitespace-nowrap leading-tight sm:text-right">
                <p className="text-[11px] text-muted-foreground">距下次执行</p>
                <p className={cn("mt-0.5 text-sm font-medium tabular-nums", imminent ? "text-warning" : "text-foreground")}>
                  {remaining}
                </p>
              </div>
            </div>
            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/10"
              role="progressbar"
              aria-label="当前周期进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-700 ease-out",
                  imminent ? "bg-warning" : "bg-primary",
                )}
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-muted-foreground">
              {task.enabled && eventTrigger ? <Zap className="h-4 w-4" aria-hidden="true" /> : <Repeat className="h-4 w-4" aria-hidden="true" />}
            </span>
            <div className="min-w-0 leading-tight">
              <p className="text-base font-semibold text-foreground">
                {!task.enabled ? "已停用" : eventTrigger ? "事件触发" : "待排期"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {!task.enabled
                  ? "启用后由服务端重新计算下次执行"
                  : eventTrigger
                    ? `由客户端事件驱动 · ${schedule}`
                    : "等待服务端计算下次执行时间"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 排期明细 */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 pt-3.5 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">周期</dt>
          <dd className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
            <Repeat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate" title={schedule}>
              {schedule}
            </span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">最近执行</dt>
          <dd className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] font-medium">
            <span className="font-mono tabular-nums" title={lastRunText ?? undefined}>
              {lastRunText ? lastRunText.slice(5) : "—"}
            </span>
            <span
              className={cn(
                "whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                statusTone[lastStatus ?? "none"],
              )}
            >
              {taskRunStatusLabel(lastStatus)}
            </span>
          </dd>
        </div>
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <dt className="text-[11px] text-muted-foreground">目标</dt>
          <dd className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
            <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="shrink-0">{task.clientIds.length} 台</span>
            <span className="truncate font-normal text-muted-foreground" title={`时区：${timezone}`}>
              · {timezone}
            </span>
          </dd>
        </div>
      </dl>

      {showError && (
        <p
          className={cn(
            "mx-4 mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-relaxed",
            lastStatus === "failed" ? "bg-negative/10 text-negative" : "bg-warning/10 text-warning",
          )}
          title={task.lastError ?? undefined}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="line-clamp-2 min-w-0">{task.lastError}</span>
        </p>
      )}

      {/* 操作 */}
      <footer className="mt-auto flex items-center justify-between gap-2 p-4 pt-4">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Play className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{task.action}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
              isEditing
                ? "border-primary/60 bg-primary/12 text-primary"
                : "border-task-line bg-foreground/5 text-foreground hover:bg-foreground/10",
            )}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            编辑
          </button>
          <button
            type="button"
            onClick={onRun}
            disabled={isBusy}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-primary/15 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/25 disabled:pointer-events-none disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            运行
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isBusy}
            aria-label={`删除任务：${task.name}`}
            title="删除"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-negative/12 hover:text-negative disabled:pointer-events-none disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </footer>
    </article>
  )
}
