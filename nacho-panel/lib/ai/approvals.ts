import { randomUUID } from "node:crypto"
import { emitApprovalEvent, hasApprovalListener } from "./approval-bus"

export type ApprovalDecision = "once" | "always" | "reject"

type Pending = {
  uiSessionId: string
  approvalId: string
  resolve: (decision: ApprovalDecision) => void
  timer: NodeJS.Timeout
}

const pending = new Map<string, Pending>()
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

export function createBrokerApproval(input: {
  uiSessionId: string
  tool: string
  detail: string
  risk?: "warn" | "danger"
  danger?: boolean
}): Promise<ApprovalDecision> {
  const approvalId = `nacho:${randomUUID()}`
  if (!hasApprovalListener(input.uiSessionId)) return Promise.resolve("reject")
  return new Promise<ApprovalDecision>((resolve) => {
    const timer = setTimeout(() => {
      resolveBrokerApproval(input.uiSessionId, approvalId, "reject")
    }, APPROVAL_TIMEOUT_MS)
    pending.set(approvalId, { uiSessionId: input.uiSessionId, approvalId, resolve, timer })
    emitApprovalEvent(input.uiSessionId, {
      type: "approval",
      id: approvalId,
      approvalId,
      tool: input.tool,
      detail: input.detail,
      risk: input.risk,
      danger: input.danger,
      expiresAt: Date.now() + APPROVAL_TIMEOUT_MS,
    })
  })
}

export function resolveBrokerApproval(uiSessionId: string, approvalId: string, decision: ApprovalDecision) {
  const entry = pending.get(approvalId)
  if (!entry || entry.uiSessionId !== uiSessionId) return false
  pending.delete(approvalId)
  clearTimeout(entry.timer)
  emitApprovalEvent(uiSessionId, { type: "approval-resolved", approvalId, decision })
  entry.resolve(decision)
  return true
}

export function denyAllPending(uiSessionId: string) {
  for (const [approvalId, entry] of pending) {
    if (entry.uiSessionId !== uiSessionId) continue
    pending.delete(approvalId)
    clearTimeout(entry.timer)
    emitApprovalEvent(uiSessionId, { type: "approval-resolved", approvalId, decision: "reject" })
    entry.resolve("reject")
  }
}

export function hasPendingApproval(approvalId: string) {
  return pending.has(approvalId)
}
