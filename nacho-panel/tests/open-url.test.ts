import assert from "node:assert/strict"
import test from "node:test"
import {
  isValidOpenUrl,
  latestOpenUrlBatch,
  openUrlConfirmation,
  openUrlResultText,
  openUrlValidationError,
  parseOpenUrlResult,
  type OpenUrlCommand,
} from "@/lib/open-url"

test("打开网页地址执行严格边界校验", () => {
  for (const url of ["https://example.com", "http://127.0.0.1:8080/fixture", "https://例子.测试/路径?q=1#x"]) assert.equal(isValidOpenUrl(url), true)
  for (const url of ["", "/relative", "file:///tmp/a", "javascript:alert(1)", "data:text/plain,x", "https://user@example.com", "https://user:pass@example.com", "https://example.com/bad\nnext", "https://example.com/" + "x".repeat(2049)]) assert.equal(isValidOpenUrl(url), false)
  assert.match(openUrlValidationError("https://user@example.com") ?? "", /用户信息/)
  assert.equal(isValidOpenUrl("https://example.com/" + "x".repeat(2028)), true)
})

test("严格解析已启动、过期和失败结果并保持准确文案", () => {
  const started = parseOpenUrlResult(JSON.stringify({ sessionId: 3, processStarted: true, pid: 4321, durationMs: 10, expired: false, error: null }))
  assert.ok(started)
  assert.equal(openUrlResultText(started), "已启动浏览器请求")
  const expired = parseOpenUrlResult(JSON.stringify({ sessionId: null, processStarted: false, pid: null, durationMs: 1, expired: true, error: { code: "EXPIRED", message: "expired" } }))
  assert.ok(expired)
  assert.match(openUrlResultText(expired), /未启动浏览器/)
  const failed = parseOpenUrlResult(JSON.stringify({ sessionId: 3, processStarted: false, pid: null, durationMs: 2, expired: false, error: { code: "WIN32_ERROR", message: "failed" } }))
  assert.ok(failed)
  assert.equal(parseOpenUrlResult(JSON.stringify({ sessionId: 3, processStarted: true, pid: null, durationMs: 1, expired: false, error: null })), null)
  assert.equal(parseOpenUrlResult(JSON.stringify({ sessionId: null, processStarted: false, pid: null, durationMs: 1, expired: false, error: { code: "EXPIRED", message: "x" } })), null)
})

test("恢复最新批次、确认摘要和重复提交所需终态", () => {
  const command = (id: string, createdAt: number, url = "https://example.com", expiresAt = "2026-08-07T00:05:00.000Z"): OpenUrlCommand => ({ id, clientId: id, type: "open-url", status: "success", payload: { url, expiresAt }, result: null, exitCode: null, createdAt, updatedAt: createdAt })
  assert.deepEqual(latestOpenUrlBatch([command("a", 1000), command("b", 1001), command("old", 1, "https://example.com", "2026-08-07T00:04:00.000Z"), command("other", 1002, "https://other.example")]).map((item) => item.id), ["other"])
  assert.deepEqual(latestOpenUrlBatch([command("a", 1000), command("b", 1001)]).map((item) => item.id).sort(), ["a", "b"])
  assert.match(openUrlConfirmation("https://example.com", ["A", "B"]), /A、B[\s\S]*不代表页面已完成加载/)
})
