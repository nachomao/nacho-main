import { NextResponse } from "next/server"
import { cachedSignedProductIndex, fetchSignedProductIndex } from "@/lib/signed-product-index"

export const runtime = "nodejs"

export async function GET() {
  try {
    const index = await fetchSignedProductIndex()
    return NextResponse.json({ ok: true, data: { index, stale: false, currentVersion: null } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "检查更新失败"
    const cached = /HTTP|fetch|网络|超时|timed out|abort/i.test(message) ? cachedSignedProductIndex() : null
    if (cached) return NextResponse.json({ ok: true, data: { index: cached, stale: true, currentVersion: null } })
    return NextResponse.json({ ok: false, message }, { status: 503 })
  }
}

/** 保留明确的旧面板迁移响应，不再保存本地频道选择。 */
export async function POST() {
  return NextResponse.json({ ok: false, message: "更新类型由更新服务器决定，请升级面板" }, { status: 409 })
}
