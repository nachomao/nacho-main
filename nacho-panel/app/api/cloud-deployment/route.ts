import { NextResponse, type NextRequest } from "next/server"
import { CloudDeploymentError, deployCloudServer, inspectCloudHost, validateCloudDeployInput, validateCloudHost } from "@/lib/cloud-deployment"
import { isSameOriginRequest } from "@/lib/same-origin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const noStoreHeaders = { "Cache-Control": "no-store", "X-Accel-Buffering": "no" }
let deploymentActive = false

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: noStoreHeaders })
}

export async function POST(request: NextRequest) {
  if (process.platform !== "win32" || process.env.VERCEL || !["localhost", "127.0.0.1"].includes(request.nextUrl.hostname)) {
    return json({ ok: false, message: "云端自动部署仅支持在 Windows 本机面板使用" }, 403)
  }
  if (!isSameOriginRequest(request.headers, request.nextUrl.origin)) {
    return json({ ok: false, message: "仅允许面板同源请求" }, 403)
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return json({ ok: false, message: "请求体必须使用 application/json" }, 415)
  }
  if (Number(request.headers.get("content-length") || 0) > 2_048) {
    return json({ ok: false, message: "请求体过大" }, 413)
  }

  try {
    const raw = await request.text()
    if (raw.length > 2_048) return json({ ok: false, message: "请求体过大" }, 413)
    const body: unknown = JSON.parse(raw)
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CloudDeploymentError("请求体无效")
    const input = body as Record<string, unknown>

    if (input.action === "inspect") {
      if (Object.keys(input).some((key) => !["action", "host"].includes(key))) throw new CloudDeploymentError("请求包含不支持的字段")
      const fingerprint = await inspectCloudHost(validateCloudHost(input.host))
      return json({ ok: true, data: { fingerprint } })
    }
    if (input.action !== "deploy") throw new CloudDeploymentError("不支持的云端部署操作")
    const target = validateCloudDeployInput(input)
    if (deploymentActive) return json({ ok: false, message: "另一项云端部署正在进行" }, 409)
    deploymentActive = true

    const encoder = new TextEncoder()
    let connected = true
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: unknown) => {
          if (connected) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        }
        void deployCloudServer(target, (step) => send({ type: "progress", step }), (content) => send({ type: "log", content }))
          .then((data) => send({ type: "complete", data }))
          .catch((error: unknown) => send({
            type: "error",
            message: error instanceof CloudDeploymentError ? error.message : "云端部署失败，请确认目标系统及本机发布制品可用",
          }))
          .finally(() => {
            deploymentActive = false
            if (connected) controller.close()
            connected = false
          })
      },
      cancel() { connected = false },
    })
    return new Response(stream, {
      headers: { ...noStoreHeaders, "Content-Type": "application/x-ndjson; charset=utf-8" },
    })
  } catch (error) {
    if (error instanceof SyntaxError) return json({ ok: false, message: "请求体不是有效 JSON" }, 400)
    if (error instanceof CloudDeploymentError) return json({ ok: false, message: error.message }, error.status)
    return json({ ok: false, message: "云端部署请求失败" }, 500)
  }
}
