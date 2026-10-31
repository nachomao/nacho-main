/* AI 自定义检查点计时器的纯逻辑：浏览器与 Next 服务端共用。
 * 计时按“活跃时间”计算：等待人工确认时暂停，恢复后继续，不保存绝对 deadline。 */

import type { AIChatTimer } from "./chat-events"

export const MIN_TIMER_SECONDS = 10
export const MAX_TIMER_SECONDS = 3600
export const DEFAULT_CHECKPOINT_SECONDS = 300
export const MAX_TURN_ACTIVE_SECONDS = 2 * 60 * 60

export type TurnClock = {
  startedAt: number
  pausedAt?: number
  pausedTotalMs: number
}

export function normalizeTimerSeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.min(MAX_TIMER_SECONDS, Math.max(MIN_TIMER_SECONDS, Math.round(value)))
}

export function createTimer(input: {
  afterSeconds: unknown
  startedAt: number
  reminder: string
  label?: string
  onExpire?: unknown
  fallback?: boolean
}): AIChatTimer {
  const afterSeconds = normalizeTimerSeconds(input.afterSeconds) ?? MIN_TIMER_SECONDS
  const reminder = input.reminder.trim().slice(0, 500) || "检查任务进度"
  const label = input.label?.trim().slice(0, 80) || undefined
  const onExpire = input.onExpire === "interrupt" ? "interrupt" : "wait"
  return {
    afterSeconds,
    startedAt: input.startedAt,
    pausedTotalMs: 0,
    reminder,
    ...(label ? { label } : {}),
    onExpire,
    ...(input.fallback ? { fallback: true } : {}),
    state: "set",
  }
}

export function replaceTimer(previous: AIChatTimer | null, input: Parameters<typeof createTimer>[0]): AIChatTimer {
  const next = createTimer(input)
  return {
    ...next,
    ...(previous ? { updated: true } : {}),
  }
}

export function pauseTimer(timer: AIChatTimer, now: number): AIChatTimer {
  if (timer.pausedAt !== undefined) return timer
  if (timer.state !== "set" && timer.state !== "waiting") return timer
  return { ...timer, pausedAt: now }
}

export function resumeTimer(timer: AIChatTimer, now: number): AIChatTimer {
  if (timer.pausedAt === undefined) return timer
  const pausedMs = Math.max(0, now - timer.pausedAt)
  const { pausedAt: _pausedAt, ...rest } = timer
  return { ...rest, pausedTotalMs: timer.pausedTotalMs + pausedMs }
}

export function activeTimerElapsedMs(timer: AIChatTimer, now: number): number {
  const end = timer.pausedAt ?? now
  return Math.max(0, end - timer.startedAt - timer.pausedTotalMs)
}

export function isTimerExpired(timer: AIChatTimer, now: number): boolean {
  if (timer.pausedAt !== undefined) return false
  if (timer.state !== "set" && timer.state !== "waiting") return false
  return activeTimerElapsedMs(timer, now) >= timer.afterSeconds * 1000
}

export function activeTurnElapsedMs(clock: TurnClock, now: number): number {
  const end = clock.pausedAt ?? now
  return Math.max(0, end - clock.startedAt - clock.pausedTotalMs)
}

export function isTurnCapReached(clock: TurnClock, now: number): boolean {
  return activeTurnElapsedMs(clock, now) >= MAX_TURN_ACTIVE_SECONDS * 1000
}

export function formatTimerDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes < 60) return `${minutes}:${String(rest).padStart(2, "0")}`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes ? `${hours}h ${String(restMinutes).padStart(2, "0")}m` : `${hours}h`
}

export function buildTimerReminderPrompt(input: {
  reminder: string
  elapsedSeconds: number
  capSeconds?: number
}): string {
  const elapsed = formatTimerDuration(input.elapsedSeconds)
  const cap = input.capSeconds
    ? `本轮活跃时间上限 ${formatTimerDuration(input.capSeconds)}。`
    : ""
  return [
    "[AI 计时器到期] 你设置的提醒：",
    input.reminder,
    "",
    `本轮实际运行 ${elapsed}。${cap}`,
    "请先检查任务进度（本地后台任务用 nacho_get_local_job；受管客户端用 nacho_list_commands 或相关工具），评估预计剩余时间，然后自行决定：",
    "- 继续：直接调用所需工具，并调用 nacho_set_timer 设置下一次检查；",
    "- 调整：说明调整并继续；",
    "- 停止：先停止本地后台任务（如需要），再用简洁中文总结已完成 / 未完成 / 下一步。",
    "不要只回复“收到”。",
  ].join("\n")
}

const TIMER_TOOLS = new Set(["nacho_set_timer", "set_timer"])
const TIMER_CANCEL_TOOLS = new Set(["nacho_cancel_timer", "cancel_timer"])

export function isTimerTool(name: string): boolean {
  return TIMER_TOOLS.has(name)
}

export function isTimerCancelTool(name: string): boolean {
  return TIMER_CANCEL_TOOLS.has(name)
}

export function countToolProgress(steps: { status: string }[]): {
  total: number
  done: number
  error: number
  running: number
  waiting: number
} {
  let done = 0
  let error = 0
  let running = 0
  let waiting = 0
  for (const step of steps) {
    if (step.status === "done") done++
    else if (step.status === "error") error++
    else if (step.status === "waiting-confirm") waiting++
    else running++
  }
  return { total: steps.length, done, error, running, waiting }
}
