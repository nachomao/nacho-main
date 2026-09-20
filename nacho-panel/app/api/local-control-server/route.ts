import { NextResponse, type NextRequest } from "next/server"
import {
  getLocalControlServerStatus,
  installLocalControlServer,
  LocalControlServerError,
  repairLocalControlServer,
  restartLocalControlServer,
  setLocalControlAccessMode,
  setLocalControlAutoStart,
  setLocalControlPort,
  startLocalControlServer,
  stopLocalControlServer,
  uninstallLocalControlServer,
} from "@/lib/local-control-server"
import { isSameOriginRequest } from "@/lib/same-origin"
import type {
  LocalControlInstallOptions,
  LocalControlInstallStreamEvent,
} from "@/lib/local-control-server-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_REQUEST_LENGTH = 2_048
const INSTALL_STREAM_CONTENT_TYPE = "application/x-ndjson"
const noStoreHeaders = { "Cache-Control": "no-store" }

function streamInstall(options: LocalControlInstallOptions) {
  const encoder = new TextEncoder()
  let connected = true
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: LocalControlInstallStreamEvent) => {
        if (connected) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }
      void installLocalControlServer(options, (data) => send({ type: "log", data }))
        .then((data) => send({ type: "complete", data }))
        .catch((error: unknown) => {
          send({ type: "error", message: error instanceof Error ? error.message : "本地服务安装失败" })
        })
        .finally(() => {
          if (!connected) return
          connected = false
          controller.close()
        })
    },
    cancel() {
      connected = false
    },
  })

  return new Response(stream, {
    headers: {
      ...noStoreHeaders,
      "Content-Type": `${INSTALL_STREAM_CONTENT_TYPE}; charset=utf-8`,
      Vary: "Accept",
      "X-Accel-Buffering": "no",
    },
  })
}

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

function requireOnlyKeys(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new LocalControlServerError("请求包含不支持的字段", 400)
  }
}

export async function GET(request: NextRequest) {
  if (!isSameOriginRequest(request.headers, request.nextUrl.origin)) {
    return json({ ok: false, message: "仅允许面板同源请求" }, { status: 403 })
  }
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
        requireOnlyKeys(body, ["action", "accessMode", "autoStart", "port"])
        if (body.accessMode !== "loopback" && body.accessMode !== "lan") {
          throw new LocalControlServerError("连接范围无效", 400)
        }
        if (typeof body.autoStart !== "boolean") {
          throw new LocalControlServerError("autoStart 必须是布尔值", 400)
        }
        if (body.port !== undefined && typeof body.port !== "number") {
          throw new LocalControlServerError("端口必须是数字", 400)
        }
        if (request.headers.get("accept")?.includes(INSTALL_STREAM_CONTENT_TYPE)) {
          return streamInstall({
            accessMode: body.accessMode,
            autoStart: body.autoStart,
            port: body.port,
          })
        }
        data = await installLocalControlServer({
          accessMode: body.accessMode,
          autoStart: body.autoStart,
          port: body.port,
        })
        break
      case "start":
        requireOnlyKeys(body, ["action"])
        data = await startLocalControlServer()
        break
      case "stop":
        requireOnlyKeys(body, ["action"])
        data = await stopLocalControlServer()
        break
      case "restart":
        requireOnlyKeys(body, ["action"])
        data = await restartLocalControlServer()
        break
      case "repair":
        requireOnlyKeys(body, ["action"])
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
    let data
    if (Object.hasOwn(body, "autoStart")) {
      if (typeof body.autoStart !== "boolean") throw new LocalControlServerError("autoStart 必须是布尔值", 400)
      data = await setLocalControlAutoStart(body.autoStart)
    } else if (Object.hasOwn(body, "accessMode")) {
      if (body.accessMode !== "loopback" && body.accessMode !== "lan") {
        throw new LocalControlServerError("连接范围无效", 400)
      }
      data = await setLocalControlAccessMode(body.accessMode)
    } else if (Object.hasOwn(body, "port")) {
      if (typeof body.port !== "number") throw new LocalControlServerError("端口必须是数字", 400)
      data = await setLocalControlPort(body.port)
    } else {
      throw new LocalControlServerError("本地服务设置项无效", 400)
    }
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
    requireOnlyKeys(body, ["confirmation"])
    if (typeof body.confirmation !== "string") throw new LocalControlServerError("卸载确认文字无效", 400)
    return json({ ok: true, data: await uninstallLocalControlServer(body.confirmation) })
  } catch (error) {
    return handleError(error)
  }
}
