import { randomUUID } from "node:crypto"
import type { NextRequest } from "next/server"
import { aiError, bearerToken, rejectBrowserOrigin, safeEqual } from "@/lib/ai/http"
import { executeNachoTool, finalizeToolText } from "@/lib/ai/broker"
import { getActiveChat } from "@/lib/ai/chat-sessions"
import { getRuntimeTokens } from "@/lib/ai/runtime"
import { getAISettingsStore } from "@/lib/ai/settings-store"
import { listNachoTools } from "@/lib/ai/tool-registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY = 64 * 1024
const SESSION_ID = `nacho-${randomUUID()}`

type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

function rpcResponse(id: string | number | null | undefined, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result }, {
    headers: {
      "Cache-Control": "no-store",
      "Mcp-Session-Id": SESSION_ID,
    },
  })
}

function rpcError(id: string | number | null | undefined, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, {
    headers: {
      "Cache-Control": "no-store",
      "Mcp-Session-Id": SESSION_ID,
    },
  })
}

function toolResult(text: string, isError: boolean) {
  return { content: [{ type: "text", text }], isError }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } })
}

export async function POST(request: NextRequest) {
  const invalidOrigin = rejectBrowserOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const tokens = getRuntimeTokens()
  const token = bearerToken(request)
  if (!tokens || !safeEqual(token, tokens.brokerToken)) {
    return aiError("Nacho MCP 鉴权失败", 401, "mcp-auth")
  }
  const raw = await request.text()
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY) return aiError("MCP 请求体过大", 413, "body-too-large")
  let body: JsonRpcRequest
  try {
    body = JSON.parse(raw) as JsonRpcRequest
  } catch {
    return rpcError(null, -32700, "请求体不是有效 JSON")
  }
  if (Array.isArray(body)) return rpcError(null, -32600, "不支持批量 MCP 请求")
  const id = body.id
  if (body.method === "initialize") {
    const protocol = typeof body.params?.protocolVersion === "string"
      ? body.params.protocolVersion
      : "2025-11-25"
    return rpcResponse(id, {
      protocolVersion: protocol,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "nacho", version: "1.0.0" },
    })
  }
  if (body.method === "notifications/initialized") {
    return new Response(null, { status: 202, headers: { "Mcp-Session-Id": SESSION_ID } })
  }
  if (body.method === "ping") return rpcResponse(id, {})
  if (body.method === "tools/list") {
    try {
      const settings = (await getAISettingsStore().read()).config
      const tools = listNachoTools(settings).map((tool) => ({
        name: tool.mcpName,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }))
      return rpcResponse(id, { tools })
    } catch {
      return rpcError(id, -32603, "读取 AI 设置失败")
    }
  }
  if (body.method === "tools/call") {
    const name = typeof body.params?.name === "string" ? body.params.name : ""
    const args = typeof body.params?.arguments === "object" && body.params.arguments !== null
      ? body.params.arguments as Record<string, unknown>
      : {}
    if (!name) return rpcError(id, -32602, "缺少工具名称")
    const chat = getActiveChat()
    if (!chat) return rpcResponse(id, toolResult("当前没有进行中的 AI 会话，拒绝执行工具。", true))
    try {
      const settings = (await getAISettingsStore().read()).config
      const result = await executeNachoTool({ toolName: name, args, chat, settings })
      const finalized = finalizeToolText(result.text, chat.connection.key)
      return rpcResponse(id, toolResult(finalized.text, !result.ok))
    } catch (error) {
      return rpcResponse(id, toolResult(error instanceof Error ? error.message : "工具执行失败", true))
    }
  }
  return rpcError(id, -32601, `不支持的 MCP 方法：${body.method || "unknown"}`)
}
