import type { NextRequest } from "next/server"
import { AIHttpError, aiError, aiJson, readJsonBody, requireDesktop, requireJsonRequest, requireSameOrigin } from "@/lib/ai/http"
import { denyAllPending } from "@/lib/ai/approvals"
import { forgetChatSession } from "@/lib/ai/chat-sessions"
import { getAIChatSessionMapStore } from "@/lib/ai/chat-session-map"
import { stopEventHub } from "@/lib/ai/event-hub"
import { stopRuntime } from "@/lib/ai/runtime"

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
  if (!uiSessionId || !/^[A-Za-z0-9_-]{1,128}$/.test(uiSessionId)) {
    return aiError("会话标识无效", 400, "invalid-session")
  }

  denyAllPending(uiSessionId)
  forgetChatSession(uiSessionId)
  await getAIChatSessionMapStore().forget(uiSessionId).catch(() => undefined)
  stopEventHub()
  await stopRuntime()
  return aiJson({ ok: true, data: { restarted: true } })
}
