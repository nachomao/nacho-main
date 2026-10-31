import { timingSafeEqual } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { isSameOriginRequest } from "@/lib/same-origin"

const noStoreHeaders = { "Cache-Control": "no-store" }

export class AIHttpError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = "AIHttpError"
  }
}

export function aiJson(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: { ...noStoreHeaders, ...init?.headers },
  })
}

export function aiError(message: string, status: number, code?: string) {
  return aiJson({ ok: false, message, ...(code ? { code } : {}) }, { status })
}

export function requireSameOrigin(request: NextRequest) {
  if (!isSameOriginRequest(request.headers, request.nextUrl.origin)) {
    return aiError("仅允许面板同源请求", 403, "cross-origin")
  }
  return null
}

export function requireDesktop() {
  if (process.env.NACHO_PANEL_DESKTOP !== "1") {
    return aiError("AI Mode 仅支持 Windows 桌面版", 501, "desktop-only")
  }
  return null
}

export function rejectBrowserOrigin(request: NextRequest) {
  if (request.headers.get("origin") || request.headers.get("sec-fetch-site")) {
    return aiError("该接口仅供本地 AI 运行时调用", 403, "runtime-only")
  }
  return null
}

export function requireJsonRequest(request: NextRequest, maximum: number) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
  if (contentType !== "application/json") {
    return aiError("请求体必须使用 application/json", 415, "content-type")
  }
  const contentLength = Number(request.headers.get("content-length") || "0")
  if (Number.isFinite(contentLength) && contentLength > maximum) {
    return aiError("请求体过大", 413, "body-too-large")
  }
  return null
}

export async function readJsonBody(request: NextRequest, maximum: number): Promise<unknown> {
  const raw = await request.text()
  if (Buffer.byteLength(raw, "utf8") > maximum) throw new AIHttpError("请求体过大", 413, "body-too-large")
  try {
    return JSON.parse(raw)
  } catch {
    throw new AIHttpError("请求体不是有效 JSON", 400, "invalid-json")
  }
}

export function bearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") || ""
  if (!authorization.toLowerCase().startsWith("bearer ")) return ""
  return authorization.slice(7).trim()
}

export function safeEqual(a: string, b: string) {
  if (!a || !b) return false
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
