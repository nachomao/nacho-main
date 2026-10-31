import type { AIChatEvent, AIChatStep } from "./chat-events"
import type { OpenCodeEvent } from "./event-hub"
import { redactSecrets, truncateMiddle } from "./redact"
import { isTimerCancelTool, isTimerTool, normalizeTimerSeconds } from "./task-timer"
import { toolDanger, toolRisk, toolSource } from "./tool-meta"

type ToolState = {
  status?: string
  input?: Record<string, unknown>
  output?: unknown
  title?: string
  metadata?: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}

export function isSessionIdleEvent(event: OpenCodeEvent): boolean {
  if (event.type === "session.idle") return true
  if (event.type !== "session.status") return false
  const properties = event.properties || {}
  const status = asRecord(properties.status)
  return status.type === "idle" || properties.type === "idle"
}

export function isUserMessageEvent(event: OpenCodeEvent): boolean {
  if (event.type !== "message.updated") return false
  return asRecord(event.properties?.info).role === "user"
}

function toolStatus(value: unknown): "running" | "done" | "error" {
  if (value === "completed") return "done"
  if (value === "error") return "error"
  return "running"
}

function describeTool(tool: string, input: Record<string, unknown>, title?: string) {
  const command = input.command
  if (typeof command === "string" && command.trim()) return redactSecrets(command).slice(0, 200)
  for (const key of ["filePath", "file_path", "path", "pattern", "url", "serviceName", "processId"]) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) return `${key}=${redactSecrets(value)}`.slice(0, 200)
    if (typeof value === "number") return `${key}=${value}`
  }
  if (title?.trim()) return redactSecrets(title).slice(0, 200)
  const json = JSON.stringify(input)
  return json && json !== "{}" ? redactSecrets(json).slice(0, 200) : tool
}

function mapError(error: unknown) {
  const record = asRecord(error)
  const name = typeof record.name === "string" ? record.name : ""
  const data = asRecord(record.data)
  const raw = typeof data.message === "string" ? data.message : ""
  const message = redactSecrets(raw).slice(0, 500)
  if (name === "ProviderAuthError") return `模型服务鉴权失败${message ? `：${message}` : ""}`
  if (name === "MessageOutputLengthError") return "模型输出超过长度限制"
  if (name === "MessageAbortedError") return "AI 回复已中止"
  if (message) return message
  return name ? `AI 请求失败（${name}）` : "AI 请求失败"
}

type PartKind = "text" | "reasoning" | "other"

type PartState = {
  kind: PartKind
  text: string
  done: boolean
}

export class SessionEventMapper {
  private userIds = new Set<string>()
  private parts = new Map<string, PartState>()
  private partByCall = new Map<string, string>()
  private seenSteps = new Set<string>()
  private lastStepPatch = new Map<string, string>()
  private timerCalls = new Map<string, string>()
  private idle = false

  /** 同一会话内开始新一轮提醒时复用 mapper，但清空上一轮的分片与步骤状态。 */
  resetTurn() {
    this.parts.clear()
    this.partByCall.clear()
    this.seenSteps.clear()
    this.lastStepPatch.clear()
    this.idle = false
  }

  private isUserPart(messageID: string) {
    return this.userIds.has(messageID)
  }

  private partState(partID: string, kind: PartKind): PartState {
    const existing = this.parts.get(partID)
    if (existing) {
      existing.kind = kind
      return existing
    }
    const created: PartState = { kind, text: "", done: false }
    this.parts.set(partID, created)
    return created
  }

