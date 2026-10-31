/* AI Mode 会话历史：客户端与服务端共用的类型、限额与归一化。
 * 本文件不得引入 node: 内置模块，面板浏览器端与 Next 服务端都会引用。 */

import type { AIChatStepSource } from "./chat-events"
import { isAIImageMime, type AIImageMime } from "./chat-attachments"

export const MAX_AI_CHAT_HISTORY_BYTES = 8 * 1024 * 1024
export const MAX_AI_CHAT_HISTORY_SESSIONS = 100
export const MAX_AI_CHAT_HISTORY_MESSAGES = 400
export const MAX_AI_CHAT_HISTORY_TEXT_CHARS = 200_000
export const MAX_AI_CHAT_HISTORY_STEPS = 100
export const MAX_AI_CHAT_HISTORY_OUTPUT_CHARS = 8_000
export const MAX_AI_CHAT_HISTORY_DETAIL_CHARS = 2_000
export const MAX_AI_CHAT_HISTORY_TITLE_CHARS = 200
export const MAX_AI_CHAT_HISTORY_ID_CHARS = 160
export const MAX_AI_CHAT_HISTORY_ATTACHMENTS = 3
export const MAX_AI_CHAT_HISTORY_ATTACHMENT_NAME_CHARS = 128

export type StepStatus = "running" | "done" | "error" | "waiting-confirm"

/** 历史消息中的附件视图：重启后不再携带图片正文。 */
export type MessageAttachment = {
  name: string
  mime: AIImageMime
  dataUrl?: string
}

export type ToolStep = {
  id: string
  /** 工具来源：skill / mcp / plugin / core */
  source: AIChatStepSource
  tool: string
  detail: string
  output?: string
  status: StepStatus
  danger?: boolean
  risk?: "warn" | "danger"
  approvalId?: string
}

export type Message =
  | { id: string; role: "user"; text: string; attachments?: MessageAttachment[] }
  | {
      id: string
      role: "assistant"
      text: string
      steps: ToolStep[]
      done: boolean
      reasoning?: string
      reasoningActive?: boolean
    }

export type Session = { id: string; title: string; createdAt: number; messages: Message[] }

export type PersistedChatHistory = {
  version: 1
  activeId: string
  sessions: Session[]
  savedAt?: number
}

export function emptyAIChatHistory(): PersistedChatHistory {
  return { version: 1, activeId: "", sessions: [] }
}

export function createChatSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `s-${crypto.randomUUID()}`
  }
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const ID_PATTERN = /^[A-Za-z0-9_:-]{1,160}$/
const SOURCES: AIChatStepSource[] = ["skill", "mcp", "plugin", "core"]
const STEP_STATUSES: StepStatus[] = ["running", "done", "error", "waiting-confirm"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_AI_CHAT_HISTORY_ID_CHARS || !ID_PATTERN.test(trimmed)) return null
  return trimmed
}

function normalizeText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return ""
  return value.length > maximum ? value.slice(0, maximum) : value
}

function normalizeOptionalText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string" || !value) return undefined
  return value.length > maximum ? value.slice(0, maximum) : value
}

function normalizeAttachment(value: unknown): MessageAttachment | null {
  if (!isRecord(value)) return null
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (
    !name
    || name.length > MAX_AI_CHAT_HISTORY_ATTACHMENT_NAME_CHARS
    || /[\u0000-\u001f\u007f/\\]/.test(name)
  ) {
    return null
  }
  const mime = typeof value.mime === "string" && isAIImageMime(value.mime) ? value.mime : null
  if (!mime) return null
  const dataUrl = typeof value.dataUrl === "string" && value.dataUrl.startsWith("data:image/")
    ? value.dataUrl
    : undefined
  return { name, mime, ...(dataUrl ? { dataUrl } : {}) }
}

function normalizeToolStep(value: unknown): ToolStep | null {
  if (!isRecord(value)) return null
  const id = normalizeId(value.id)
  if (!id) return null
  const source = SOURCES.includes(value.source as AIChatStepSource)
    ? value.source as AIChatStepSource
    : null
  const status = STEP_STATUSES.includes(value.status as StepStatus)
    ? value.status as StepStatus
    : null
  if (!source || !status) return null
  const tool = typeof value.tool === "string" ? value.tool.trim() : ""
  if (!tool || tool.length > 128) return null
  const detail = normalizeText(value.detail, MAX_AI_CHAT_HISTORY_DETAIL_CHARS)
  const output = normalizeOptionalText(value.output, MAX_AI_CHAT_HISTORY_OUTPUT_CHARS)
  const risk = value.risk === "warn" || value.risk === "danger" ? value.risk : undefined
  const approvalId = normalizeOptionalText(value.approvalId, MAX_AI_CHAT_HISTORY_ID_CHARS)
  return {
    id,
    source,
    tool,
    detail,
    status,
    ...(output ? { output } : {}),
    ...(value.danger === true ? { danger: true } : {}),
    ...(risk ? { risk } : {}),
    ...(approvalId ? { approvalId } : {}),
  }
}

