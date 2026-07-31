import assert from "node:assert/strict"
import test from "node:test"
import {
  isValidRestartDelay,
  isValidRestartReason,
  normalizeRestartReason,
  parseRestartSystemResult,
} from "../lib/restart-system"

const completeResult = {
  delaySeconds: 30,
  reason: "Planned maintenance",
  requestedAt: "2026-07-24T12:00:00.0000000+00:00",
  previousBootId: "registry:100",
  currentBootId: "registry:101",
  phase: "verified",
  durationMs: 42000,
  verifiedAfterRestart: true,
  error: null,
}

test("parses a complete restart-system result", () => {
  const result = parseRestartSystemResult(JSON.stringify(completeResult))
  assert.equal(result?.phase, "verified")
  assert.equal(result?.verifiedAfterRestart, true)
})

test("accepts nullable early-failure fields", () => {
  const result = parseRestartSystemResult(JSON.stringify({
    ...completeResult,
    delaySeconds: null,
    reason: null,
    requestedAt: null,
    previousBootId: null,
    currentBootId: null,
    phase: "failed",
    verifiedAfterRestart: false,
    error: "System restart is disabled by local policy.",
  }))
  assert.equal(result?.phase, "failed")
})

test("rejects malformed, incomplete, and inconsistent field types", () => {
  assert.equal(parseRestartSystemResult("not-json"), null)
  assert.equal(parseRestartSystemResult(JSON.stringify({ phase: "verified" })), null)
  assert.equal(parseRestartSystemResult(JSON.stringify({ ...completeResult, delaySeconds: 301 })), null)
  assert.equal(parseRestartSystemResult(JSON.stringify({ ...completeResult, requestedAt: "yesterday" })), null)
  assert.equal(parseRestartSystemResult(JSON.stringify({ ...completeResult, verifiedAfterRestart: "true" })), null)
})

test("validates restart delay and reason boundaries", () => {
  assert.equal(isValidRestartDelay(0), true)
  assert.equal(isValidRestartDelay(300), true)
  assert.equal(isValidRestartDelay(-1), false)
  assert.equal(isValidRestartDelay(301), false)
  assert.equal(isValidRestartDelay(1.5), false)
  assert.equal(isValidRestartReason(""), true)
  assert.equal(isValidRestartReason("😀".repeat(256)), true)
  assert.equal(isValidRestartReason("😀".repeat(257)), false)
  assert.equal(isValidRestartReason("line\nbreak"), false)
  assert.equal(normalizeRestartReason("  planned  "), "planned")
  assert.equal(normalizeRestartReason("   "), null)
})
