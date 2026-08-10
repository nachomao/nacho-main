import assert from "node:assert/strict"
import test from "node:test"
import { latestMessageBatch, messageConfirmation, parseMessagePushResult, unicodeScalarCount, validMessageText, validMessageTimeout, type MessageCommand } from "@/lib/message-push"

test("Unicode 标量和超时边界", () => {
  assert.equal(unicodeScalarCount("😀".repeat(128)), 128)
  assert.equal(validMessageText("😀".repeat(128), 128, false), true)
  assert.equal(validMessageText("😀".repeat(129), 128, false), false)
  assert.equal(validMessageText("line1\nline2", 2000, true), true)
  assert.equal(validMessageText("bad\u0001", 2000, true), false)
  assert.equal(validMessageTimeout(5), true); assert.equal(validMessageTimeout(300), true); assert.equal(validMessageTimeout(301), false)
})

test("严格解析确认、取消、超时和失败结果", () => {
  for (const [deliveryStatus, timedOut, error] of [["confirmed", false, null], ["canceled", false, null], ["timed-out", true, null], ["failed", false, { code: "WIN32_ERROR", message: "failed" }]] as const) {
    assert.ok(parseMessagePushResult(JSON.stringify({ sessionId: deliveryStatus === "failed" ? null : 3, deliveryStatus, responseCode: deliveryStatus === "failed" ? null : 1, timedOut, durationMs: 10, error })))
  }
  assert.equal(parseMessagePushResult(JSON.stringify({ sessionId: 3, deliveryStatus: "timed-out", responseCode: 32000, timedOut: false, durationMs: 10, error: null })), null)
})

test("恢复同一批次并生成提交摘要", () => {
  const cmd = (id: string, createdAt: number, title = "title", expiresAt = "2026-08-07T00:05:00.000Z"): MessageCommand => ({ id, clientId: id, type: "show-message", status: "success", payload: { title, message: "message", severity: "info", timeoutSeconds: 30, expiresAt }, result: null, exitCode: null, createdAt, updatedAt: createdAt })
  assert.deepEqual(latestMessageBatch([cmd("a", 1000), cmd("b", 1001), cmd("old", 1, "title", "2026-08-07T00:04:00.000Z"), cmd("other", 1001, "other")]).map((item) => item.id).sort(), ["a", "b"])
  assert.match(messageConfirmation("title", "body", "warning", 60, ["A", "B"]), /A、B[\s\S]*warning[\s\S]*60/)
})
