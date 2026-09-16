import { NextResponse, type NextRequest } from "next/server"
import {
  getLocalControlServerStatus,
  installLocalControlServer,
  LocalControlServerError,
  repairLocalControlServer,
  restartLocalControlServer,
  setLocalControlAccessMode,
  setLocalControlAutoStart,
  startLocalControlServer,
  stopLocalControlServer,
  uninstallLocalControlServer,
} from "@/lib/local-control-server"
import type { LocalControlAccessMode } from "@/lib/local-control-server-types"
import { isSameOriginRequest } from "@/lib/same-origin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_REQUEST_LENGTH = 2_048
const noStoreHeaders = { "Cache-Control": "no-store" }

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: { ...noStoreHeaders, ...init?.headers },
  })
}

function validateMutationRequest(request: NextRequest) {
  if (!isSameOriginRequest(request.headers, request.nextUrl.origin)) {
    return json({ ok: false, message: "仅允许面板同源请求" }, { status: 403 })
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
  if (contentType !== "application/json") {
    return json({ ok: false, message: "请求体必须使用 application/json" }, { status: 415 })
  }
  const contentLength = Number(request.headers.get("content-length") || "0")
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_LENGTH) {
    return json({ ok: false, message: "请求体过大" }, { status: 413 })
  }
  return null
}

async function requestBody(request: NextRequest) {
  const raw = await request.text()
  if (raw.length > MAX_REQUEST_LENGTH) throw new LocalControlServerError("请求体过大", 413)
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalControlServerError("请求体必须是对象", 400)
  }
  return value as Record<string, unknown>
}

function handleError(error: unknown) {
  if (error instanceof SyntaxError) return json({ ok: false, message: "请求体不是有效 JSON" }, { status: 400 })
  if (error instanceof LocalControlServerError) {
    return json({ ok: false, message: error.message }, { status: error.status })
  }
  return json({ ok: false, message: error instanceof Error ? error.message : "本地服务管理失败" }, { status: 500 })
}

export async function GET() {
  try {
    return json({ ok: true, data: await getLocalControlServerStatus() })
  } catch (error) {
    return handleError(error)
  }
}

export async function POST(request: NextRequest) {
  const invalidRequest = validateMutationRequest(request)
  if (invalidRequest) return invalidRequest
  try {
    const body = await requestBody(request)
    let data
    switch (body.action) {
      case "install":
        data = await installLocalControlServer({
          accessMode: body.accessMode as LocalControlAccessMode,
          autoStart: body.autoStart === true,
          port: body.port === undefined ? undefined : Number(body.port),
        })
        break
      case "start":
        data = await startLocalControlServer()
        break
      case "stop":
        data = await stopLocalControlServer()
        break
      case "restart":
        data = await restartLocalControlServer()
        break
      case "repair":
        data = await repairLocalControlServer()
        break
      default:
        throw new LocalControlServerError("本地服务操作无效", 400)
    }
    return json({ ok: true, data })
  } catch (error) {
    return handleError(error)
  }
}

export async function PATCH(request: NextRequest) {
  const invalidRequest = validateMutationRequest(request)
  if (invalidRequest) return invalidRequest
  try {
    const body = await requestBody(request)
    const keys = Object.keys(body)
    if (keys.length !== 1) throw new LocalControlServerError("每次只能修改一项本地服务设置", 400)
    const data = Object.hasOwn(body, "autoStart")
      ? await setLocalControlAutoStart(body.autoStart === true)
      : Object.hasOwn(body, "accessMode")
        ? await setLocalControlAccessMode(body.accessMode as LocalControlAccessMode)
        : (() => {
            throw new LocalControlServerError("本地服务设置项无效", 400)
          })()
    return json({ ok: true, data })
  } catch (error) {
    return handleError(error)
  }
}

export async function DELETE(request: NextRequest) {
  const invalidRequest = validateMutationRequest(request)
  if (invalidRequest) return invalidRequest
  try {
    const body = await requestBody(request)
    if (Object.keys(body).some((key) => key !== "confirmation")) {
      throw new LocalControlServerError("卸载请求包含未知字段", 400)
    }
    return json({ ok: true, data: await uninstallLocalControlServer(String(body.confirmation || "")) })
  } catch (error) {
    return handleError(error)
  }
}
