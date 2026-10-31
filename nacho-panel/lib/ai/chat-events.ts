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
  | { type: "done" }
  | { type: "error"; message: string; code?: string }
