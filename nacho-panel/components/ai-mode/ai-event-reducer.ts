import type { AIChatEvent } from "../../lib/ai/chat-events"
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

/** 工具调用前最后一段正文，作为审批卡里的“需要你确认”说明。 */
function approvalAsk(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return ""
  const paragraphs = trimmed.split(/\n{2,}/)
  const last = paragraphs[paragraphs.length - 1].replace(/\s+/g, " ").trim()
  return last.slice(0, 400)
}

function findStepByApproval(steps: ToolStep[], approvalId: string) {
  return steps.find((step) => step.approvalId === approvalId)
}

export function applyAIEvent(message: AssistantMessage, event: AIChatEvent): AssistantMessage {
  if (message.done) return message
  const blocked = message.stopped === true || message.capReached === true
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
      if (blocked) return message
      const ask = approvalAsk(message.text)
      const waiting = message.steps.find((step) =>
        step.status === "waiting-confirm"
        && step.tool === event.step.tool
        && step.approvalId
        && step.id.startsWith("nacho:"))
      if (waiting && waiting.id !== event.step.id) {
        return {
          ...message,
          reasoningActive: false,
          steps: message.steps.map((step) =>
            step.id === waiting.id
              ? {
                  ...event.step,
                  approvalId: waiting.approvalId,
                  ...(waiting.ask || ask ? { ask: waiting.ask ?? ask } : {}),
                }
              : step),
        }
      }
      // opencode 可能先发权限请求、再补发同一步的 running 快照；不能让它覆盖等待确认。
      const current = message.steps.find((item) => item.id === event.step.id)
      const next = current?.status === "waiting-confirm" && current.approvalId && event.step.status === "running"
        ? {
            ...event.step,
            status: current.status,
            approvalId: current.approvalId,
            ...(current.ask || ask ? { ask: current.ask ?? ask } : {}),
          }
        : event.step
      const step = !next.ask && ask ? { ...next, ask } : next
      return { ...message, reasoningActive: false, steps: upsertStep(message.steps, step) }
    }
    case "step-update":
      if (blocked) return message
      {
        const current = message.steps.find((item) => item.id === event.id)
        const patch = current?.status === "waiting-confirm" && current.approvalId && event.patch.status === "running"
          ? { ...event.patch, status: current.status }
          : event.patch
        return { ...message, reasoningActive: false, steps: patchStep(message.steps, event.id, patch) }
      }
    case "approval": {
      if (blocked) return message
      const ask = approvalAsk(message.text)
      const existing = message.steps.find((step) => step.id === event.id)
        || [...message.steps].reverse().find((step) => step.tool === event.tool && step.status === "running")
      if (existing) {
        return {
          ...message,
          reasoningActive: false,
          steps: patchStep(message.steps, existing.id, {
            status: "waiting-confirm",
            approvalId: event.approvalId,
            detail: event.detail || existing.detail,
            danger: event.danger ?? existing.danger,
            risk: event.risk ?? existing.risk,
            ...(existing.ask || ask ? { ask: existing.ask ?? ask } : {}),
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
        ...(ask ? { ask } : {}),
      }
      return { ...message, reasoningActive: false, steps: [...message.steps, step] }
    }
    case "approval-resolved": {
      if (blocked) return message
      const step = findStepByApproval(message.steps, event.approvalId)
      if (!step) return message
      if (event.decision === "reject") {
        return { ...message, steps: patchStep(message.steps, step.id, { status: "error", output: "已拒绝执行" }) }
      }
      return { ...message, steps: patchStep(message.steps, step.id, { status: "running" }) }
    }
    case "timer": {
      const timer = event.timer
      if (timer.state === "wake-failed") {
        const note = timer.error || "计时器到期，但 AI 引擎仍忙碌。"
        return {
          ...message,
          timer,
          stopped: true,
          reasoningActive: false,
          text: message.text ? `${message.text}\n\n${note}` : note,
          steps: message.steps.map((step) => step.status === "running" || step.status === "waiting-confirm"
            ? { ...step, status: "error" as const, output: step.output || "计时器到期，执行已停止" }
            : step),
        }
      }
      return { ...message, timer }
    }
    case "safety-cap": {
      return {
        ...message,
        capReached: true,
        stopped: true,
        reasoningActive: false,
        text: message.text || event.message,
        steps: message.steps.map((step) => step.status === "running" || step.status === "waiting-confirm"
          ? { ...step, status: "error" as const, output: step.output || "已达到 2 小时安全上限，执行已停止" }
          : step),
      }
    }
    case "done": {
      if (message.done) return message
      return {
        ...message,
        done: true,
        reasoningActive: false,
        steps: message.steps.map((step) => step.status === "waiting-confirm"
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

export function finalizeAssistantMessage(message: AssistantMessage, reason: string, stopped = false): AssistantMessage {
  if (message.done) return message
  return {
    ...message,
    done: true,
    reasoningActive: false,
    ...(stopped || message.stopped ? { stopped: true } : {}),
    text: message.text || reason,
    steps: message.steps.map((step) => step.status === "waiting-confirm" || step.status === "running"
      ? { ...step, status: "error" as const, output: step.output || reason }
      : step),
  }
}

/** 从磁盘恢复会话：结束上次进程中断的回合，并将未完成的工具步骤标记为中断。 */
export function restoreChatSessions(sessions: Session[]): Session[] {
  return sessions.map((session) => ({
    ...session,
    messages: session.messages.map((message) => {
      if (message.role !== "assistant") return message
      if (message.done) {
        return message.reasoningActive ? { ...message, reasoningActive: false } : message
      }
      return finalizeAssistantMessage({ ...message, reasoningActive: false }, "上次会话已中断", true)
    }),
  }))
}
