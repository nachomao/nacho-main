import assert from "node:assert/strict"
import test from "node:test"
import {
  dateToUtcInput,
  isValidLogWindow,
  isValidMaxEntries,
  parseCollectLogsResult,
  utcInputToIso,
} from "../lib/collect-logs"

const completeResult = {
  sources: ["agent", "system"],
  requestedSinceUtc: "2026-07-24T07:00:00.0000000+00:00",
  requestedUntilUtc: "2026-07-24T08:00:00.0000000+00:00",
  effectiveSinceUtc: "2026-07-24T07:00:00.0000000+00:00",
  effectiveUntilUtc: "2026-07-24T08:00:00.0000000+00:00",
  entries: [
    {
      source: "agent",
      timestampUtc: "2026-07-24T07:30:00.0000000+00:00",
      level: "Information",
      eventId: 42,
      provider: "Nacho.Agent",
      message: "Agent connected\ncommand accepted",
    },
  ],
  countsBySource: { agent: 1, system: 0 },
  truncated: false,
  durationMs: 14,
  error: null,
}

test("strictly parses a complete collect-logs result", () => {
  const result = parseCollectLogsResult(JSON.stringify(completeResult))
  assert.equal(result?.entries[0].source, "agent")
  assert.equal(result?.countsBySource.system, 0)
})

test("accepts nullable timestamps for stable early failures", () => {
  const result = parseCollectLogsResult(JSON.stringify({
    ...completeResult,
    requestedSinceUtc: null,
    requestedUntilUtc: null,
    effectiveSinceUtc: null,
    effectiveUntilUtc: null,
    entries: [],
    countsBySource: { agent: 0, system: 0 },
    error: "Log collection is disabled by local policy.",
  }))
  assert.equal(result?.error, "Log collection is disabled by local policy.")
})

test("rejects malformed, incomplete, extra-field, and inconsistent results", () => {
  assert.equal(parseCollectLogsResult("not-json"), null)
  assert.equal(parseCollectLogsResult(JSON.stringify({ sources: ["agent"] })), null)
  assert.equal(parseCollectLogsResult(JSON.stringify({ ...completeResult, surprise: true })), null)
  assert.equal(parseCollectLogsResult(JSON.stringify({ ...completeResult, sources: ["security"] })), null)
  assert.equal(parseCollectLogsResult(JSON.stringify({ ...completeResult, countsBySource: { agent: 0, system: 0 } })), null)
  assert.equal(parseCollectLogsResult(JSON.stringify({ ...completeResult, entries: [{ ...completeResult.entries[0], path: "C:\\secret" }] })), null)
  assert.equal(parseCollectLogsResult(JSON.stringify({ ...completeResult, entries: [{ ...completeResult.entries[0], message: "bad\0text" }] })), null)
  assert.equal(parseCollectLogsResult(JSON.stringify({ ...completeResult, entries: [{ ...completeResult.entries[0], message: "Authorization: Bearer raw-secret" }] })), null)
  assert.equal(parseCollectLogsResult(JSON.stringify({ ...completeResult, error: "api_key=raw-secret" })), null)
})

test("rejects results above the 512 KiB UTF-8 boundary", () => {
  assert.equal(parseCollectLogsResult("😀".repeat(131073)), null)
})

test("validates UTC input conversion including calendar boundaries", () => {
  assert.equal(utcInputToIso("2026-07-24T08:30"), "2026-07-24T08:30:00.000Z")
  assert.equal(utcInputToIso("2026-02-30T08:30"), null)
  assert.equal(utcInputToIso("2026-07-24 08:30"), null)
  assert.equal(dateToUtcInput(new Date("2026-07-24T08:30:00Z")), "2026-07-24T08:30")
})

test("validates source-window and entry-count form boundaries", () => {
  const now = Date.parse("2026-07-24T09:00:00Z")
  assert.equal(isValidLogWindow("2026-07-23T08:00:00Z", "2026-07-24T08:00:00Z", now), true)
  assert.equal(isValidLogWindow("2026-07-23T07:59:59Z", "2026-07-24T08:00:00Z", now), false)
  assert.equal(isValidLogWindow("2026-07-24T08:00:00Z", "2026-07-24T08:00:00Z", now), false)
  assert.equal(isValidLogWindow("2026-07-24T09:00:00Z", "2026-07-24T09:01:00Z", now), false)
  assert.equal(isValidMaxEntries(1), true)
  assert.equal(isValidMaxEntries(1000), true)
  assert.equal(isValidMaxEntries(0), false)
  assert.equal(isValidMaxEntries(1001), false)
  assert.equal(isValidMaxEntries(1.5), false)
})
