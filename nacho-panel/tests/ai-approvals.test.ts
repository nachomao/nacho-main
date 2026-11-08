import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import {
  clearPendingPermissions,
  createBrokerApproval,
  denyAllPending,
  forgetPendingPermission,
  hasPendingApproval,
  hasPendingPermission,
  registerPendingPermission,
  resolveBrokerApproval,
} from "../lib/ai/approvals"
import { subscribeApprovals } from "../lib/ai/approval-bus"

function createPending(t: TestContext, uiSessionId: string, turnId: string | null = "t-1") {
  let approvalId = ""
  const unsubscribe = subscribeApprovals(uiSessionId, (event) => {
    if (event.type === "approval") approvalId = event.approvalId
  })
  t.after(unsubscribe)
  const promise = createBrokerApproval({
    uiSessionId,
    turnId,
    tool: "nacho_run_shell",
    detail: "echo test",
    risk: "danger",
    danger: true,
  })
  assert.ok(approvalId)
  return { promise, approvalId }
}

test("broker approval has no automatic timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"], now: 0 })
  t.after(() => t.mock.timers.reset())
  const { promise, approvalId } = createPending(t, "u-no-timeout")
  let settled: string | null = null
  void promise.then((decision) => { settled = decision })

  t.mock.timers.tick(5 * 60 * 1000)
  t.mock.timers.tick(24 * 60 * 60 * 1000)
  await Promise.resolve()
  assert.equal(settled, null)
  assert.equal(hasPendingApproval(approvalId), true)

  assert.equal(resolveBrokerApproval("u-no-timeout", approvalId, "once"), true)
  assert.equal(await promise, "once")
})

test("denyAllPending rejects only the requested turn", async (t) => {
  const first = createPending(t, "u-turn-scope", "t-1")
  const second = createPending(t, "u-turn-scope", "t-2")
  denyAllPending("u-turn-scope", "t-1")
  assert.equal(await first.promise, "reject")
  assert.equal(hasPendingApproval(first.approvalId), false)
  assert.equal(hasPendingApproval(second.approvalId), true)
  assert.equal(resolveBrokerApproval("u-turn-scope", second.approvalId, "reject"), true)
  assert.equal(await second.promise, "reject")
})

test("aborting the MCP request rejects the pending approval", async (t) => {
  const uiSessionId = "u-abort-signal"
  let approvalId = ""
  const unsubscribe = subscribeApprovals(uiSessionId, (event) => {
    if (event.type === "approval") approvalId = event.approvalId
  })
  t.after(unsubscribe)
  const controller = new AbortController()
  const promise = createBrokerApproval({
    uiSessionId,
    turnId: "t-1",
    tool: "nacho_run_shell",
    detail: "echo test",
    signal: controller.signal,
  })
  assert.ok(approvalId)
  controller.abort()
  assert.equal(await promise, "reject")
  assert.equal(hasPendingApproval(approvalId), false)
})

test("opencode permission registry prevents late replies", () => {
  const uiSessionId = "u-permission-registry"
  const approvalId = "oc:permission-1"
  assert.equal(hasPendingPermission(uiSessionId, approvalId), false)
  registerPendingPermission(uiSessionId, approvalId)
  assert.equal(hasPendingPermission(uiSessionId, approvalId), true)
  assert.equal(hasPendingPermission("other-session", approvalId), false)
  forgetPendingPermission("other-session", approvalId)
  assert.equal(hasPendingPermission(uiSessionId, approvalId), true)
  forgetPendingPermission(uiSessionId, approvalId)
  assert.equal(hasPendingPermission(uiSessionId, approvalId), false)

  registerPendingPermission(uiSessionId, approvalId)
  clearPendingPermissions(uiSessionId)
  assert.equal(hasPendingPermission(uiSessionId, approvalId), false)
})
