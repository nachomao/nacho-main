import type { NextRequest } from "next/server"
import { AIHttpError, aiError, aiJson, readJsonBody, requireDesktop, requireJsonRequest, requireSameOrigin } from "@/lib/ai/http"
import { denyAllPending } from "@/lib/ai/approvals"
import { clearActiveChat, getActiveChat, getChatSession, isActiveTurn } from "@/lib/ai/chat-sessions"
import { createOpencodeClient } from "@/lib/ai/opencode-client"
import { getRuntimeHandle } from "@/lib/ai/runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const invalid = requireSameOrigin(request) ?? requireDesktop() ?? requireJsonRequest(request, 8 * 1024)
  if (invalid) return invalid
  let uiSessionId = ""
  let turnId = ""
  try {
    const body = await readJsonBody(request, 8 * 1024) as Record<string, unknown>
    uiSessionId = typeof body.uiSessionId === "string" ? body.uiSessionId : ""
    turnId = typeof body.turnId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(body.turnId) ? body.turnId : ""
  } catch (error) {
    if (error instanceof AIHttpError) return aiError(error.message, error.status, error.code)
    return aiError("请求体无效", 400, "invalid-request")
  }
  if (!uiSessionId) return aiError("缺少会话标识", 400, "invalid-session")
  const session = getChatSession(uiSessionId)
  const active = getActiveChat()
  // 带 turnId 时只允许中止仍属于该回合的请求，避免“停止后立即重发”时旧 abort 杀掉新回合。
  const shouldAbort = turnId ? isActiveTurn(uiSessionId, turnId) : Boolean(session)
  if (!shouldAbort) return aiJson({ ok: true, data: { aborted: false } })
  denyAllPending(uiSessionId)
  const runtime = getRuntimeHandle()
  if (runtime && session) {
    const client = createOpencodeClient(runtime)
    await client.abortSession(session.opencodeSessionId).catch(() => undefined)
  }
  if (turnId) clearActiveChat(turnId)
  else if (active?.uiSessionId === uiSessionId) clearActiveChat()
  return aiJson({ ok: true, data: { aborted: Boolean(session) } })
}
