import assert from "node:assert/strict"
import test from "node:test"
import { SessionEventMapper } from "../lib/ai/event-map"

const SESSION = "ses_test"
const USER = "msg_user"
const ASSISTANT = "msg_assistant"

function mapperWithMessages() {
  const mapper = new SessionEventMapper()
  mapper.map({ type: "message.updated", properties: { sessionID: SESSION, info: { id: USER, role: "user" } } })
  mapper.map({ type: "message.part.updated", properties: { sessionID: SESSION, part: { id: "prt_user", messageID: USER, type: "text", text: "你好" } } })
  mapper.map({ type: "message.updated", properties: { sessionID: SESSION, info: { id: ASSISTANT, role: "assistant" } } })
  return mapper
}

test("user text parts are ignored and assistant text is emitted as deltas", () => {
  const mapper = mapperWithMessages()
  // opencode 的 text-start 会先发空文本快照，随后才是增量。
  assert.deepEqual(mapper.map({ type: "message.part.updated", properties: { sessionID: SESSION, part: { id: "prt_text", messageID: ASSISTANT, type: "text", text: "" } } }), [])
  assert.deepEqual(mapper.map({ type: "message.part.delta", properties: { sessionID: SESSION, messageID: ASSISTANT, partID: "prt_text", field: "text", delta: "你" } }), [{ type: "text", delta: "你" }])
  assert.deepEqual(mapper.map({ type: "message.part.delta", properties: { sessionID: SESSION, messageID: ASSISTANT, partID: "prt_text", field: "text", delta: "好" } }), [{ type: "text", delta: "好" }])
  // 全量文本只补齐缺失后缀，不重复输出
  assert.deepEqual(mapper.map({ type: "message.part.updated", properties: { sessionID: SESSION, part: { id: "prt_text", messageID: ASSISTANT, type: "text", text: "你好呀" } } }), [{ type: "text", delta: "呀" }])
  assert.deepEqual(mapper.map({ type: "message.part.updated", properties: { sessionID: SESSION, part: { id: "prt_text", messageID: ASSISTANT, type: "text", text: "你好呀" } } }), [])
})

test("unknown part deltas are dropped instead of leaking into the answer", () => {
  const mapper = mapperWithMessages()
  assert.deepEqual(mapper.map({ type: "message.part.delta", properties: { sessionID: SESSION, messageID: ASSISTANT, partID: "prt_unknown", field: "text", delta: "泄漏" } }), [])
})

test("reasoning parts stream separately from answer text and settle once", () => {
  const mapper = mapperWithMessages()
  assert.deepEqual(mapper.map({
    type: "message.part.updated",
    properties: { sessionID: SESSION, part: { id: "prt_reason", messageID: ASSISTANT, type: "reasoning", text: "" } },
  }), [])
  assert.deepEqual(mapper.map({
    type: "message.part.delta",
    properties: { sessionID: SESSION, messageID: ASSISTANT, partID: "prt_reason", field: "text", delta: "先分析" },
  }), [{ type: "reasoning", delta: "先分析" }])
  assert.deepEqual(mapper.map({
    type: "message.part.delta",
    properties: { sessionID: SESSION, messageID: ASSISTANT, partID: "prt_reason", field: "text", delta: "再执行" },
  }), [{ type: "reasoning", delta: "再执行" }])
  // reasoning 快照只补缺失后缀，并在 time.end 时发出一次 reasoning-done
  assert.deepEqual(mapper.map({
    type: "message.part.updated",
    properties: { sessionID: SESSION, part: { id: "prt_reason", messageID: ASSISTANT, type: "reasoning", text: "先分析再执行。", time: { start: 1, end: 2 } } },
  }), [{ type: "reasoning", delta: "。" }, { type: "reasoning-done" }])
  assert.deepEqual(mapper.map({
    type: "message.part.updated",
    properties: { sessionID: SESSION, part: { id: "prt_reason", messageID: ASSISTANT, type: "reasoning", text: "先分析再执行。", time: { start: 1, end: 2 } } },
  }), [])
  // 正文仍走 text 通道
  mapper.map({ type: "message.part.updated", properties: { sessionID: SESSION, part: { id: "prt_answer", messageID: ASSISTANT, type: "text", text: "" } } })
  assert.deepEqual(mapper.map({
    type: "message.part.delta",
    properties: { sessionID: SESSION, messageID: ASSISTANT, partID: "prt_answer", field: "text", delta: "结论" },
  }), [{ type: "text", delta: "结论" }])
})