  map(event: OpenCodeEvent): AIChatEvent[] {
    const properties = event.properties || {}
    if (event.type === "message.updated") {
      const info = asRecord(properties.info)
      if (info.role === "user" && typeof info.id === "string") this.userIds.add(info.id)
      return []
    }
    if (event.type === "message.part.delta") {
      if (properties.field !== "text" || typeof properties.delta !== "string" || !properties.delta) return []
      const messageID = typeof properties.messageID === "string" ? properties.messageID : ""
      if (this.isUserPart(messageID)) return []
      const partID = typeof properties.partID === "string" ? properties.partID : ""
      if (!partID) return []
      const state = this.parts.get(partID)
      // 未知 part 的增量直接丢弃：reasoning 绝不能泄漏进正文。
      if (!state || state.kind === "other") return []
      state.text += properties.delta
      return state.kind === "reasoning"
        ? [{ type: "reasoning", delta: properties.delta }]
        : [{ type: "text", delta: properties.delta }]
    }
    if (event.type === "message.part.updated") {
      const part = asRecord(properties.part)
      const type = part.type
      const partID = typeof part.id === "string" ? part.id : ""
      const messageID = typeof part.messageID === "string" ? part.messageID : ""
      if (!partID) {
        return type === "tool" ? this.mapToolPart(part) : []
      }
      if (type === "text" || type === "reasoning") {
        if (this.isUserPart(messageID)) return []
        const state = this.partState(partID, type)
        const text = typeof part.text === "string" ? part.text : ""
        const events: AIChatEvent[] = []
        // 空文本快照也要先登记 part 类型（text-start / reasoning-start），后续 delta 才能正确分流。
        if (text && text.startsWith(state.text) && text.length > state.text.length) {
          const delta = text.slice(state.text.length)
          state.text = text
          events.push(type === "reasoning" ? { type: "reasoning", delta } : { type: "text", delta })
        }
        if (type === "reasoning") {
          const time = asRecord(part.time)
          if (typeof time.end === "number" && !state.done) {
            state.done = true
            events.push({ type: "reasoning-done" })
          }
        }
        return events
      }
      this.partState(partID, "other")
      if (type === "tool") {
        return this.mapToolPart(part)
      }
      return []
    }
    if (event.type === "permission.asked") {
      const id = typeof properties.id === "string" ? properties.id : ""
      const tool = typeof properties.permission === "string" ? properties.permission : "unknown"
      const callID = typeof asRecord(properties.tool).callID === "string" ? asRecord(properties.tool).callID as string : ""
      const partId = (callID && this.partByCall.get(callID)) || `perm:${id}`
      const patterns = Array.isArray(properties.patterns) ? properties.patterns.filter((item): item is string => typeof item === "string") : []
      const metadata = asRecord(properties.metadata)
      const detail = describeTool(tool, metadata, patterns[0])
      return [{
        type: "approval",
        id: partId,
        approvalId: `oc:${id}`,
        tool,
        detail,
        danger: toolDanger(tool),
        risk: toolRisk(tool),
        expiresAt: Date.now() + 300_000,
      }]
    }
    if (event.type === "permission.replied") {
      const requestID = typeof properties.requestID === "string" ? properties.requestID : ""
      const reply = properties.reply
      if (!requestID || (reply !== "once" && reply !== "always" && reply !== "reject")) return []
      return [{ type: "approval-resolved", approvalId: `oc:${requestID}`, decision: reply }]
    }
    if (event.type === "session.error") {
      return [{ type: "error", message: mapError(properties.error) }]
    }
    if (isSessionIdleEvent(event)) {
      if (this.idle) return []
      this.idle = true
      return [{ type: "done" }]
    }
    return []
  }

  private mapTimerPart(id: string, part: Record<string, unknown>): AIChatEvent[] {
    const state = asRecord(part.state)
    const input = asRecord(state.input)
    const seconds = normalizeTimerSeconds(input.afterSeconds)
    if (seconds === null) return []
    const reminder = typeof input.reminder === "string" ? redactSecrets(input.reminder).trim().slice(0, 500) : ""
    if (!reminder) return []
    const label = typeof input.label === "string" ? redactSecrets(input.label).trim().slice(0, 80) : ""
    const onExpire = input.onExpire === "interrupt" ? "interrupt" : "wait"
    const signature = JSON.stringify({ seconds, reminder, label, onExpire })
    if (this.timerCalls.get(id) === signature) return []
    this.timerCalls.set(id, signature)
    return [{
      type: "timer-set",
      afterSeconds: seconds,
      reminder,
      ...(label ? { label } : {}),
      onExpire,
    }]
  }

  private mapTimerCancelPart(id: string, part: Record<string, unknown>): AIChatEvent[] {
    const state = asRecord(part.state)
    const input = asRecord(state.input)
    const reason = typeof input.reason === "string" ? redactSecrets(input.reason).trim().slice(0, 200) : ""
    const signature = JSON.stringify({ reason })
    if (this.timerCalls.get(id) === signature) return []
    this.timerCalls.set(id, signature)
    return [{ type: "timer-cancel", ...(reason ? { reason } : {}) }]
  }

  private mapToolPart(part: Record<string, unknown>): AIChatEvent[] {
    const id = typeof part.id === "string" ? part.id : ""
    const tool = typeof part.tool === "string" ? part.tool : "tool"
    const callID = typeof part.callID === "string" ? part.callID : ""
    if (!id) return []
    if (isTimerTool(tool)) return this.mapTimerPart(id, part)
    if (isTimerCancelTool(tool)) return this.mapTimerCancelPart(id, part)
    if (callID) this.partByCall.set(callID, id)
    const state = asRecord(part.state) as ToolState
    const input = asRecord(state.input)
    const status = toolStatus(state.status)
    const detail = describeTool(tool, input, typeof state.title === "string" ? state.title : undefined)
    const output = typeof state.output === "string" && state.output
      ? truncateMiddle(redactSecrets(state.output), 2_048).text
      : undefined
    const danger = toolDanger(tool)
    const risk = toolRisk(tool)
    if (!this.seenSteps.has(id)) {
      this.seenSteps.add(id)
      const step: AIChatStep = {
        id,
        source: toolSource(tool),
        tool,
        detail,
        status,
        ...(output ? { output } : {}),
        ...(danger ? { danger: true } : {}),
        ...(risk ? { risk } : {}),
      }
      this.lastStepPatch.set(id, JSON.stringify({ status, detail, output }))
      return [{ type: "step", step }]
    }
    const patch = {
      status,
      detail,
      ...(output ? { output } : {}),
    }
    const signature = JSON.stringify({ status, detail, output })
    if (this.lastStepPatch.get(id) === signature) return []
    this.lastStepPatch.set(id, signature)
    return [{ type: "step-update", id, patch }]
  }
}
