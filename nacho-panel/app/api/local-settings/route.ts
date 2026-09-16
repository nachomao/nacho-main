import { NextResponse, type NextRequest } from "next/server"
import { MAX_LOCAL_SETTINGS_REQUEST_LENGTH } from "@/lib/local-settings-schema"
import {
  LocalSettingsValidationError,
  patchLocalSettings,
  readLocalSettings,
  resetLocalSettings,
} from "@/lib/local-settings-store"
import { isSameOriginRequest } from "@/lib/same-origin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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
  if (Number.isFinite(contentLength) && contentLength > MAX_LOCAL_SETTINGS_REQUEST_LENGTH) {
    return json({ ok: false, message: "请求体过大" }, { status: 413 })
  }
  return null
}

export async function GET() {
  try {
    const snapshot = await readLocalSettings()
    return json({ ok: true, data: snapshot.settings, meta: { exists: snapshot.exists, recovered: snapshot.recovered } })
  } catch {
    return json({ ok: false, message: "读取本地设置失败" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const invalidRequest = validateMutationRequest(request)
  if (invalidRequest) return invalidRequest

  try {
    const raw = await request.text()
    if (raw.length > MAX_LOCAL_SETTINGS_REQUEST_LENGTH) {
      return json({ ok: false, message: "请求体过大" }, { status: 413 })
    }
    const body = JSON.parse(raw)
    const settings = await patchLocalSettings(body)
    return json({ ok: true, data: settings })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return json({ ok: false, message: "请求体不是有效 JSON" }, { status: 400 })
    }
    if (error instanceof LocalSettingsValidationError) {
      return json({ ok: false, message: error.message }, { status: 400 })
    }
    return json({ ok: false, message: "保存本地设置失败" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const invalidRequest = validateMutationRequest(request)
  if (invalidRequest) return invalidRequest

  try {
    const settings = await resetLocalSettings()
    return json({ ok: true, data: settings })
  } catch {
    return json({ ok: false, message: "重置本地设置失败" }, { status: 500 })
  }
}
