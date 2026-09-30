import { NextResponse } from "next/server"
import { fetchSignedProductIndex } from "@/lib/signed-product-index"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const runtime = "nodejs"

const statePath = () => path.join(process.env.LOCALAPPDATA || os.homedir(), "NachoPanel", "update-channel.json")
const channels = ["stable", "beta", "alpha"] as const
type Channel = typeof channels[number]
function channel(): Channel {
  try {
    const value = JSON.parse(fs.readFileSync(statePath(), "utf8")) as { channel?: Channel }
    if (value.channel && channels.includes(value.channel)) return value.channel
  } catch {}
  return "stable"
}
export async function GET() {
  try {
    const selected = channel()
    const index = await fetchSignedProductIndex(selected)
    return NextResponse.json({ ok: true, data: { index, stale: false, currentVersion: null, channel: selected } })
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "检查更新失败" }, { status: 503 })
  }
}
export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin")
    if (origin && new URL(origin).host !== req.headers.get("host")) {
      return NextResponse.json({ ok: false, message: "请求来源无效" }, { status: 403 })
    }
    if (!req.headers.get("content-type")?.startsWith("application/json")) {
      return NextResponse.json({ ok: false, message: "请求类型无效" }, { status: 415 })
    }
    const body: unknown = await req.json()
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => key !== "channel") ||
        !channels.includes((body as { channel: Channel }).channel)) {
      return NextResponse.json({ ok: false, message: "频道无效" }, { status: 400 })
    }
    const selected = (body as { channel: Channel }).channel
    await fetchSignedProductIndex(selected)
    fs.mkdirSync(path.dirname(statePath()), { recursive: true })
    fs.writeFileSync(`${statePath()}.tmp`, JSON.stringify({ channel: selected }))
    fs.renameSync(`${statePath()}.tmp`, statePath())
    return NextResponse.json({ ok: true, data: { channel: selected } })
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "频道切换失败" }, { status: 503 })
  }
}
