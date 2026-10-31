import { NextResponse, type NextRequest } from "next/server"
import { bearerToken, aiError, rejectBrowserOrigin, safeEqual } from "@/lib/ai/http"
import { redactSecrets, sanitizeErrorMessage } from "@/lib/ai/redact"
import { getRuntimeTokens } from "@/lib/ai/runtime"
import { getAISettingsStore } from "@/lib/ai/settings-store"
import { runtimeModelIds } from "@/lib/ai/settings-schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// 多轮对话会把历史图片重复带给上游，代理上限需高于单次请求上限。
const MAX_PROXY_BODY = 32 * 1024 * 1024
const MAX_UPSTREAM_ERROR = 4 * 1024
const WINDOW_MS = 60_000
const MAX_REQUESTS = 120
const rate = new Map<string, { count: number; reset: number }>()

function withinRateLimit(token: string) {
  const now = Date.now()
  const entry = rate.get(token)
  if (!entry || entry.reset < now) {
    rate.set(token, { count: 1, reset: now + WINDOW_MS })
    return true
  }
  entry.count++
  return entry.count <= MAX_REQUESTS
}

function upstreamError(message: string, status: number) {
  return NextResponse.json({ error: { message, type: "upstream_error" } }, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(request, context, "GET")
}

export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(request, context, "POST")
}

async function handle(request: NextRequest, context: { params: Promise<{ path?: string[] }> }, method: "GET" | "POST") {
  const invalidOrigin = rejectBrowserOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const tokens = getRuntimeTokens()
  const token = bearerToken(request)
  if (!tokens || !safeEqual(token, tokens.proxyToken)) {
    return aiError("AI Provider 代理鉴权失败", 401, "proxy-auth")
  }
  if (!withinRateLimit(token)) return aiError("AI Provider 请求过于频繁", 429, "rate-limit")
  const params = await context.params
  const pathname = `/${(params.path || []).join("/")}`
  const isChat = method === "POST" && (pathname === "/v1/chat/completions" || pathname === "/chat/completions")
  const isModels = method === "GET" && (pathname === "/v1/models" || pathname === "/models")
  if (!isChat && !isModels) return aiError("不支持的 Provider 路径", 404, "not-found")

  const snapshot = await getAISettingsStore().read()
  const config = snapshot.config
  if (!config.apiKey) return aiError("尚未配置 API Key", 401, "missing-key")
  const base = config.baseUrl.replace(/\/+$/, "")
  const upstreamPath = pathname.replace(/^\/v1(?=\/|$)/, "") || "/"
  let upstream: URL
  try {
    upstream = new URL(`${base}${upstreamPath}`)
  } catch {
    return aiError("API 地址无效", 400, "invalid-url")
  }

  let body: string | undefined
  if (isChat) {
    body = await request.text()
    if (Buffer.byteLength(body, "utf8") > MAX_PROXY_BODY) return aiError("请求体过大", 413, "body-too-large")
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(body) as Record<string, unknown>
    } catch {
      return aiError("Provider 请求体不是有效 JSON", 400, "invalid-json")
    }
    if (typeof parsed.model !== "string" || !runtimeModelIds(config).includes(parsed.model)) {
      return aiError("模型不在允许列表中", 400, "invalid-model")
    }
    parsed.temperature = config.temperature
    body = JSON.stringify(parsed)
  }

  let response: Response
  try {
    response = await fetch(upstream, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        Accept: request.headers.get("accept") || "application/json",
      },
      body,
      signal: AbortSignal.timeout(600_000),
    })
  } catch (error) {
    return aiError(sanitizeErrorMessage(error, [config.apiKey]), 502, "upstream-unreachable")
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    let message = text.slice(0, MAX_UPSTREAM_ERROR)
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
      message = typeof parsed.error === "string"
        ? parsed.error
        : parsed.error?.message || parsed.message || message
    } catch {
      // keep raw text
    }
    return upstreamError(redactSecrets(message || `上游请求失败（HTTP ${response.status}）`, [config.apiKey]), response.status)
  }
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") || (isModels ? "application/json" : "text/event-stream"),
      "Cache-Control": "no-store",
    },
  })
}
