import type { AIChatEvent } from "../../lib/ai/chat-events"
import { splitLeadingPlanning } from "../../lib/ai/answer-separation"
import { MAX_AI_CHAT_HISTORY_TEXT_CHARS } from "../../lib/ai/chat-history"
import { toolSource } from "../../lib/ai/tool-meta"
import type { Message, Session, ToolStep } from "./ai-types"

type AssistantMessage = Extract<Message, { role: "assistant" }>

function upsertStep(steps: ToolStep[], step: ToolStep) {
  const index = steps.findIndex((item) => item.id === step.id)
  if (index < 0) return [...steps, step]
  const next = [...steps]
  next[index] = { ...next[index], ...step }
  return next
}

function patchStep(steps: ToolStep[], id: string, patch: Partial<ToolStep>) {
  return steps.map((step) => (step.id === id ? { ...step, ...patch } : step))
}

function findStepByApproval(steps: ToolStep[], approvalId: string) {
  return steps.find((step) => step.approvalId === approvalId)
}

/**
 * provider 常把“我准备查一下…”这类计划写成普通 text，而不是 reasoning part。
 * opencode 的 agent 步骤中，一旦出现工具调用，此前产出的 text 属于计划而非最终回答；
 * 在工具边界把它移入 reasoning，回答气泡只保留工具结束后的正文。
 */
function moveTextToReasoning(message: AssistantMessage): AssistantMessage {
  if (!message.text.trim()) return message
  const merged = message.reasoning
    ? `${message.reasoning}${message.reasoning.endsWith("\n") ? "" : "\n\n"}${message.text}`
    : message.text
  return {
    ...message,
    text: "",
    reasoning: merged.slice(0, MAX_AI_CHAT_HISTORY_TEXT_CHARS),
    reasoningActive: false,
  }
}

/** Agent 回合结束时，把最终正文里前置的英文计划/复盘移入 reasoning。 */
function separatePlanningFromAnswer(message: AssistantMessage): AssistantMessage {
  if (!message.steps.length) return message
  const split = splitLeadingPlanning(message.text)
  if (!split) return message
  const merged = message.reasoning
    ? `${message.reasoning}${message.reasoning.endsWith("\n") ? "" : "\n\n"}${split.reasoning}`
    : split.reasoning
  return {
    ...message,
    text: split.answer,
    reasoning: merged.slice(0, MAX_AI_CHAT_HISTORY_TEXT_CHARS),
    reasoningActive: false,
  }
}

export function applyAIEvent(message: AssistantMessage, event: AIChatEvent): AssistantMessage {
  switch (event.type) {
    case "text":
      return { ...message, text: message.text + event.delta, reasoningActive: false }
    case "reasoning": {
      const next = (message.reasoning ?? "") + event.delta
      return {
        ...message,
        reasoning: next.length > MAX_AI_CHAT_HISTORY_TEXT_CHARS
          ? next.slice(0, MAX_AI_CHAT_HISTORY_TEXT_CHARS)
          : next,
        reasoningActive: true,
      }
    }
    case "reasoning-done":
      return { ...message, reasoningActive: false }
    case "step": {
      const base = moveTextToReasoning(message)
      const waiting = base.steps.find((step) =>
        step.status === "waiting-confirm"
        && step.tool === event.step.tool
        && step.approvalId
        && step.id.startsWith("nacho:"))
      if (waiting && waiting.id !== event.step.id) {
        return {
          ...base,
          reasoningActive: false,
          steps: base.steps.map((step) =>
            step.id === waiting.id ? { ...event.step, approvalId: waiting.approvalId } : step),
        }
      }
      return { ...base, reasoningActive: false, steps: upsertStep(base.steps, { ...event.step }) }
    }
    case "step-update":
      return { ...message, reasoningActive: false, steps: patchStep(message.steps, event.id, event.patch) }
    case "approval": {
      const base = moveTextToReasoning(message)
      const existing = base.steps.find((step) => step.id === event.id)
        || [...base.steps].reverse().find((step) => step.tool === event.tool && step.status === "running")
      if (existing) {
        return {
          ...base,
          reasoningActive: false,
          steps: patchStep(base.steps, existing.id, {
            status: "waiting-confirm",
            approvalId: event.approvalId,
            detail: event.detail || existing.detail,
            danger: event.danger ?? existing.danger,
            risk: event.risk ?? existing.risk,
          }),
        }
      }
      const step: ToolStep = {
        id: event.id,
        source: toolSource(event.tool),
        tool: event.tool,
        detail: event.detail,
        status: "waiting-confirm",
        approvalId: event.approvalId,
        danger: event.danger,
        risk: event.risk,
      }
      return { ...base, reasoningActive: false, steps: [...base.steps, step] }
    }
    case "approval-resolved": {
      const step = findStepByApproval(message.steps, event.approvalId)
      if (!step) return message
      if (event.decision === "reject") {
        return { ...message, steps: patchStep(message.steps, step.id, { status: "error", output: "已拒绝执行" }) }
      }
      return { ...message, steps: patchStep(message.steps, step.id, { status: "running" }) }
    }
    case "done": {
      if (message.done) return message
      const base = separatePlanningFromAnswer(message)
      return {
        ...base,
        done: true,
        reasoningActive: false,
        steps: base.steps.map((step) => step.status === "waiting-confirm"
          ? { ...step, status: "error" as const, output: "会话已结束，操作未执行" }
          : step.status === "running"
            ? { ...step, status: "error" as const, output: step.output || "未返回结果" }
            : step),
      }
    }
    case "error": {
      const text = message.text ? `${message.text}\n\n请求失败：${event.message}` : `请求失败：${event.message}`
      return {
        ...message,
        text,
        done: true,
        reasoningActive: false,
        steps: message.steps.map((step) => step.status === "waiting-confirm" || step.status === "running"
          ? { ...step, status: "error" as const, output: step.output || "请求失败" }
          : step),
      }
    }
    default:
      return message
  }
}

export function finalizeAssistantMessage(message: AssistantMessage, reason: string): AssistantMessage {
  if (message.done) return message
  const finalized: AssistantMessage = {
    ...message,
    done: true,
    reasoningActive: false,
    text: message.text || reason,
    steps: message.steps.map((step) => step.status === "waiting-confirm" || step.status === "running"
      ? { ...step, status: "error" as const, output: step.output || reason }
      : step),
  }
  return separatePlanningFromAnswer(finalized)
}

/** 从磁盘恢复会话：结束上次进程中断的回合，并将未完成的工具步骤标记为中断。 */
export function restoreChatSessions(sessions: Session[]): Session[] {
  return sessions.map((session) => ({
    ...session,
    messages: session.messages.map((message) => {
      if (message.role !== "assistant") return message
      if (message.done) {
        return separatePlanningFromAnswer(
          message.reasoningActive ? { ...message, reasoningActive: false } : message,
        )
      }
      return finalizeAssistantMessage({ ...message, reasoningActive: false }, "上次会话已中断")
    }),
  }))
}
