import { redactSecrets } from "./redact"

const MAX_RESPONSE_BYTES = 1024 * 1024
const PROTOCOL_VERSION = "2025-11-25"

export type MCPToolInfo = {
  name: string
  description?: string
  inputSchema?: unknown
}

export type MCPProbeResult = {
  id: string
  ok: boolean
  tools: number
  latencyMs: number
  error?: { code: string; message: string }
}

type JsonRpcResponse = {
  jsonrpc?: string
  id?: number | string | null
  result?: Record<string, unknown>
  error?: { code?: number; message?: string }
}

function assertMcpUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("MCP 地址无效")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("MCP 地址必须使用 http 或 https")
  if (url.username || url.password) throw new Error("MCP 地址不得包含用户名或密码")
  if (url.hash) throw new Error("MCP 地址不得包含片段")
}

function headersFor(token: string | undefined, sessionId?: string) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function readSseResponse(response: Response, id: number): Promise<JsonRpcResponse> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("MCP 响应为空")
  const decoder = new TextDecoder()
  let buffer = ""
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("MCP 响应超过大小限制")
      buffer += decoder.decode(value, { stream: true })
      let index
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue
          const raw = line.slice(5).trim()
          if (!raw || raw === "[DONE]") continue
          let parsed: JsonRpcResponse
          try {
            parsed = JSON.parse(raw) as JsonRpcResponse
          } catch {
            continue
          }
          if (parsed.id === id) return parsed
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  throw new Error("MCP 事件流未返回匹配响应")
}

async function postRpc(
  url: string,
  token: string | undefined,
  payload: Record<string, unknown>,
  timeoutMs: number,
  sessionId?: string,
): Promise<{ response: Response; body: JsonRpcResponse | null }> {
  const response = await fetch(url, {
    method: "POST",
    headers: headersFor(token, sessionId),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}`)
  if (!("id" in payload)) return { response, body: null }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (contentType.includes("text/event-stream")) {
    return { response, body: await readSseResponse(response, payload.id as number) }
  }
  const text = await response.text()
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("MCP 响应超过大小限制")
  if (!text.trim()) return { response, body: null }
  let body: JsonRpcResponse
  try {
    body = JSON.parse(text) as JsonRpcResponse
  } catch {
    throw new Error("MCP 响应不是有效 JSON")
  }
  return { response, body }
}

function unwrap(body: JsonRpcResponse | null): Record<string, unknown> {
  if (!body) throw new Error("MCP 未返回响应")
  if (body.error) throw new Error(body.error.message || "MCP 请求失败")
  if (!body.result) throw new Error("MCP 响应缺少 result")
  return body.result
}

export async function listMcpTools(
  server: { url: string; token?: string },
  timeoutMs = 5_000,
): Promise<MCPToolInfo[]> {
  assertMcpUrl(server.url)
  const init = await postRpc(server.url, server.token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { roots: {} },
      clientInfo: { name: "nacho-panel", version: "1" },
    },
  }, timeoutMs)
  unwrap(init.body)
  const sessionId = init.response.headers.get("mcp-session-id") || undefined
  await postRpc(server.url, server.token, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  }, timeoutMs, sessionId).catch(() => undefined)

  const tools: MCPToolInfo[] = []
  let cursor: string | undefined
  for (let page = 0; page < 3; page++) {
    const response = await postRpc(server.url, server.token, {
      jsonrpc: "2.0",
      id: 100 + page,
      method: "tools/list",
      ...(cursor ? { params: { cursor } } : {}),
    }, timeoutMs, sessionId)
    const result = unwrap(response.body)
    const list = Array.isArray(result.tools) ? result.tools : []
    for (const item of list) {
      if (!item || typeof item !== "object") continue
      const tool = item as Record<string, unknown>
      if (typeof tool.name !== "string" || !tool.name) continue
      tools.push({
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : undefined,
        inputSchema: tool.inputSchema,
      })
    }
    cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined
    if (!cursor) break
  }
  return tools
}

export async function probeMcpServer(
  server: { id: string; url: string; token?: string },
  timeoutMs = 5_000,
): Promise<MCPProbeResult> {
  const started = Date.now()
  try {
    const tools = await listMcpTools(server, timeoutMs)
    return { id: server.id, ok: true, tools: tools.length, latencyMs: Date.now() - started }
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : "MCP 连接失败", server.token ? [server.token] : [])
    return {
      id: server.id,
      ok: false,
      tools: 0,
      latencyMs: Date.now() - started,
      error: { code: "mcp-unreachable", message: message.slice(0, 300) },
    }
  }
}
