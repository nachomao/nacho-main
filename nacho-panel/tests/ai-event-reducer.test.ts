import assert from "node:assert/strict"
import test from "node:test"
import {
  applyAIEvent,
  finalizeAssistantMessage,
  restoreChatSessions,
} from "../components/ai-mode/ai-event-reducer"
import type { Message, ToolStep } from "../components/ai-mode/ai-types"

type Assistant = Extract<Message, { role: "assistant" }>

function assistant(): Assistant {
  return { id: "a1", role: "assistant", text: "", steps: [], done: false }
}

const step: ToolStep = {
  id: "prt_1",
  source: "skill",
  tool: "nacho_run_shell",
  detail: "echo hello",
  status: "running",
  danger: true,
  risk: "danger",
}

test("text deltas append and steps upsert", () => {
  let message = applyAIEvent(assistant(), { type: "text", delta: "你" })
  message = applyAIEvent(message, { type: "text", delta: "好" })
  assert.equal(message.text, "你好")
  message = applyAIEvent(message, { type: "step", step })
  assert.equal(message.steps.length, 1)
  message = applyAIEvent(message, { type: "step", step: { ...step, status: "done", output: "ok" } })
  assert.equal(message.steps.length, 1)
  assert.equal(message.steps[0].status, "done")
  assert.equal(message.steps[0].output, "ok")
})

test("approval merges into an existing running step and resolves", () => {
  let message = applyAIEvent(assistant(), { type: "step", step })
  message = applyAIEvent(message, {
    type: "approval",
    id: "nacho:1",
    approvalId: "nacho:1",
    tool: "nacho_run_shell",
    detail: "执行 echo",
    danger: true,
    risk: "danger",
    expiresAt: Date.now() + 1000,
  })
  assert.equal(message.steps[0].status, "waiting-confirm")
  assert.equal(message.steps[0].approvalId, "nacho:1")
  message = applyAIEvent(message, { type: "approval-resolved", approvalId: "nacho:1", decision: "once" })
  assert.equal(message.steps[0].status, "running")
  message = applyAIEvent(message, { type: "approval-resolved", approvalId: "nacho:1", decision: "reject" })
  assert.equal(message.steps[0].status, "error")
  assert.equal(message.steps[0].output, "已拒绝执行")
})

test("a late tool step replaces a synthetic broker approval step", () => {
  let message = applyAIEvent(assistant(), {
    type: "approval",
    id: "nacho:2",
    approvalId: "nacho:2",
    tool: "nacho_run_shell",
    detail: "执行",
    danger: true,
    risk: "danger",
    expiresAt: Date.now() + 1000,
  })
  assert.equal(message.steps[0].id, "nacho:2")
  message = applyAIEvent(message, { type: "step", step: { ...step, id: "prt_2" } })
  assert.equal(message.steps.length, 1)
  assert.equal(message.steps[0].id, "prt_2")
  assert.equal(message.steps[0].approvalId, "nacho:2")
})

test("done and error finalize pending steps", () => {
  let message = applyAIEvent(assistant(), { type: "step", step: { ...step, status: "waiting-confirm", approvalId: "nacho:3" } })
  message = applyAIEvent(message, { type: "done" })
  assert.equal(message.done, true)
  assert.equal(message.steps[0].status, "error")

  let failed = applyAIEvent(assistant(), { type: "step", step })
  failed = applyAIEvent(failed, { type: "error", message: "连接中断" })
  assert.equal(failed.done, true)
  assert.match(failed.text, /请求失败：连接中断/)
  assert.equal(failed.steps[0].status, "error")

  const finalized = finalizeAssistantMessage(assistant(), "已中止")
  assert.equal(finalized.done, true)
  assert.equal(finalized.text, "已中止")
})

test("reasoning accumulates separately and settles on text, tools and done", () => {
  let message = applyAIEvent(assistant(), { type: "reasoning", delta: "先确认目标，" })
  message = applyAIEvent(message, { type: "reasoning", delta: "再拆解步骤。" })
  assert.equal(message.reasoning, "先确认目标，再拆解步骤。")
  assert.equal(message.reasoningActive, true)
  assert.equal(message.text, "")

  message = applyAIEvent(message, { type: "reasoning-done" })
  assert.equal(message.reasoningActive, false)

  message = applyAIEvent(message, { type: "step", step })
  assert.equal(message.reasoningActive, false)
  message = applyAIEvent(message, { type: "text", delta: "结论" })
  assert.equal(message.text, "结论")
  assert.equal(message.reasoning, "先确认目标，再拆解步骤。")
})

