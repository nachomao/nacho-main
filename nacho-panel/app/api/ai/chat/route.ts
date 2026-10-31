import type { NextRequest } from "next/server"
import { resolveAIModel } from "@/lib/ai/config-shared"
import { AIHttpError, aiError, readJsonBody, requireDesktop, requireJsonRequest, requireSameOrigin } from "@/lib/ai/http"
import { buildSystemPrompt } from "@/lib/ai/system-prompt"
import { ensureEventHub, subscribeEvents, waitForEventHub } from "@/lib/ai/event-hub"
import { SessionEventMapper } from "@/lib/ai/event-map"
import { denyAllPending } from "@/lib/ai/approvals"
import { subscribeApprovals } from "@/lib/ai/approval-bus"
import {
  ensureChatSession,
  getActiveChat,
  setActiveChat,
  type ChatConnection,
  type ChatMode,
} from "@/lib/ai/chat-sessions"
import {
  createOpencodeClient,
  OpenCodeError,
  type OpenCodePromptBody,
  type OpenCodePromptPart,
} from "@/lib/ai/opencode-client"
import { AIRuntimeError, ensureRuntime } from "@/lib/ai/runtime"
import { getAISettingsStore } from "@/lib/ai/settings-store"
import { runtimeModelIds } from "@/lib/ai/settings-schema"
import {
  AIChatAttachmentError,
  MAX_AI_CHAT_REQUEST_LENGTH,
  validateAIChatAttachments,
  type AIChatAttachment,
} from "@/lib/ai/chat-attachments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_CHAT_TEXT_BYTES = 16 * 1024
const STREAM_IDLE_MS = 600_000

type ParsedChat = {
  uiSessionId: string
  text: string
  attachments: AIChatAttachment[]
  model: string
  mode: ChatMode
  connection: ChatConnection
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseChatBody(value: unknown): ParsedChat {
  if (!isRecord(value)) throw new AIHttpError("请求体必须是对象", 400, "invalid-request")
  const uiSessionId = value.uiSessionId
  if (typeof uiSessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(uiSessionId)) {
    throw new AIHttpError("会话标识无效", 400, "invalid-session")
  }
  const text = typeof value.text === "string" ? value.text.trim() : ""
  if (Buffer.byteLength(text, "utf8") > MAX_CHAT_TEXT_BYTES) {
    throw new AIHttpError("消息过长", 413, "message-too-large")
  }
  let attachments: AIChatAttachment[]
  try {
    attachments = validateAIChatAttachments(value.attachments)
  } catch (error) {
    if (error instanceof AIChatAttachmentError) {
      throw new AIHttpError(
        error.message,
        error.code === "attachment-too-large" ? 413 : 400,
        error.code,
      )
    }
    throw error
  }
  if (!text && attachments.length === 0) throw new AIHttpError("消息不能为空", 400, "empty-message")
  const model = typeof value.model === "string" ? value.model.trim() : ""
  if (!model || model.length > 128) throw new AIHttpError("模型标识无效", 400, "invalid-model")
  if (value.mode !== "agent" && value.mode !== "chat") {
    throw new AIHttpError("模式无效", 400, "invalid-mode")
  }
  if (!isRecord(value.connection)) throw new AIHttpError("缺少服务端连接", 400, "missing-connection")
  const baseUrl = typeof value.connection.baseUrl === "string" ? value.connection.baseUrl.trim() : ""
  const key = typeof value.connection.key === "string" ? value.connection.key : ""
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new AIHttpError("服务端地址无效", 400, "invalid-connection")
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
    throw new AIHttpError("服务端地址无效", 400, "invalid-connection")
  }
  if (!key || key.length > 4096 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new AIHttpError("服务端 API Key 无效", 400, "invalid-connection")
  }
  return {
    uiSessionId,
    text,
    attachments,
    model,
    mode: value.mode,
    connection: { baseUrl: baseUrl.replace(/\/+$/, ""), key },
  }
}

function runtimeError(error: unknown) {
  if (error instanceof AIRuntimeError) {
    const status = error.code === "not-configured"
      ? 400
      : error.code === "not-installed"
        ? 503
        : error.code === "desktop-only"
          ? 501
          : 500
    return aiError(error.message, status, error.code)
  }
  return aiError("AI 引擎启动失败", 500, "runtime-failed")
}

