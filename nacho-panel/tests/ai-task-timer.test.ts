import assert from "node:assert/strict"
import test from "node:test"
import {
  activeTimerElapsedMs,
  activeTurnElapsedMs,
  buildTimerReminderPrompt,
  countToolProgress,
  createTimer,
  formatTimerDuration,
  isTimerCancelTool,
  isTimerExpired,
  isTimerTool,
  isTurnCapReached,
  MAX_TIMER_SECONDS,
  MAX_TURN_ACTIVE_SECONDS,
  MIN_TIMER_SECONDS,
  normalizeTimerSeconds,
  pauseTimer,
  replaceTimer,
  resumeTimer,
} from "../lib/ai/task-timer"

test("timer seconds normalize to the allowed range", () => {
  assert.equal(normalizeTimerSeconds(9), MIN_TIMER_SECONDS)
  assert.equal(normalizeTimerSeconds(3601), MAX_TIMER_SECONDS)
  assert.equal(normalizeTimerSeconds(90.6), 91)
  assert.equal(normalizeTimerSeconds("90"), null)
  assert.equal(normalizeTimerSeconds(Number.NaN), null)
  assert.equal(normalizeTimerSeconds(undefined), null)
})

test("timer expiry uses active time and pause/resume", () => {
  let timer = createTimer({
    afterSeconds: 120,
    startedAt: 1_000,
    reminder: "检查构建日志",
    onExpire: "wait",
  })
  assert.equal(timer.state, "set")
  assert.equal(timer.onExpire, "wait")
  assert.equal(activeTimerElapsedMs(timer, 11_000), 10_000)
  assert.equal(isTimerExpired(timer, 120_999), false)
  assert.equal(isTimerExpired(timer, 121_000), true)

  timer = pauseTimer(timer, 11_000)
  assert.equal(activeTimerElapsedMs(timer, 61_000), 10_000)
  assert.equal(isTimerExpired(timer, 200_000), false)

  timer = resumeTimer(timer, 61_000)
  assert.equal(timer.pausedAt, undefined)
  assert.equal(activeTimerElapsedMs(timer, 62_000), 11_000)
  assert.equal(isTimerExpired(timer, 172_000), true)
})

test("timer revisions never immediately expire and mark updated", () => {
  const first = createTimer({ afterSeconds: 300, startedAt: 0, reminder: "检查" })
  const next = replaceTimer(first, { afterSeconds: 30, startedAt: 60_000, reminder: "继续检查" })
  assert.equal(next.updated, true)
  assert.equal(next.afterSeconds, 30)
  assert.equal(next.startedAt, 60_000)
  assert.equal(next.pausedTotalMs, 0)
})

test("turn active clock excludes approval pauses and enforces the cap", () => {
  const clock = { startedAt: 0, pausedAt: 10_000, pausedTotalMs: 5_000 }
  assert.equal(activeTurnElapsedMs(clock, 30_000), 5_000)
  const noPause = { startedAt: 0, pausedTotalMs: 0 }
  assert.equal(isTurnCapReached(noPause, MAX_TURN_ACTIVE_SECONDS * 1000 - 1), false)
  assert.equal(isTurnCapReached(noPause, MAX_TURN_ACTIVE_SECONDS * 1000), true)
})

test("timer formatting and reminder prompt", () => {
  assert.equal(formatTimerDuration(0), "0s")
  assert.equal(formatTimerDuration(45), "45s")
  assert.equal(formatTimerDuration(72), "1:12")
  assert.equal(formatTimerDuration(600), "10:00")
  assert.equal(formatTimerDuration(3600), "1h")
  assert.equal(formatTimerDuration(3720), "1h 02m")

  const prompt = buildTimerReminderPrompt({ reminder: "检查 job-1 日志", elapsedSeconds: 1800 })
  assert.match(prompt, /job-1/)
  assert.match(prompt, /nacho_set_timer/)
  assert.match(prompt, /不要只回复/)
})

test("timer and cancel tool names are detected, progress counts are stable", () => {
  assert.equal(isTimerTool("nacho_set_timer"), true)
  assert.equal(isTimerTool("set_timer"), true)
  assert.equal(isTimerTool("nacho_cancel_timer"), false)
  assert.equal(isTimerCancelTool("nacho_cancel_timer"), true)
  assert.deepEqual(
    countToolProgress([
      { status: "done" },
      { status: "done" },
      { status: "error" },
      { status: "running" },
      { status: "waiting-confirm" },
    ]),
    { total: 5, done: 2, error: 1, running: 1, waiting: 1 },
  )
})
