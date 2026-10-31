import assert from "node:assert/strict"
import test from "node:test"
import { firstWaitingStepId, groupToolSteps } from "../lib/ai/tool-groups"
import type { ToolStep } from "../lib/ai/chat-history"

function step(id: string, source: ToolStep["source"], status: ToolStep["status"] = "done"): ToolStep {
  return { id, source, tool: id, detail: id, status }
}

test("tool steps group by source in first-seen order", () => {
  const groups = groupToolSteps([
    step("a", "mcp"),
    step("b", "core"),
    step("c", "mcp"),
    step("d", "skill"),
  ])
  assert.deepEqual(groups.map((group) => group.source), ["mcp", "core", "skill"])
  assert.deepEqual(groups[0].steps.map((item) => item.id), ["a", "c"])
  assert.deepEqual(groups[1].steps.map((item) => item.id), ["b"])
})

test("first waiting step is selected for approval", () => {
  assert.equal(firstWaitingStepId([]), null)
  assert.equal(firstWaitingStepId([step("a", "core"), step("b", "core", "waiting-confirm")]), "b")
  assert.equal(firstWaitingStepId([
    step("a", "core", "waiting-confirm"),
    step("b", "core", "waiting-confirm"),
  ]), "a")
})
