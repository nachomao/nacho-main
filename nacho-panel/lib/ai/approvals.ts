import { randomUUID } from "node:crypto"
import { emitApprovalEvent, hasApprovalListener } from "./approval-bus"
import { getActiveTurnId } from "./chat-sessions"

export type ApprovalDecision = "once" | "always" | "reject"

type Pending = {
  uiSessionId: string
  approvalId: string
  turnId: string | null
  resolve: (decision: ApprovalDecision) => void
  signal?: AbortSignal
  onAbort?: () => void
}

const pending = new Map<string, Pending>()
// opencode 权限审批不经过 broker；登记表用于阻止流结束后迟到的点击。
const pendingPermissions = new Map<string, string>()

function detachAbort(entry: Pending) {
  if (entry.signal && entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort)
}

export function createBrokerApproval(input: {
  uiSessionId: string
  tool: string
  detail: string
  risk?: "warn" | "danger"
  danger?: boolean
  turnId?: string | null
  signal?: AbortSignal
}): Promise<ApprovalDecision> {
  if (!hasApprovalListener(input.uiSessionId)) return Promise.resolve("reject")
  if (input.signal?.aborted) return Promise.resolve("reject")
  const approvalId = `nacho:${randomUUID()}`
  const turnId = input.turnId ?? getActiveTurnId()
  return new Promise<ApprovalDecision>((resolve) => {
    const entry: Pending = {
      uiSessionId: input.uiSessionId,
      approvalId,
      turnId,
      resolve,
      signal: input.signal,
    }
    const onAbort = () => {
      resolveBrokerApproval(input.uiSessionId, approvalId, "reject")
    }
    entry.onAbort = onAbort
    input.signal?.addEventListener("abort", onAbort, { once: true })
    pending.set(approvalId, entry)
    emitApprovalEvent(input.uiSessionId, {
      type: "approval",
      id: approvalId,
      approvalId,
      tool: input.tool,
      detail: input.detail,
      risk: input.risk,
      danger: input.danger,
    })
  })
}

export function resolveBrokerApproval(uiSessionId: string, approvalId: string, decision: ApprovalDecision) {
  const entry = pending.get(approvalId)
  if (!entry || entry.uiSessionId !== uiSessionId) return false
  pending.delete(approvalId)
  detachAbort(entry)
  emitApprovalEvent(uiSessionId, { type: "approval-resolved", approvalId, decision })
  entry.resolve(decision)
  return true
}

/** 不传 turnId 时拒绝该会话全部审批；传入时保留其他回合的审批。 */
export function denyAllPending(uiSessionId: string, turnId?: string) {
  for (const [approvalId, entry] of pending) {
    if (entry.uiSessionId !== uiSessionId) continue
    if (turnId && entry.turnId !== null && entry.turnId !== turnId) continue
    pending.delete(approvalId)
    detachAbort(entry)
    emitApprovalEvent(uiSessionId, { type: "approval-resolved", approvalId, decision: "reject" })
    entry.resolve("reject")
  }
}

export function hasPendingApproval(approvalId: string) {
  return pending.has(approvalId)
}

export function registerPendingPermission(uiSessionId: string, approvalId: string) {
  pendingPermissions.set(approvalId, uiSessionId)
}

export function hasPendingPermission(uiSessionId: string, approvalId: string) {
  return pendingPermissions.get(approvalId) === uiSessionId
}

export function forgetPendingPermission(uiSessionId: string, approvalId: string) {
  if (pendingPermissions.get(approvalId) === uiSessionId) pendingPermissions.delete(approvalId)
}

export function clearPendingPermissions(uiSessionId: string) {
  for (const [approvalId, owner] of pendingPermissions) {
    if (owner === uiSessionId) pendingPermissions.delete(approvalId)
  }
}
