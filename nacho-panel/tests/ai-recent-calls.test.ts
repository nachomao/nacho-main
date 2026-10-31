import assert from "node:assert/strict"
import test from "node:test"
import { branchTraceDelay, collectRecentCalls, recentCallCommand } from "../lib/ai/recent-calls"
import type { Session, ToolStep } from "../lib/ai/chat-history"

function step(id: string, tool = id, detail = tool, extra: Partial<ToolStep> = {}): ToolStep {
  return { id, source: "core", tool, detail, status: "done", ...extra }
}

function session(id: string, createdAt: number, steps: ToolStep[]): Session {
  return {
    id,
    title: `会话 ${id}`,
    createdAt,
    messages: [
      { id: `${id}-u`, role: "user", text: "你好" },
      { id: `${id}-a`, role: "assistant", text: "", steps, done: true },
    ],
  }
}

test("最近调用取自最新会话，并按新到旧排列", () => {
  // 会话列表按“新会话在前”存放
  const sessions = [
    session("new", 2_000, [step("n1"), step("n2")]),
    session("old", 1_000, [step("o1"), step("o2"), step("o3")]),
  ]
  const recent = collectRecentCalls(sessions, 3)
  assert.deepEqual(recent.map((call) => call.tool), ["n2", "n1", "o3"])
  assert.equal(recent[0].key, "new:n2")
  assert.equal(recent[0].sessionTitle, "会话 new")
})

test("最近调用保留来源、状态、命令与风险等级", () => {
  const [call] = collectRecentCalls([
    session("s", 1, [step("x", "bash", "systemctl restart nginx", { source: "skill", status: "running", risk: "warn" })]),
  ])
  assert.equal(call.source, "skill")
  assert.equal(call.status, "running")
  assert.equal(call.detail, "systemctl restart nginx")
  assert.equal(call.risk, "warn")
})

test("命令文本：与工具名相同或为空时视为没有参数", () => {
  assert.equal(recentCallCommand({ tool: "bash", detail: "  ls -la  " }), "ls -la")
  assert.equal(recentCallCommand({ tool: "nacho_overview", detail: "nacho_overview" }), "")
  assert.equal(recentCallCommand({ tool: "bash", detail: "   " }), "")
})

test("分支描线从上一次选中位置沿主干逐段推进", () => {
  assert.equal(branchTraceDelay(0, 0, 45), 0)
  assert.equal(branchTraceDelay(4, 1, 45), 135)
  assert.equal(branchTraceDelay(1, 4, 45), 135)
})
