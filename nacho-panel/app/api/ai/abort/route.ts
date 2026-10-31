import type { NextRequest } from "next/server"
import { AIHttpError, aiError, aiJson, readJsonBody, requireDesktop, requireJsonRequest, requireSameOrigin } from "@/lib/ai/http"
import { denyAllPending } from "@/lib/ai/approvals"
import { getActiveChat, getChatSession, setActiveChat } from "@/lib/ai/chat-sessions"
import { createOpencodeClient } from "@/lib/ai/opencode-client"
import { getRuntimeHandle } from "@/lib/ai/runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const invalid = requireSameOrigin(request) ?? requireDesktop() ?? requireJsonRequest(request, 8 * 1024)
  if (invalid) return invalid
  let uiSessionId = ""
  try {
    const body = await readJsonBody(request, 8 * 1024) as Record<string, unknown>
    uiSessionId = typeof body.uiSessionId === "string" ? body.uiSessionId : ""
  } catch (error) {
    if (error instanceof AIHttpError) return aiError(error.message, error.status, error.code)
    return aiError("请求体无效", 400, "invalid-request")
  }
  if (!uiSessionId) return aiError("缺少会话标识", 400, "invalid-session")
  const session = getChatSession(uiSessionId)
  denyAllPending(uiSessionId)
  const runtime = getRuntimeHandle()
  if (runtime && session) {
    const client = createOpencodeClient(runtime)
    await client.abortSession(session.opencodeSessionId).catch(() => undefined)
  }
  if (getActiveChat()?.uiSessionId === uiSessionId) setActiveChat(null)
  return aiJson({ ok: true, data: { aborted: Boolean(session) } })
}
