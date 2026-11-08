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
 * 当前会话最近的工具调用（新 → 旧）。
 * 调用记录跟随会话：新建会话没有历史步骤，切换会话只显示该会话自己的调用，不会串入其他会话。
 */
export function collectRecentCalls(session: Session | null | undefined, limit = 6): RecentCall[] {
  if (!session) return []
  const calls: RecentCall[] = []
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

/** 会话切换时牵引线的节拍：每根主干推进/收展一行的时长。 */
export const RECENT_CALLS_STEP_MS = 60
/** 单行工具内容的模糊渐显/渐隐时长。 */
export const RECENT_CALLS_BLUR_MS = 240
/** 牵引线经过分叉点后才开始绘制弧线，给主干留出先动的时间。 */
export const RECENT_CALLS_CURVE_DELAY_MS = Math.round(RECENT_CALLS_STEP_MS * 0.2)
/** 分支弧线的绘制/收回时长。 */
export const RECENT_CALLS_CURVE_MS = Math.round(RECENT_CALLS_STEP_MS * 0.55)
/** 内容等待牵引线到达/离开该行的额外偏移。 */
const RECENT_CALLS_CONTENT_OFFSET_MS =
  RECENT_CALLS_CURVE_DELAY_MS + RECENT_CALLS_CURVE_MS

export type RecentCallsSwapPhase = "steady" | "enter" | "exit"

/**
 * 牵引线逐行推进的起始延迟。
 * enter：从最顶端向下逐行延伸；exit：从末行向上逐行收展；steady：静止。
 */
export function recentCallsLeadDelay(
  order: number,
  count: number,
  phase: RecentCallsSwapPhase,
) {
  if (phase === "enter") return Math.max(0, order) * RECENT_CALLS_STEP_MS
  if (phase === "exit") return Math.max(0, count - 1 - order) * RECENT_CALLS_STEP_MS
  return 0
}

/** 工具内容在牵引线先到达/离开该行之后再开始模糊。 */
export function recentCallsContentDelay(
  order: number,
  count: number,
  phase: RecentCallsSwapPhase,
) {
  return recentCallsLeadDelay(order, count, phase) + RECENT_CALLS_CONTENT_OFFSET_MS
}

/** 一次会话切换动画的总时长：覆盖最后一行的内容动画。 */
export function recentCallsSwapDuration(count: number) {
  if (count <= 0) return 0
  return count * RECENT_CALLS_STEP_MS + RECENT_CALLS_BLUR_MS
}
