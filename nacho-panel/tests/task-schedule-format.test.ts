import test from "node:test"
import assert from "node:assert/strict"
import {
  formatTaskRemaining,
  formatTaskRunClock,
  formatTaskRunDateTime,
  taskRunStatusLabel,
  taskScheduleProgress,
} from "../lib/task-schedule-format"

test("formats task run timestamps in the task timezone", () => {
  const timestamp = Date.parse("2026-01-01T01:00:00Z")
  assert.equal(formatTaskRunDateTime(timestamp, "Asia/Shanghai"), "2026-01-01 09:00")
  assert.equal(formatTaskRunDateTime(timestamp, "UTC"), "2026-01-01 01:00")
  assert.equal(formatTaskRunDateTime(timestamp, "Mars/Olympus"), null)
  assert.equal(formatTaskRunDateTime(null, "UTC"), null)
})

test("labels task run states without leaking internal values", () => {
  assert.equal(taskRunStatusLabel("success"), "已下发")
  assert.equal(taskRunStatusLabel("failed"), "失败")
  assert.equal(taskRunStatusLabel("retrying"), "重试中")
  assert.equal(taskRunStatusLabel(null), "尚未执行")
})

test("formats the gauge clock and compact remaining time", () => {
  const timestamp = Date.parse("2026-01-01T01:00:00Z")
  assert.equal(formatTaskRunClock(timestamp, "Asia/Shanghai"), "09:00")
  assert.equal(formatTaskRunClock(timestamp, "UTC"), "01:00")
  assert.equal(formatTaskRunClock(null, "UTC"), null)
  const now = Date.parse("2026-01-01T00:00:00Z")
  assert.equal(formatTaskRemaining(now + 30_000, now), "1 分钟")
  assert.equal(formatTaskRemaining(now + 59 * 60_000, now), "59 分钟")
  assert.equal(formatTaskRemaining(now + (4 * 60 + 12) * 60_000, now), "4 小时 12 分")
  assert.equal(formatTaskRemaining(now + (2 * 24 + 3) * 3_600_000, now), "2 天 3 小时")
  assert.equal(formatTaskRemaining(now - 1, now), "已到期")
  assert.equal(formatTaskRemaining(null, now), null)
})

test("computes half-gauge progress from the last run to the next run", () => {
  const now = 1_000_000
  assert.equal(taskScheduleProgress({ enabled: false, nextRunAt: now + 1000 }, now), 0)
  assert.equal(taskScheduleProgress({ enabled: true, nextRunAt: null }, now), 0)
  assert.equal(taskScheduleProgress({ enabled: true, nextRunAt: now + 1000, lastRunAt: now - 1000 }, now), 0.5)
  assert.equal(taskScheduleProgress({ enabled: true, nextRunAt: now - 1, lastRunAt: now - 1000 }, now), 1)
  assert.equal(taskScheduleProgress({ enabled: true, nextRunAt: now + 1000, lastRunAt: now }, now), 0.04)
  assert.equal(taskScheduleProgress({ enabled: true, nextRunAt: now + 1000, createdAt: now - 3000 }, now), 0.75)
})
