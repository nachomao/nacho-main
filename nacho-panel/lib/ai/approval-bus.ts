import type { AIChatEvent } from "./chat-events"

type ApprovalEvent = Extract<AIChatEvent, { type: "approval" | "approval-resolved" }>
type Listener = (event: ApprovalEvent) => void

const listeners = new Map<string, Set<Listener>>()

export function subscribeApprovals(uiSessionId: string, listener: Listener) {
  let set = listeners.get(uiSessionId)
  if (!set) {
    set = new Set()
    listeners.set(uiSessionId, set)
  }
  set.add(listener)
  return () => {
    set?.delete(listener)
    if (set?.size === 0) listeners.delete(uiSessionId)
  }
}

export function emitApprovalEvent(uiSessionId: string, event: ApprovalEvent) {
  const set = listeners.get(uiSessionId)
  if (!set) return false
  for (const listener of set) listener(event)
  return true
}

export function hasApprovalListener(uiSessionId: string) {
  return Boolean(listeners.get(uiSessionId)?.size)
}
