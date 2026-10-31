import type { AIChatStepSource } from "./chat-events"
import type { ToolStep } from "./chat-history"

export type ToolStepGroup = {
  source: AIChatStepSource
  steps: ToolStep[]
}

/** 按工具来源分组，顺序取首次出现顺序；组内保持原始调用顺序。 */
export function groupToolSteps(steps: ToolStep[]): ToolStepGroup[] {
  const groups: ToolStepGroup[] = []
  const index = new Map<AIChatStepSource, number>()
  for (const step of steps) {
    let position = index.get(step.source)
    if (position === undefined) {
      position = groups.length
      index.set(step.source, position)
      groups.push({ source: step.source, steps: [] })
    }
    groups[position].steps.push(step)
  }
  return groups
}

/** 第一个等待人工确认的步骤；没有则返回 null。 */
export function firstWaitingStepId(steps: ToolStep[]): string | null {
  return steps.find((step) => step.status === "waiting-confirm")?.id ?? null
}
