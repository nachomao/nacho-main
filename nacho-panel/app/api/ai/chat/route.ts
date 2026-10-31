import { randomUUID } from "node:crypto"
import type { NextRequest } from "next/server"
import { resolveAIModel } from "@/lib/ai/config-shared"
import { AIHttpError, aiError, readJsonBody, requireDesktop, requireJsonRequest, requireSameOrigin } from "@/lib/ai/http"
import { buildSystemPrompt } from "@/lib/ai/system-prompt"
import { ensureEventHub, subscribeEvents, waitForEventHub } from "@/lib/ai/event-hub"
import { isSessionIdleEvent, isUserMessageEvent, SessionEventMapper } from "@/lib/ai/event-map"
import { denyAllPending } from "@/lib/ai/approvals"
import { subscribeApprovals } from "@/lib/ai/approval-bus"
import {
  clearActiveChat,
  ensureChatSession,
  isActiveTurn,
  setActiveChat,
  type ChatConnection,
  type ChatMode,
  type ChatSession,
} from "@/lib/ai/chat-sessions"
import {
  createOpencodeClient,
  OpenCodeError,
  type OpenCodePromptBody,
  type OpenCodePromptPart,
} from "@/lib/ai/opencode-client"
import { AIRuntimeError, ensureRuntime } from "@/lib/ai/runtime"
import { NACHO_AGENT_ID } from "@/lib/ai/opencode-config"
import { getAISettingsStore } from "@/lib/ai/settings-store"
import { runtimeModelIds } from "@/lib/ai/settings-schema"
import { getLocalJobsManager } from "@/lib/ai/local-jobs"
import {
  activeTimerElapsedMs,
  buildTimerReminderPrompt,
  createTimer,
  DEFAULT_CHECKPOINT_SECONDS,
  formatTimerDuration,
  isTimerExpired,
  isTurnCapReached,
  MAX_TURN_ACTIVE_SECONDS,
  pauseTimer,
  replaceTimer,
  resumeTimer,
  type TurnClock,
} from "@/lib/ai/task-timer"
import type { AIChatEvent, AIChatTimer } from "@/lib/ai/chat-events"
import {
  AIChatAttachmentError,
  MAX_AI_CHAT_REQUEST_LENGTH,
  validateAIChatAttachments,
  type AIChatAttachment,
} from "@/lib/ai/chat-attachments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_CHAT_TEXT_BYTES = 16 * 1024
const STREAM_IDLE_MS = MAX_TURN_ACTIVE_SECONDS * 1000 + 120_000
const TURN_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const FALLBACK_REMINDER = "检查任务进度：本地后台任务用 nacho_get_local_job 查看状态和日志 tail；受管客户端用 nacho_list_commands。仍在运行请评估剩余时间并设置新的计时器；已完成请总结。"

type ParsedChat = {
  uiSessionId: string
  turnId: string
  text: string
  attachments: AIChatAttachment[]
  model: string
  mode: ChatMode
  deepThinking: boolean
  connection: ChatConnection
}

