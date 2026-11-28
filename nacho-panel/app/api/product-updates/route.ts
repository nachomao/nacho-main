import { NextResponse } from "next/server"

export function GET() {
  return NextResponse.json({ ok: false, message: "使用 Windows 桌面版直接检查 GitHub 更新。" }, { status: 410 })
}