test("tool parts map to steps and updates with source classification", () => {
  const mapper = mapperWithMessages()
  const first = mapper.map({
    type: "message.part.updated",
    properties: {
      sessionID: SESSION,
      part: { id: "prt_tool", messageID: ASSISTANT, type: "tool", callID: "call_1", tool: "nacho_run_shell", state: { status: "pending", input: {} } },
    },
  })
  assert.equal(first.length, 1)
  assert.equal(first[0].type, "step")
  if (first[0].type === "step") {
    assert.equal(first[0].step.id, "prt_tool")
    assert.equal(first[0].step.source, "skill")
    assert.equal(first[0].step.status, "running")
    assert.equal(first[0].step.danger, true)
  }
  const second = mapper.map({
    type: "message.part.updated",
    properties: {
      sessionID: SESSION,
      part: { id: "prt_tool", messageID: ASSISTANT, type: "tool", callID: "call_1", tool: "nacho_run_shell", state: { status: "running", input: { command: "echo hello" } } },
    },
  })
  assert.equal(second[0].type, "step-update")
  if (second[0].type === "step-update") {
    assert.equal(second[0].id, "prt_tool")
    assert.equal(second[0].patch.detail, "echo hello")
  }
  const done = mapper.map({
    type: "message.part.updated",
    properties: {
      sessionID: SESSION,
      part: { id: "prt_tool", messageID: ASSISTANT, type: "tool", callID: "call_1", tool: "nacho_run_shell", state: { status: "completed", input: { command: "echo hello" }, output: "hello" } },
    },
  })
  assert.equal(done[0].type, "step-update")
  if (done[0].type === "step-update") {
    assert.equal(done[0].patch.status, "done")
    assert.equal(done[0].patch.output, "hello")
  }
})

test("permission events correlate to tool call and resolve", () => {
  const mapper = mapperWithMessages()
  mapper.map({
    type: "message.part.updated",
    properties: {
      sessionID: SESSION,
      part: { id: "prt_tool", messageID: ASSISTANT, type: "tool", callID: "call_1", tool: "bash", state: { status: "pending", input: {} } },
    },
  })
  const approval = mapper.map({
    type: "permission.asked",
    properties: {
      id: "per_1",
      sessionID: SESSION,
      permission: "bash",
      patterns: ["echo hello"],
      metadata: {},
      always: [],
      tool: { messageID: ASSISTANT, callID: "call_1" },
    },
  })
  assert.equal(approval.length, 1)
  const event = approval[0]
  assert.equal(event.type, "approval")
  if (event.type === "approval") {
    assert.equal(event.id, "prt_tool")
    assert.equal(event.approvalId, "oc:per_1")
    assert.equal(event.tool, "bash")
    assert.equal(event.detail, "echo hello")
    assert.equal(event.danger, true)
  }
  assert.deepEqual(mapper.map({ type: "permission.replied", properties: { sessionID: SESSION, requestID: "per_1", reply: "once" } }), [
    { type: "approval-resolved", approvalId: "oc:per_1", decision: "once" },
  ])
})

test("errors are sanitized and idle is emitted once", () => {
  const mapper = mapperWithMessages()
  const error = mapper.map({
    type: "session.error",
    properties: { sessionID: SESSION, error: { name: "ProviderAuthError", data: { message: "bad key sk-abcdefghijklmnop" } } },
  })
  assert.equal(error[0].type, "error")
  if (error[0].type === "error") {
    assert.match(error[0].message, /模型服务鉴权失败/)
    assert.equal(error[0].message.includes("sk-abcdefghijklmnop"), false)
  }
  assert.deepEqual(mapper.map({ type: "session.idle", properties: { sessionID: SESSION } }), [{ type: "done" }])
  assert.deepEqual(mapper.map({ type: "session.idle", properties: { sessionID: SESSION } }), [])
})
