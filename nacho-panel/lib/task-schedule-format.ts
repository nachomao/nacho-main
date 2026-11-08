export type TaskLastStatus = "success" | "failed" | "retrying" | null

/** 按任务时区格式化 yyyy-MM-dd HH:mm；时间戳或时区无效时返回 null。 */
export function formatTaskRunDateTime(timestamp: number | null | undefined, timeZone: string): string | null {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp))
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? ""
    const hour = read("hour") === "24" ? "00" : read("hour")
    return `${read("year")}-${read("month")}-${read("day")} ${hour}:${read("minute")}`
  } catch {
    return null
  }
}

export function taskRunStatusLabel(status: TaskLastStatus): string {
  if (status === "success") return "已下发"
  if (status === "failed") return "失败"
  if (status === "retrying") return "重试中"
  return "尚未执行"
}

/** 只取任务时区下的 HH:mm，用于半圆仪表中心。 */
export function formatTaskRunClock(timestamp: number | null | undefined, timeZone: string): string | null {
  const formatted = formatTaskRunDateTime(timestamp, timeZone)
  return formatted ? formatted.slice(11) : null
}

/** 距下次执行的紧凑中文时长；到期或已过去时返回“已到期”。 */
export function formatTaskRemaining(nextRunAt: number | null | undefined, now = Date.now()): string | null {
  if (typeof nextRunAt !== "number" || !Number.isFinite(nextRunAt)) return null
  const diff = nextRunAt - now
  if (diff <= 0) return "已到期"
  const minutes = Math.max(1, Math.floor(diff / 60_000))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return `${hours} 小时 ${remainingMinutes} 分`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days} 天 ${remainingHours} 小时`
}

/**
 * 半圆仪表的填充比例：按“上次执行 → 下次执行”的周期计算已过去部分。
 * 从未执行过时从创建时间起算；停用或无排期返回 0，越界时夹在 4%–100%。
 */
export function taskScheduleProgress(
  task: {
    enabled?: boolean
    nextRunAt?: number | null
    lastRunAt?: number | null
    createdAt?: number | null
  },
  now = Date.now(),
): number {
  if (!task.enabled || typeof task.nextRunAt !== "number" || !Number.isFinite(task.nextRunAt)) return 0
  const start = task.lastRunAt ?? task.createdAt ?? now
  const total = task.nextRunAt - start
  if (!Number.isFinite(total) || total <= 0) return task.nextRunAt <= now ? 1 : 0.04
  const elapsed = (now - start) / total
  return Math.min(1, Math.max(0.04, elapsed))
}
