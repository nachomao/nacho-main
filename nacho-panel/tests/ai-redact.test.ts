import assert from "node:assert/strict"
import test from "node:test"
import { redactSecrets, sanitizeErrorMessage, truncateMiddle } from "../lib/ai/redact"

test("redactSecrets masks exact secrets and common token formats", () => {
  const text = "key=sk-abcdefghijklmnop Bearer abcdefghijklmnop https://user:pass@example.com/v1 {\"apiKey\":\"secret-value\"}"
  const redacted = redactSecrets(text, ["secret-value"])
  assert.equal(redacted.includes("sk-abcdefghijklmnop"), false)
  assert.equal(redacted.includes("Bearer abcdefghijklmnop"), false)
  assert.equal(redacted.includes("user:pass@"), false)
  assert.equal(redacted.includes("secret-value"), false)
  assert.match(redacted, /REDACTED/)
})

test("truncateMiddle respects the byte budget and marks truncation", () => {
  const text = "中".repeat(1000)
  const result = truncateMiddle(text, 300)
  assert.equal(result.truncated, true)
  assert.ok(Buffer.byteLength(result.text, "utf8") < 500)
  assert.match(result.text, /已截断/)
  const short = truncateMiddle("hello", 100)
  assert.equal(short.truncated, false)
  assert.equal(short.text, "hello")
})

test("sanitizeErrorMessage removes secrets and limits length", () => {
  const message = sanitizeErrorMessage(new Error(`bad ${"x".repeat(800)} sk-abcdefghijklmnop`), ["sk-abcdefghijklmnop"])
  assert.equal(message.includes("sk-abcdefghijklmnop"), false)
  assert.ok(message.length <= 500)
})
