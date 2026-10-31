import type { Session, StepStatus, ToolStep } from "./chat-history"

export type RecentCall = {
  /** 会话内唯一的步骤 id 加上会话 id，跨会话也不会撞键 */
  key: string
  tool: string
  source: ToolStep["source"]
  status: StepStatus
  detail: string
  risk?: ToolStep["risk"]
  sessionTitle: string
}

/**
 * 最近的工具调用（新 → 旧）。
 * 会话列表按“新会话在前”存放，这里按创建时间正序展开后再取末尾，跨会话时取到的才是最新会话的调用。
 */
export function collectRecentCalls(sessions: Session[], limit = 6): RecentCall[] {
  const ordered = [...sessions].sort((a, b) => a.createdAt - b.createdAt)
  const calls: RecentCall[] = []
  for (const session of ordered) {
    for (const message of session.messages) {
      if (message.role !== "assistant") continue
      for (const step of message.steps) {
        calls.push({
          key: `${session.id}:${step.id}`,
          tool: step.tool,
          source: step.source,
          status: step.status,
          detail: step.detail,
          ...(step.risk ? { risk: step.risk } : {}),
          sessionTitle: session.title,
        })
      }
    }
  }
  return calls.slice(-limit).reverse()
}

/** 调用的命令文本；detail 为空或与工具名相同表示没有参数。 */
export function recentCallCommand(call: Pick<RecentCall, "tool" | "detail">) {
  const detail = call.detail.trim()
  return detail && detail !== call.tool ? detail : ""
}

/** 分支描线错峰：从上一次选中的位置出发，沿主干逐段推进（或回收）到新位置。 */
export function branchTraceDelay(order: number, origin: number, stepMs: number) {
  return Math.abs(order - origin) * stepMs
}