type TurnPhase = "running" | "waiting" | "fired" | "summarizing" | "finished"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseChatBody(value: unknown): ParsedChat {
  if (!isRecord(value)) throw new AIHttpError("请求体必须是对象", 400, "invalid-request")
  const uiSessionId = value.uiSessionId
  if (typeof uiSessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(uiSessionId)) {
    throw new AIHttpError("会话标识无效", 400, "invalid-session")
  }
  const rawTurnId = typeof value.turnId === "string" ? value.turnId : ""
  if (rawTurnId && !TURN_ID_PATTERN.test(rawTurnId)) {
    throw new AIHttpError("回合标识无效", 400, "invalid-turn")
  }
  const turnId = rawTurnId || `t-${randomUUID()}`
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
  if (value.deepThinking !== undefined && typeof value.deepThinking !== "boolean") {
    throw new AIHttpError("深度思考参数无效", 400, "invalid-reasoning")
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
    turnId,
    text,
    attachments,
    model,
    mode: value.mode,
    deepThinking: value.deepThinking === true,
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

  let session: ChatSession
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
  setActiveChat(session, parsed.turnId)

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
      let ticker: NodeJS.Timeout | null = null
      let summaryTimer: NodeJS.Timeout | null = null
      let unsubscribeEvents: (() => void) | null = null
      let unsubscribeApprovals: (() => void) | null = null

      const turnStartedAt = Date.now()
      let turnPausedAt: number | null = null
      let turnPausedTotalMs = 0
      let phase: TurnPhase = "running"
      let timer: AIChatTimer | null = null
      let timerDue = false
      let reminderInFlight = false
      let summaryPromptSeen = false
      let summaryTextSeen = false
      let capTriggered = false
      let fallbackDueAt = turnStartedAt + DEFAULT_CHECKPOINT_SECONDS * 1000
      const pendingApprovals = new Set<string>()
      const pendingOcPermissions = new Set<string>()
      const mapper = new SessionEventMapper()

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
        phase = "finished"
        if (ping) clearInterval(ping)
        if (idle) clearTimeout(idle)
        if (ticker) clearInterval(ticker)
        if (summaryTimer) clearTimeout(summaryTimer)
        ping = null
        idle = null
        ticker = null
        summaryTimer = null
        unsubscribeEvents?.()
        unsubscribeApprovals?.()
        request.signal.removeEventListener("abort", abortChat)
        clearActiveChat(parsed.turnId)
        try {
          controller.close()
        } catch {
          // already closed
        }
      }

      const sendTimer = () => {
        if (timer) send({ type: "timer", timer })
      }

      const turnClock = (): TurnClock => ({
        startedAt: turnStartedAt,
        ...(turnPausedAt !== null ? { pausedAt: turnPausedAt } : {}),
        pausedTotalMs: turnPausedTotalMs,
      })

      const pauseTurn = (now: number) => {
        if (turnPausedAt === null) turnPausedAt = now
      }

      const resumeTurn = (now: number) => {
        if (turnPausedAt === null) return
        turnPausedTotalMs += Math.max(0, now - turnPausedAt)
        turnPausedAt = null
      }

      const pauseForApproval = (now: number) => {
        pauseTurn(now)
        if (timer) timer = pauseTimer(timer, now)
        sendTimer()
      }

      const resumeFromApproval = (now: number) => {
        resumeTurn(now)
        if (timer) timer = resumeTimer(timer, now)
        sendTimer()
      }

      const createFallback = (now: number) => {
        if (finished || timer) return
        timer = createTimer({
          afterSeconds: DEFAULT_CHECKPOINT_SECONDS,
          startedAt: now,
          reminder: FALLBACK_REMINDER,
          label: "默认检查点",
          fallback: true,
          onExpire: "wait",
        })
        if (pendingApprovals.size > 0) timer = pauseTimer(timer, now)
        sendTimer()
      }

      const cancelTimer = (reason?: string) => {
        if (!timer) return
        const canceled: AIChatTimer = { ...timer, state: "canceled", ...(reason ? { error: reason } : {}) }
        timer = null
        timerDue = false
        reminderInFlight = false
        send({ type: "timer", timer: canceled })
        fallbackDueAt = Date.now() + DEFAULT_CHECKPOINT_SECONDS * 1000
      }

      const applyTimerSet = (event: Extract<AIChatEvent, { type: "timer-set" }>) => {
        if (finished || phase === "summarizing") return
        const now = Date.now()
        const next = replaceTimer(timer, {
          afterSeconds: event.afterSeconds,
          startedAt: now,
          reminder: event.reminder,
          ...(event.label ? { label: event.label } : {}),
          onExpire: event.onExpire,
        })
        timer = pendingApprovals.size > 0 ? pauseTimer(next, now) : next
        timerDue = false
        sendTimer()
      }

      const handleApproval = (event: Extract<AIChatEvent, { type: "approval" }>) => {
        if (finished) return
        const wasEmpty = pendingApprovals.size === 0
        pendingApprovals.add(event.approvalId)
        if (event.approvalId.startsWith("oc:")) pendingOcPermissions.add(event.approvalId.slice(3))
        if (wasEmpty) pauseForApproval(Date.now())
        if (phase !== "summarizing") send(event)
      }

      const handleResolved = (event: Extract<AIChatEvent, { type: "approval-resolved" }>) => {
        if (finished) return
        pendingApprovals.delete(event.approvalId)
        if (event.approvalId.startsWith("oc:")) pendingOcPermissions.delete(event.approvalId.slice(3))
        if (pendingApprovals.size === 0) resumeFromApproval(Date.now())
        if (phase !== "summarizing") send(event)
      }

      const rejectPermissions = () => {
        for (const id of [...pendingOcPermissions]) {
          void client.replyPermission(session.opencodeSessionId, id, "reject").catch(() => undefined)
        }
        pendingOcPermissions.clear()
        denyAllPending(parsed.uiSessionId)
        pendingApprovals.clear()
      }

      const sessionIsIdle = async () => {
        try {
          const statuses = await client.getSessionStatus()
          const status = statuses[session.opencodeSessionId]
          return !status || status.type === "idle"
        } catch {
          return phase === "waiting"
        }
      }

      const wakeFailed = (message: string) => {
        if (finished) return
        const snapshot = timer
        const failed: AIChatTimer = snapshot
          ? { ...snapshot, state: "wake-failed", error: message }
          : {
              afterSeconds: 1,
              startedAt: Date.now(),
              pausedTotalMs: 0,
              reminder: "",
              onExpire: "wait",
              state: "wake-failed",
              error: message,
            }
        timer = null
        timerDue = false
        reminderInFlight = false
        rejectPermissions()
        send({ type: "timer", timer: failed })
        send({ type: "done" })
        finish()
      }

      const deliverReminder = async () => {
        if (finished || reminderInFlight) return
        const active = timer
        if (!active) return
        timerDue = false
        reminderInFlight = true
        summaryPromptSeen = false
        summaryTextSeen = false
        phase = "fired"
        const fired: AIChatTimer = { ...active, state: "fired", firedAt: Date.now() }
        timer = fired
        sendTimer()
        mapper.resetTurn()
        if (summaryTimer) clearTimeout(summaryTimer)
        summaryTimer = setTimeout(() => {
          if (!finished) wakeFailed("计时器到期，但 AI 未在预期时间内响应。")
        }, 120_000)
        const prompt = buildTimerReminderPrompt({
          reminder: active.reminder,
          elapsedSeconds: activeTimerElapsedMs(active, Date.now()) / 1000,
          capSeconds: MAX_TURN_ACTIVE_SECONDS,
        })
        try {
          await client.promptAsync(session.opencodeSessionId, {
            parts: [{ type: "text", text: prompt }],
            model: { providerID: "nacho", modelID: model },
            system,
            agent: NACHO_AGENT_ID,
            ...(parsed.mode === "chat" ? { tools: { "*": false } } : {}),
            ...(parsed.deepThinking ? { variant: "high" } : {}),
          })
        } catch (error) {
          if (finished) return
          const message = error instanceof OpenCodeError ? error.message : "计时器提醒发送失败"
          wakeFailed(message)
        }
      }

      const expireTimer = () => {
        if (finished || !timer || timerDue) return
        if (pendingApprovals.size > 0) return
        if (!isTimerExpired(timer, Date.now())) return
        const due: AIChatTimer = { ...timer, state: "waiting" }
        timer = due
        timerDue = true
        sendTimer()
        if (due.onExpire === "interrupt") {
          void (async () => {
            await client.abortSession(session.opencodeSessionId).catch(() => undefined)
            const deadline = Date.now() + 12_000
            while (!finished && Date.now() < deadline) {
              if (await sessionIsIdle()) {
                await deliverReminder()
                return
              }
              await new Promise((resolve) => setTimeout(resolve, 500))
            }
            if (!finished) wakeFailed("计时器到期，但 AI 引擎仍忙碌，无法发送提醒。")
          })()
          return
        }
        // 默认 wait：不 abort 同步工具；回合已经空闲时立即提醒，否则等回合结束后再提醒。
        if (phase === "waiting") void deliverReminder()
      }

      const onSessionIdle = () => {
        if (finished) return
        const now = Date.now()
        if (phase === "summarizing") {
          if (!summaryPromptSeen) return
          if (summaryTimer) {
            clearTimeout(summaryTimer)
            summaryTimer = null
          }
          if (!summaryTextSeen) {
            send({
              type: "error",
              message: "已达到 2 小时安全上限，但 AI 未返回进度总结。",
              code: "safety-cap-summary-failed",
            })
          } else {
            send({ type: "done" })
          }
          finish()
          return
        }
        if (phase === "fired") {
          if (!summaryPromptSeen) return
          if (summaryTimer) {
            clearTimeout(summaryTimer)
            summaryTimer = null
          }
          reminderInFlight = false
          if (timer?.state === "set") {
            phase = "waiting"
            const waiting: AIChatTimer = { ...timer, state: "waiting" }
            timer = waiting
            sendTimer()
            return
          }
          const hadText = summaryTextSeen
          timer = null
          if (!hadText) send({ type: "text", delta: "\n\n（AI 未返回文字总结，可继续追问。）" })
          if (getLocalJobsManager().hasActive(parsed.uiSessionId)) {
            phase = "waiting"
            createFallback(now)
            return
          }
          send({ type: "done" })
          finish()
          return
        }
        if (timerDue) {
          void deliverReminder()
          return
        }
        if (phase === "waiting") {
          if (timer) {
            const waiting: AIChatTimer = { ...timer, state: "waiting" }
            timer = waiting
            sendTimer()
            return
          }
          if (getLocalJobsManager().hasActive(parsed.uiSessionId)) {
            createFallback(now)
            return
          }
          send({ type: "done" })
          finish()
          return
        }
        // running
        if (timer) {
          phase = "waiting"
          const waiting: AIChatTimer = { ...timer, state: "waiting" }
          timer = waiting
          sendTimer()
          return
        }
        if (getLocalJobsManager().hasActive(parsed.uiSessionId)) {
          phase = "waiting"
          createFallback(now)
          return
        }
        send({ type: "done" })
        finish()
      }

      const safetyCap = () => {
        if (finished || capTriggered) return
        capTriggered = true
        phase = "summarizing"
        timerDue = false
        reminderInFlight = false
        const snapshot = timer
        if (snapshot) {
          const canceled: AIChatTimer = { ...snapshot, state: "canceled" }
          send({ type: "timer", timer: canceled })
          timer = null
        }
        send({ type: "safety-cap", message: "已达到 2 小时安全上限，正在停止并总结任务进度。" })
        rejectPermissions()
        mapper.resetTurn()
        summaryPromptSeen = false
        summaryTextSeen = false
        const prompt = [
          "[面板安全上限] 本轮活跃时间已达到 2 小时，工具执行已停止。",
          "请只基于已有上下文，用简洁中文总结：1) 已完成的内容；2) 未完成或卡住的内容；3) 建议的下一步。",
          "不要调用任何工具。",
        ].join("\n")
        if (summaryTimer) clearTimeout(summaryTimer)
        summaryTimer = setTimeout(() => {
          if (finished) return
          send({
            type: "error",
            message: "已达到 2 小时安全上限，但 AI 未返回进度总结。",
            code: "safety-cap-summary-failed",
          })
          finish()
        }, 60_000)
        void (async () => {
          try {
            if (!await sessionIsIdle()) {
              await client.abortSession(session.opencodeSessionId).catch(() => undefined)
              const deadline = Date.now() + 12_000
              while (!finished && Date.now() < deadline) {
                if (await sessionIsIdle()) break
                await new Promise((resolve) => setTimeout(resolve, 500))
              }
            }
            if (finished) return
            await client.promptAsync(session.opencodeSessionId, {
              parts: [{ type: "text", text: prompt }],
              model: { providerID: "nacho", modelID: model },
              system: buildSystemPrompt(settings, "chat"),
              agent: NACHO_AGENT_ID,
              tools: { "*": false },
            })
          } catch (error) {
            if (finished) return
            const message = error instanceof Error ? error.message : "安全上限总结失败"
            send({
              type: "error",
              message: `已达到 2 小时安全上限，但未能获取进度总结：${message}`,
              code: "safety-cap-summary-failed",
            })
            finish()
          }
        })()
      }

      function abortChat() {
        if (finished) return
        rejectPermissions()
        if (isActiveTurn(parsed.uiSessionId, parsed.turnId)) {
          void client.abortSession(session.opencodeSessionId).catch(() => undefined)
        }
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
          rejectPermissions()
          void client.abortSession(session.opencodeSessionId).catch(() => undefined)
          send({ type: "error", message: "AI 响应超时，请重试", code: "idle-timeout" })
          finish()
        }, STREAM_IDLE_MS)
      }

      unsubscribeEvents = subscribeEvents(session.opencodeSessionId, (event) => {
        resetIdle()
        if (isSessionIdleEvent(event)) {
          onSessionIdle()
          return
        }
        if ((phase === "fired" || phase === "summarizing") && isUserMessageEvent(event)) {
          summaryPromptSeen = true
          // reminder 已经真正进入会话后，120 秒只用于防止 prompt 没被受理；
          // 之后由 2 小时安全上限和 idle 兜底，不能把正在检查进度的 AI 误判为无响应。
          if (phase === "fired" && summaryTimer) {
            clearTimeout(summaryTimer)
            summaryTimer = null
          }
        }
        for (const mapped of mapper.map(event)) {
          if (mapped.type === "timer-set") {
            applyTimerSet(mapped)
            continue
          }
          if (mapped.type === "timer-cancel") {
            cancelTimer(mapped.reason)
            continue
          }
          if (mapped.type === "approval") {
            handleApproval(mapped)
            continue
          }
          if (mapped.type === "approval-resolved") {
            handleResolved(mapped)
            continue
          }
          if (mapped.type === "error") {
            send(mapped)
            finish()
            return
          }
          if (phase === "summarizing") {
            if (mapped.type === "text" || mapped.type === "reasoning" || mapped.type === "reasoning-done") {
              if (mapped.type === "text") summaryTextSeen = true
              send(mapped)
            }
            continue
          }
          if (phase === "fired" && mapped.type === "text") summaryTextSeen = true
          send(mapped)
        }
      })
      unsubscribeApprovals = subscribeApprovals(parsed.uiSessionId, (event) => {
        resetIdle()
        if (event.type === "approval") handleApproval(event)
        else handleResolved(event)
      })

      ticker = setInterval(() => {
        if (finished) return
        const now = Date.now()
        if (!capTriggered && isTurnCapReached(turnClock(), now)) {
          safetyCap()
          return
        }
        if (phase !== "running" && phase !== "waiting") return
        if (timer && !timerDue && isTimerExpired(timer, now)) {
          expireTimer()
          return
        }
        if (!timer && !timerDue && now >= fallbackDueAt) {
          createFallback(now)
        }
      }, 1_000)

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
        agent: NACHO_AGENT_ID,
        ...(parsed.mode === "chat" ? { tools: { "*": false } } : {}),
        ...(parsed.deepThinking ? { variant: "high" } : {}),
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
