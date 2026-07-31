import assert from "node:assert/strict"
import test from "node:test"
import {
  isAbsoluteWindowsExecutablePath,
  isValidProcessId,
  isValidProcessTimeout,
  parseTerminateProcessResult,
  terminalCommandStatuses,
} from "../lib/terminate-process"

test("parses a complete terminate-process result", () => {
  const result = parseTerminateProcessResult(JSON.stringify({
    processId: 123,
    expectedPath: "C:\\Program Files\\Example\\worker.exe",
    actualPath: "C:\\Program Files\\Example\\worker.exe",
    killProcessTree: true,
    initialStatus: "running",
    finalStatus: "exited",
    durationMs: 42,
    timedOut: false,
    error: null,
  }))
  assert.equal(result?.processId, 123)
  assert.equal(result?.finalStatus, "exited")
})

test("rejects malformed and incomplete terminate-process results", () => {
  assert.equal(parseTerminateProcessResult("not-json"), null)
  assert.equal(parseTerminateProcessResult(JSON.stringify({ processId: 123 })), null)
  assert.equal(parseTerminateProcessResult(JSON.stringify({
    processId: 123,
    expectedPath: "C:\\worker.exe",
    actualPath: null,
    killProcessTree: "true",
    initialStatus: "running",
    finalStatus: "exited",
    durationMs: 42,
    timedOut: false,
    error: null,
  })), null)
})

test("validates terminate-process form boundaries", () => {
  assert.equal(isValidProcessId("123"), true)
  assert.equal(isValidProcessId("0"), false)
  assert.equal(isValidProcessId("4"), false)
  assert.equal(isValidProcessId("1.5"), false)
  assert.equal(isValidProcessTimeout(1), true)
  assert.equal(isValidProcessTimeout(120), true)
  assert.equal(isValidProcessTimeout(0), false)
  assert.equal(isValidProcessTimeout(121), false)
  assert.equal(isAbsoluteWindowsExecutablePath("C:\\Program Files\\Example\\worker.exe"), true)
  assert.equal(isAbsoluteWindowsExecutablePath("worker.exe"), false)
  assert.equal(isAbsoluteWindowsExecutablePath("C:\\Example\\*.exe"), false)
  assert.equal(isAbsoluteWindowsExecutablePath("C:\\Example\\"), false)
})

test("recognizes every terminal command status", () => {
  assert.deepEqual(terminalCommandStatuses, ["success", "failed", "canceled"])
})
