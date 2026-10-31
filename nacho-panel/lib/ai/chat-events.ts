export type AIChatStepSource = "skill" | "mcp" | "plugin" | "core"

export type AIChatStep = {
  id: string
  source: AIChatStepSource
  tool: string
  detail: string
  status: "running" | "done" | "error" | "waiting-confirm"
  output?: string
  danger?: boolean
  risk?: "warn" | "danger"
  approvalId?: string
  /** 工具调用前模型写下的确认说明，用于审批卡展示。 */
  ask?: string
}

export type AIChatTimer = {
  afterSeconds: number
  startedAt: number
  pausedAt?: number
  pausedTotalMs: number
  reminder: string
  label?: string
  onExpire: "wait" | "interrupt"
  fallback?: boolean
  updated?: boolean
  state: "set" | "waiting" | "fired" | "canceled" | "wake-failed"
  firedAt?: number
  error?: string
}

export type AIChatEvent =
  | { type: "ready" }
  | { type: "ping" }
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "reasoning-done" }
  | { type: "step"; step: AIChatStep }
  | { type: "step-update"; id: string; patch: Partial<Pick<AIChatStep, "detail" | "output" | "status" | "danger" | "risk" | "approvalId">> }
  | { type: "approval"; id: string; approvalId: string; tool: string; detail: string; risk?: "warn" | "danger"; danger?: boolean; expiresAt: number }
  | { type: "approval-resolved"; approvalId: string; decision: "once" | "always" | "reject" }
  | { type: "timer-set"; afterSeconds: number; reminder: string; label?: string; onExpire: "wait" | "interrupt" }
  | { type: "timer-cancel"; reason?: string }
  | { type: "timer"; timer: AIChatTimer }
  | { type: "safety-cap"; message: string }
  | { type: "done" }
  | { type: "error"; message: string; code?: string }
