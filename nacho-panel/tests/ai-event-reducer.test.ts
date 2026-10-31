import assert from "node:assert/strict"
import test from "node:test"
import {
  applyAIEvent,
  finalizeAssistantMessage,
  restoreChatSessions,
} from "../components/ai-mode/ai-event-reducer"
import type { Message, ToolStep } from "../components/ai-mode/ai-types"
import { createTimer } from "../lib/ai/task-timer"

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

test("running tool snapshots do not hide a pending approval", () => {
  let message = applyAIEvent(assistant(), { type: "step", step })
  message = applyAIEvent(message, {
    type: "approval",
    id: "oc:4",
    approvalId: "oc:4",
    tool: step.tool,
    detail: "echo hello",
    danger: true,
    risk: "danger",
    expiresAt: Date.now() + 1000,
  })
  assert.equal(message.steps[0].status, "waiting-confirm")

  message = applyAIEvent(message, { type: "step-update", id: "prt_1", patch: { status: "running", detail: "echo hello again" } })
  assert.equal(message.steps[0].status, "waiting-confirm")
  assert.equal(message.steps[0].approvalId, "oc:4")

  message = applyAIEvent(message, { type: "step", step: { ...step, status: "running", detail: "echo hello third" } })
  assert.equal(message.steps[0].status, "waiting-confirm")
  assert.equal(message.steps[0].detail, "echo hello third")

  message = applyAIEvent(message, { type: "approval-resolved", approvalId: "oc:4", decision: "once" })
  assert.equal(message.steps[0].status, "running")
  message = applyAIEvent(message, { type: "step-update", id: "prt_1", patch: { status: "done" } })
  assert.equal(message.steps[0].status, "done")
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

test("planning text stays in the answer body across tool boundaries", () => {
  let message = applyAIEvent(assistant(), { type: "text", delta: "I need to find the version. " })
  message = applyAIEvent(message, { type: "text", delta: "I will check the overview tool." })
  message = applyAIEvent(message, { type: "step", step })
  assert.equal(message.text, "I need to find the version. I will check the overview tool.")
  assert.equal(message.reasoning, undefined)
  assert.equal(message.reasoningActive, false)
  assert.equal(message.steps.length, 1)

  message = applyAIEvent(message, { type: "text", delta: "The overview has no version field." })
  message = applyAIEvent(message, { type: "step", step: { ...step, id: "prt_2", tool: "nacho_health_stats", detail: "health" } })
  assert.equal(message.text, "I need to find the version. I will check the overview tool.The overview has no version field.")
  assert.equal(message.reasoning, undefined)

  message = applyAIEvent(message, { type: "text", delta: "没有找到 Nacho 服务端版本。" })
  assert.equal(message.text, "I need to find the version. I will check the overview tool.The overview has no version field.没有找到 Nacho 服务端版本。")
  assert.equal(message.reasoning, undefined)
})

test("pre-approval planning text stays in the answer body", () => {
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
  assert.equal(message.text, "先确认目标客户端。")
  assert.equal(message.reasoning, undefined)
  assert.equal(message.steps[0].status, "waiting-confirm")
})

test("the pre-tool paragraph is kept as the approval ask", () => {
  const ask = "需要你确认：读取 AppData 下的两个 JSON，只取版本字段。"
  let message = applyAIEvent(assistant(), { type: "text", delta: `I need to check the files.\n\n${ask}` })
  message = applyAIEvent(message, { type: "step", step })
  assert.equal(message.steps[0].ask, ask)
  message = applyAIEvent(message, {
    type: "approval",
    id: "oc:5",
    approvalId: "oc:5",
    tool: step.tool,
    detail: "echo hello",
    danger: true,
    expiresAt: Date.now() + 1000,
  })
  assert.equal(message.steps[0].status, "waiting-confirm")
  assert.equal(message.steps[0].ask, ask)
  message = applyAIEvent(message, { type: "step-update", id: "prt_1", patch: { status: "running" } })
  assert.equal(message.steps[0].status, "waiting-confirm")
  assert.equal(message.steps[0].ask, ask)

  // 权限请求先到时也从当前正文取说明。
  let approvalFirst = applyAIEvent(assistant(), { type: "text", delta: ask })
  approvalFirst = applyAIEvent(approvalFirst, {
    type: "approval",
    id: "oc:6",
    approvalId: "oc:6",
    tool: "nacho_run_shell",
    detail: "执行",
    danger: true,
    expiresAt: Date.now() + 1000,
  })
  assert.equal(approvalFirst.steps[0].ask, ask)
})

test("completion keeps the full answer body", () => {
  let message = applyAIEvent(assistant(), { type: "step", step })
  const text = "I notice the grep output accidentally surfaced credentials.\n\n没有找到 Nacho 服务端版本。目录里没有版本文件。"
  message = applyAIEvent(message, { type: "text", delta: text })
  message = applyAIEvent(message, { type: "done" })
  assert.equal(message.reasoning, undefined)
  assert.equal(message.text, text)
  assert.equal(message.done, true)
})

test("restoring a completed agent turn keeps its answer body", () => {
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
    assert.equal(message.reasoning, undefined)
    assert.equal(message.text, "I need to inspect the runtime.\n\n没有找到版本字段。建议重启服务。")
  }
})

test("timer lifecycle stops running steps and appends the failure note", () => {
  const timer = createTimer({ afterSeconds: 60, startedAt: 1_000, reminder: "检查构建日志" })
  let message = applyAIEvent(assistant(), { type: "step", step })
  message = applyAIEvent(message, { type: "timer", timer: { ...timer, state: "waiting" } })
  assert.equal(message.timer?.state, "waiting")
  message = applyAIEvent(message, { type: "timer", timer: { ...timer, state: "fired", firedAt: 2_000 } })
  assert.equal(message.timer?.state, "fired")
  message = applyAIEvent(message, {
    type: "timer",
    timer: { ...timer, state: "wake-failed", error: "AI 引擎仍忙碌" },
  })
  assert.equal(message.timer?.state, "wake-failed")
  assert.equal(message.stopped, true)
  assert.equal(message.steps[0].status, "error")
  assert.match(message.text, /AI 引擎仍忙碌/)
  message = applyAIEvent(message, { type: "done" })
  assert.equal(message.done, true)
  assert.equal(message.stopped, true)

  const finalized = finalizeAssistantMessage(assistant(), "已停止", true)
  assert.equal(finalized.done, true)
  assert.equal(finalized.stopped, true)
})

test("safety cap stops the turn, allows its summary, then ignores late deltas", () => {
  let message = applyAIEvent(assistant(), { type: "step", step })
  message = applyAIEvent(message, { type: "safety-cap", message: "已达到 2 小时安全上限" })
  assert.equal(message.capReached, true)
  assert.equal(message.stopped, true)
  assert.equal(message.steps[0].status, "error")
  assert.match(message.text, /2 小时安全上限/)

  // 安全上限后的总结文本仍应追加，直到 done
  message = applyAIEvent(message, { type: "text", delta: "已完成 2/3。" })
  assert.match(message.text, /已完成 2\/3/)
  message = applyAIEvent(message, { type: "done" })
  const after = applyAIEvent(message, { type: "text", delta: "迟到增量" })
  assert.equal(after.text.includes("迟到增量"), false)
  assert.equal(after.done, true)
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