export async function POST(request: NextRequest) {
  const invalid = requireSameOrigin(request) ?? requireDesktop() ?? requireJsonRequest(request, MAX_AI_CHAT_REQUEST_LENGTH)
  if (invalid) return invalid

  let parsed: ParsedChat
  try {
    parsed = parseChatBody(await readJsonBody(request, MAX_AI_CHAT_REQUEST_LENGTH))
  } catch (error) {
    if (error instanceof AIHttpError) return aiError(error.message, error.status, error.code)
    return aiError("请求体无效", 400, "invalid-request")
  }

  const settingsSnapshot = await getAISettingsStore().read()
  const settings = settingsSnapshot.config
  if (!settings.enabled) return aiError("AI Mode 已在设置中停用", 400, "disabled")
  if (!settings.baseUrl || !settings.apiKey) return aiError("请先配置 API 地址与 API Key", 400, "not-configured")

  const allowedModels = new Set(runtimeModelIds(settings))
  const model = allowedModels.has(parsed.model) ? parsed.model : resolveAIModel(settings)
  if (!model) return aiError("请先选择模型", 400, "not-configured")

  let runtimeHandle
  try {
    runtimeHandle = await ensureRuntime()
  } catch (error) {
    return runtimeError(error)
  }
  ensureEventHub(runtimeHandle)
  if (!await waitForEventHub(5_000)) {
    return aiError("AI 引擎事件通道未就绪，请稍后重试", 503, "event-stream")
  }
  const client = createOpencodeClient(runtimeHandle)

  let session
  try {
    session = await ensureChatSession(client, {
      uiSessionId: parsed.uiSessionId,
      connection: parsed.connection,
      model,
      mode: parsed.mode,
      confirmDanger: settings.confirmDanger,
    })
  } catch (error) {
    const message = error instanceof OpenCodeError ? error.message : "创建 AI 会话失败"
    return aiError(message, 502, "session-failed")
  }
  setActiveChat(session)

  const system = buildSystemPrompt(settings, parsed.mode)
  const encoder = new TextEncoder()
  let cleanup: (() => void) | null = null
  let cancelled = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let finished = false
      let closed = false
      let ping: NodeJS.Timeout | null = null
      let idle: NodeJS.Timeout | null = null
      let unsubscribeEvents: (() => void) | null = null
      let unsubscribeApprovals: (() => void) | null = null

      const send = (event: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          closed = true
        }
      }
      const finish = () => {
        if (finished) return
        finished = true
        closed = true
        if (ping) clearInterval(ping)
        if (idle) clearTimeout(idle)
        unsubscribeEvents?.()
        unsubscribeApprovals?.()
        request.signal.removeEventListener("abort", abortChat)
        if (getActiveChat()?.uiSessionId === session.uiSessionId) setActiveChat(null)
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
      const abortChat = () => {
        if (finished) return
        void client.abortSession(session.opencodeSessionId).catch(() => undefined)
        denyAllPending(session.uiSessionId)
        finish()
      }
      cleanup = abortChat
      if (cancelled) {
        finish()
        return
      }
      request.signal.addEventListener("abort", abortChat)
      const resetIdle = () => {
        if (idle) clearTimeout(idle)
        idle = setTimeout(() => {
          void client.abortSession(session.opencodeSessionId).catch(() => undefined)
          denyAllPending(session.uiSessionId)
          send({ type: "error", message: "AI 响应超时，请重试", code: "idle-timeout" })
          finish()
        }, STREAM_IDLE_MS)
      }
      const mapper = new SessionEventMapper()
      unsubscribeEvents = subscribeEvents(session.opencodeSessionId, (event) => {
        resetIdle()
        for (const mapped of mapper.map(event)) {
          send(mapped)
          if (mapped.type === "done" || mapped.type === "error") {
            finish()
            return
          }
        }
      })
      unsubscribeApprovals = subscribeApprovals(session.uiSessionId, (event) => {
        resetIdle()
        send(event)
      })
      ping = setInterval(() => send({ type: "ping" }), 15_000)
      resetIdle()
      send({ type: "ready" })

      const parts: OpenCodePromptPart[] = [
        { type: "text", text: parsed.text || "请查看并分析所附图片。" },
        ...parsed.attachments.map((attachment) => ({
          type: "file" as const,
          mime: attachment.mime,
          url: attachment.dataUrl,
          filename: attachment.name,
        })),
      ]
      const prompt: OpenCodePromptBody = {
        parts,
        model: { providerID: "nacho", modelID: model },
        system,
        ...(parsed.mode === "chat" ? { tools: { "*": false } } : {}),
      }
      void client.promptAsync(session.opencodeSessionId, prompt)
        .catch((error: unknown) => {
          if (finished) return
          const message = error instanceof OpenCodeError ? error.message : "AI 请求失败"
          send({ type: "error", message, code: "prompt-failed" })
          finish()
        })
    },
    cancel() {
      cancelled = true
      cleanup?.()
    },
  })

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  })
}