function normalizeMessage(value: unknown): Message | null {
  if (!isRecord(value)) return null
  const id = normalizeId(value.id)
  if (!id) return null
  if (value.role === "user") {
    const text = normalizeText(value.text, MAX_AI_CHAT_HISTORY_TEXT_CHARS)
    const attachments = Array.isArray(value.attachments)
      ? value.attachments
        .slice(0, MAX_AI_CHAT_HISTORY_ATTACHMENTS)
        .map(normalizeAttachment)
        .filter((item): item is MessageAttachment => Boolean(item))
      : []
    if (!text && attachments.length === 0) return null
    return { id, role: "user", text, ...(attachments.length ? { attachments } : {}) }
  }
  if (value.role === "assistant") {
    const steps = Array.isArray(value.steps)
      ? value.steps
        .slice(0, MAX_AI_CHAT_HISTORY_STEPS)
        .map(normalizeToolStep)
        .filter((item): item is ToolStep => Boolean(item))
      : []
    const reasoning = normalizeOptionalText(value.reasoning, MAX_AI_CHAT_HISTORY_TEXT_CHARS)
    return {
      id,
      role: "assistant",
      text: normalizeText(value.text, MAX_AI_CHAT_HISTORY_TEXT_CHARS),
      steps,
      done: value.done === true,
      ...(reasoning ? { reasoning } : {}),
      reasoningActive: value.reasoningActive === true,
    }
  }
  return null
}

function normalizeSession(value: unknown): Session | null {
  if (!isRecord(value)) return null
  const id = normalizeId(value.id)
  if (!id) return null
  const title = typeof value.title === "string" && value.title.trim()
    ? value.title.trim().slice(0, MAX_AI_CHAT_HISTORY_TITLE_CHARS)
    : "新会话"
  const createdAt = typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
    ? value.createdAt
    : Date.now()
  const messages = Array.isArray(value.messages)
    ? value.messages
      .slice(-MAX_AI_CHAT_HISTORY_MESSAGES)
      .map(normalizeMessage)
      .filter((item): item is Message => Boolean(item))
    : []
  return { id, title, createdAt, messages }
}

/**
 * 归一化历史快照：
 * - 根结构非法时返回 null（调用方视为损坏）；
 * - 单条会话/消息非法时丢弃该条，尽量保留其余历史；
 * - activeId 失效时回退到第一条会话。
 */
export function normalizePersistedChatHistory(value: unknown): PersistedChatHistory | null {
  if (!isRecord(value)) return null
  if (value.version !== undefined && value.version !== 1) return null
  if (!Array.isArray(value.sessions)) return null
  const sessions: Session[] = []
  const seen = new Set<string>()
  for (const raw of value.sessions.slice(0, MAX_AI_CHAT_HISTORY_SESSIONS)) {
    const session = normalizeSession(raw)
    if (!session || seen.has(session.id)) continue
    seen.add(session.id)
    sessions.push(session)
  }
  const requestedActive = typeof value.activeId === "string" ? value.activeId : ""
  const activeId = sessions.some((session) => session.id === requestedActive)
    ? requestedActive
    : sessions[0]?.id ?? ""
  const savedAt = typeof value.savedAt === "number" && Number.isFinite(value.savedAt)
    ? value.savedAt
    : undefined
  return {
    version: 1,
    activeId,
    sessions,
    ...(savedAt ? { savedAt } : {}),
  }
}

function copyMessageForPersistence(message: Message): Message {
  if (message.role === "user") {
    return {
      id: message.id,
      role: "user",
      text: message.text,
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((attachment) => ({
              name: attachment.name,
              mime: attachment.mime,
            })),
          }
        : {}),
    }
  }
  return {
    id: message.id,
    role: "assistant",
    text: message.text,
    steps: message.steps,
    done: message.done,
    ...(message.reasoning ? { reasoning: message.reasoning } : {}),
    reasoningActive: false,
  }
}

function copySessionForPersistence(session: Session): Session {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    messages: session.messages.slice(-MAX_AI_CHAT_HISTORY_MESSAGES).map(copyMessageForPersistence),
  }
}

/**
 * 生成可落盘的快照：
 * - 图片正文（dataUrl）不落盘，保留文件名与 MIME；
 * - reasoningActive 不跨进程保留；
 * - 保留最近 100 个会话（active 会话必保留）与每个会话最近 400 条消息。
 */
export function toPersistedChatHistory(sessions: Session[], activeId: string): PersistedChatHistory {
  const prepared = sessions.slice(0, MAX_AI_CHAT_HISTORY_SESSIONS).map(copySessionForPersistence)

  if (activeId && !prepared.some((session) => session.id === activeId)) {
    const active = sessions.find((session) => session.id === activeId)
    if (active) {
      if (prepared.length >= MAX_AI_CHAT_HISTORY_SESSIONS) prepared.pop()
      prepared.push(copySessionForPersistence(active))
    }
  }

  return normalizePersistedChatHistory({ version: 1, activeId, sessions: prepared }) ?? emptyAIChatHistory()
}

export function chatHistoryByteSize(history: PersistedChatHistory): number {
  return new TextEncoder().encode(JSON.stringify(history)).length
}
