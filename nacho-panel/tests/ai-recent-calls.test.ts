import assert from "node:assert/strict"
import test from "node:test"
import {
  branchTraceDelay,
  collectRecentCalls,
  recentCallCommand,
  recentCallsContentDelay,
  recentCallsLeadDelay,
  recentCallsSwapDuration,
  RECENT_CALLS_BLUR_MS,
  RECENT_CALLS_STEP_MS,
} from "../lib/ai/recent-calls"
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

test("最近调用只取当前会话，并按新到旧排列", () => {
  const current = session("now", 2_000, [step("n1"), step("n2")])
  const older = session("old", 1_000, [step("o1"), step("o2"), step("o3")])
  const recent = collectRecentCalls(current, 3)
  assert.deepEqual(recent.map((call) => call.tool), ["n2", "n1"])
  assert.equal(recent[0].key, "now:n2")
  assert.equal(recent[0].sessionTitle, "会话 now")
  // 其他会话的调用不会串入当前会话
  assert.deepEqual(collectRecentCalls(older, 3).map((call) => call.tool), ["o3", "o2", "o1"])
})

test("新建会话从空记录开始，切回旧会话恢复其自己的调用", () => {
  const fresh: Session = { id: "fresh", title: "新会话", createdAt: 3_000, messages: [] }
  assert.deepEqual(collectRecentCalls(fresh), [])
  assert.deepEqual(collectRecentCalls(undefined), [])
  const previous = session("prev", 1_000, [step("p1"), step("p2")])
  assert.deepEqual(collectRecentCalls(previous).map((call) => call.tool), ["p2", "p1"])
})

test("最近调用保留来源、状态、命令与风险等级", () => {
  const [call] = collectRecentCalls(
    session("s", 1, [step("x", "bash", "systemctl restart nginx", { source: "skill", status: "running", risk: "warn" })]),
  )
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

test("会话切换：牵引线从顶端逐行向下，工具内容随后模糊渐显", () => {
  assert.equal(recentCallsLeadDelay(0, 3, "enter"), 0)
  assert.equal(recentCallsLeadDelay(2, 3, "enter"), 2 * RECENT_CALLS_STEP_MS)
  // 内容必须等牵引线先到达该行
  assert.ok(recentCallsContentDelay(2, 3, "enter") > recentCallsLeadDelay(2, 3, "enter"))
})

test("会话切换：牵引线从末行向上收展，内容在离开该行后模糊渐隐", () => {
  assert.equal(recentCallsLeadDelay(2, 3, "exit"), 0)
  assert.equal(recentCallsLeadDelay(0, 3, "exit"), 2 * RECENT_CALLS_STEP_MS)
  assert.ok(recentCallsContentDelay(0, 3, "exit") > recentCallsLeadDelay(0, 3, "exit"))
  assert.equal(recentCallsLeadDelay(1, 3, "steady"), 0)
})

test("会话切换总时长覆盖最后一行的内容动画", () => {
  const count = 6
  const lastContentEnd =
    recentCallsContentDelay(count - 1, count, "enter") + RECENT_CALLS_BLUR_MS
  const topContentEnd =
    recentCallsContentDelay(0, count, "exit") + RECENT_CALLS_BLUR_MS
  assert.ok(recentCallsSwapDuration(count) >= lastContentEnd)
  assert.ok(recentCallsSwapDuration(count) >= topContentEnd)
  assert.equal(recentCallsSwapDuration(0), 0)
})
