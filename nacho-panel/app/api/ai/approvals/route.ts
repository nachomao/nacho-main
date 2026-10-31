import type { NextRequest } from "next/server"
import { AIHttpError, aiError, aiJson, readJsonBody, requireDesktop, requireJsonRequest, requireSameOrigin } from "@/lib/ai/http"
import { resolveBrokerApproval, type ApprovalDecision } from "@/lib/ai/approvals"
import { getChatSession } from "@/lib/ai/chat-sessions"
import { createOpencodeClient } from "@/lib/ai/opencode-client"
import { getRuntimeHandle } from "@/lib/ai/runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const invalid = requireSameOrigin(request) ?? requireDesktop() ?? requireJsonRequest(request, 8 * 1024)
  if (invalid) return invalid
  let body: Record<string, unknown>
  try {
    body = await readJsonBody(request, 8 * 1024) as Record<string, unknown>
  } catch (error) {
    if (error instanceof AIHttpError) return aiError(error.message, error.status, error.code)
    return aiError("请求体无效", 400, "invalid-request")
  }
  const uiSessionId = typeof body.uiSessionId === "string" ? body.uiSessionId : ""
  const approvalId = typeof body.approvalId === "string" ? body.approvalId : ""
  const decision = body.decision
  if (!uiSessionId || !approvalId || (decision !== "once" && decision !== "always" && decision !== "reject")) {
    return aiError("审批参数无效", 400, "invalid-approval")
  }
  const session = getChatSession(uiSessionId)
  if (!session) return aiError("AI 会话不存在或已结束", 409, "session-gone")

  if (approvalId.startsWith("oc:")) {
    const runtime = getRuntimeHandle()
    if (!runtime) return aiError("AI 引擎未运行", 409, "runtime-gone")
    const client = createOpencodeClient(runtime)
    await client.replyPermission(session.opencodeSessionId, approvalId.slice(3), decision)
    return aiJson({ ok: true, data: { resolved: true } })
  }
  const resolved = resolveBrokerApproval(uiSessionId, approvalId, decision as ApprovalDecision)
  if (!resolved) return aiError("审批已过期或不存在", 409, "approval-gone")
  return aiJson({ ok: true, data: { resolved: true } })
}