test("pre-tool planning text moves into reasoning at each tool boundary", () => {
  let message = applyAIEvent(assistant(), { type: "text", delta: "I need to find the version. " })
  message = applyAIEvent(message, { type: "text", delta: "I will check the overview tool." })
  message = applyAIEvent(message, { type: "step", step })
  assert.equal(message.text, "")
  assert.equal(message.reasoning, "I need to find the version. I will check the overview tool.")
  assert.equal(message.reasoningActive, false)
  assert.equal(message.steps.length, 1)

  // 第二次工具调用前的计划继续追加到 reasoning，用空行分隔
  message = applyAIEvent(message, { type: "text", delta: "The overview has no version field." })
  message = applyAIEvent(message, { type: "step", step: { ...step, id: "prt_2", tool: "nacho_health_stats", detail: "health" } })
  assert.equal(message.text, "")
  assert.equal(message.reasoning, "I need to find the version. I will check the overview tool.\n\nThe overview has no version field.")

  // 工具结束后的最终回答保留在正文
  message = applyAIEvent(message, { type: "text", delta: "没有找到 Nacho 服务端版本。" })
  assert.equal(message.text, "没有找到 Nacho 服务端版本。")
  assert.equal(message.reasoning, "I need to find the version. I will check the overview tool.\n\nThe overview has no version field.")
})

test("pre-approval planning text also moves into reasoning", () => {
  let message = applyAIEvent(assistant(), { type: "text", delta: "先确认目标客户端。" })
  message = applyAIEvent(message, {
    type: "approval",
    id: "nacho:9",
    approvalId: "nacho:9",
    tool: "nacho_run_shell",
    detail: "重启服务",
    danger: true,
    risk: "danger",
    expiresAt: Date.now() + 1000,
  })
  assert.equal(message.text, "")
  assert.equal(message.reasoning, "先确认目标客户端。")
  assert.equal(message.steps[0].status, "waiting-confirm")
})

test("completion moves a leading English reflection out of the final answer", () => {
  let message = applyAIEvent(assistant(), { type: "step", step })
  message = applyAIEvent(message, {
    type: "text",
    delta: "I notice the grep output accidentally surfaced credentials.\n\n没有找到 Nacho 服务端版本。目录里没有版本文件。",
  })
  message = applyAIEvent(message, { type: "done" })
  assert.equal(message.reasoning, "I notice the grep output accidentally surfaced credentials.")
  assert.equal(message.text, "没有找到 Nacho 服务端版本。目录里没有版本文件。")
  assert.equal(message.done, true)
})

test("restoring a completed agent turn also separates its planning text", () => {
  const restored = restoreChatSessions([{
    id: "s1",
    title: "历史",
    createdAt: 1,
    messages: [{
      id: "a1",
      role: "assistant",
      text: "I need to inspect the runtime.\n\n没有找到版本字段。建议重启服务。",
      steps: [step],
      done: true,
    }],
  }])
  const message = restored[0].messages[0]
  assert.equal(message.role, "assistant")
  if (message.role === "assistant") {
    assert.equal(message.reasoning, "I need to inspect the runtime.")
    assert.equal(message.text, "没有找到版本字段。建议重启服务。")
  }
})

test("restored sessions finish interrupted turns and clear reasoning state", () => {
  const restored = restoreChatSessions([{
    id: "s1",
    title: "历史",
    createdAt: 1,
    messages: [
      { id: "u1", role: "user", text: "继续" },
      { id: "a1", role: "assistant", text: "", reasoning: "旧思考", reasoningActive: true, steps: [{ ...step, status: "running" }], done: false },
      { id: "a2", role: "assistant", text: "已完成", reasoning: "思考", reasoningActive: true, steps: [], done: true },
    ],
  }])
  const interrupted = restored[0].messages[1]
  assert.equal(interrupted.role, "assistant")
  if (interrupted.role === "assistant") {
    assert.equal(interrupted.done, true)
    assert.equal(interrupted.text, "上次会话已中断")
    assert.equal(interrupted.reasoningActive, false)
    assert.equal(interrupted.steps[0].status, "error")
  }
  const completed = restored[0].messages[2]
  if (completed.role === "assistant") {
    assert.equal(completed.done, true)
    assert.equal(completed.reasoningActive, false)
    assert.equal(completed.text, "已完成")
  }
})
