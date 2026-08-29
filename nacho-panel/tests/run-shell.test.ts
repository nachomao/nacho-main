import assert from "node:assert/strict"
import test from "node:test"
import { isValidShellScript, isValidShellTimeout, parseRunShellResult } from "../lib/run-shell"

const valid = {
  shell: "cmd",
  stdout: "hello\r\n",
  stderr: "",
  exitCode: 0,
  durationMs: 25,
  timedOut: false,
  truncated: false,
  error: null,
}

test("validates run-shell form boundaries", () => {
  assert.equal(isValidShellScript("echo ok\r\nwhoami"), true)
  assert.equal(isValidShellScript(""), false)
  assert.equal(isValidShellScript("  \r\n\t"), false)
  assert.equal(isValidShellScript("x".repeat(32_769)), false)
  assert.equal(isValidShellScript("echo\0bad"), false)
  assert.equal(isValidShellTimeout(1), true)
  assert.equal(isValidShellTimeout(900), true)
  assert.equal(isValidShellTimeout(0), false)
  assert.equal(isValidShellTimeout(901), false)
  assert.equal(isValidShellTimeout(1.5), false)
})

test("strictly parses run-shell results", () => {
  assert.deepEqual(parseRunShellResult(JSON.stringify(valid)), valid)
  assert.equal(parseRunShellResult(JSON.stringify({ ...valid, shell: "bash" })), null)
  assert.equal(parseRunShellResult(JSON.stringify({ ...valid, extra: true })), null)
  const { stderr: _stderr, ...missing } = valid
  assert.equal(parseRunShellResult(JSON.stringify(missing)), null)
  assert.equal(parseRunShellResult(JSON.stringify({ ...valid, durationMs: -1 })), null)
  assert.equal(parseRunShellResult("not-json"), null)
})
