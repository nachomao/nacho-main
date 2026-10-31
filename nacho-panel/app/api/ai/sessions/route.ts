import type { NextRequest } from "next/server"
import {
  MAX_AI_CHAT_HISTORY_BYTES,
  normalizePersistedChatHistory,
} from "@/lib/ai/chat-history"
import { AIChatHistoryStoreError, getAIChatHistoryStore } from "@/lib/ai/chat-history-store"
import { getAIChatSessionMapStore } from "@/lib/ai/chat-session-map"
import { deleteChatSession, forgetChatSession, getChatSession } from "@/lib/ai/chat-sessions"
import {
  AIHttpError,
  aiError,
  aiJson,
  readJsonBody,
  requireDesktop,
  requireJsonRequest,
  requireSameOrigin,
} from "@/lib/ai/http"
import { createOpencodeClient } from "@/lib/ai/opencode-client"
import { getRuntimeHandle } from "@/lib/ai/runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function validSessionId(value: string) {
  return /^[A-Za-z0-9_:-]{1,160}$/.test(value)
}

export async function GET(request: NextRequest) {
  const invalid = requireSameOrigin(request) ?? requireDesktop()
  if (invalid) return invalid
  try {
    const snapshot = await getAIChatHistoryStore().read()
    return aiJson({ ok: true, data: snapshot.history })
  } catch {
    return aiError("读取会话历史失败", 500, "history-read")
  }
}

export async function PUT(request: NextRequest) {
  const invalid = requireSameOrigin(request)
    ?? requireDesktop()
    ?? requireJsonRequest(request, MAX_AI_CHAT_HISTORY_BYTES)
  if (invalid) return invalid
  let body: unknown
  try {
    body = await readJsonBody(request, MAX_AI_CHAT_HISTORY_BYTES)
  } catch (error) {
    if (error instanceof AIHttpError) return aiError(error.message, error.status, error.code)
    return aiError("请求体无效", 400, "invalid-request")
  }
  const history = normalizePersistedChatHistory(body)
  if (!history) return aiError("会话历史格式无效", 400, "invalid-history")
  try {
    await getAIChatHistoryStore().write(history)
    return aiJson({ ok: true, data: { saved: true } })
  } catch (error) {
    if (error instanceof AIChatHistoryStoreError && error.code === "too-large") {
      return aiError("会话历史超过大小限制", 413, "history-too-large")
    }
    return aiError("保存会话历史失败", 500, "write-failed")
  }
}

export async function DELETE(request: NextRequest) {
  const invalid = requireSameOrigin(request) ?? requireDesktop()
  if (invalid) return invalid
  const uiSessionId = request.nextUrl.searchParams.get("uiSessionId") || ""
  if (!validSessionId(uiSessionId)) return aiError("缺少会话标识", 400, "invalid-session")

  const mapStore = getAIChatSessionMapStore()
  const mapping = await mapStore.get(uiSessionId).catch(() => null)
  const session = getChatSession(uiSessionId)
  const runtime = getRuntimeHandle()
  if (runtime && (session || mapping)) {
    await deleteChatSession(
      createOpencodeClient(runtime),
      uiSessionId,
      mapping?.opencodeSessionId,
      mapStore,
    )
  } else {
    forgetChatSession(uiSessionId)
    await mapStore.forget(uiSessionId).catch(() => undefined)
  }
  const removed = await getAIChatHistoryStore().remove(uiSessionId).catch(() => null)
  return aiJson({
    ok: true,
    data: {
      deleted: Boolean(session || mapping),
      history: Boolean(removed?.removed),
    },
  })
}
