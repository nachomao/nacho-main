import net from "node:net"
import { NextResponse } from "next/server"

/**
 * 邮件参数校验接口。
 * 1) 校验必填项与格式（主机、端口、发件人 / 收件人邮箱、加密方式等）；
 * 2) 通过 TCP 连接真实探测 SMTP 主机:端口 的可达性（带超时），
 *    以此判断所填入的邮件服务器参数是否「可用」。
 * 注意：出于安全考虑不会真正发送邮件，仅做格式校验 + 连通性探测。
 */

type Body = {
  host?: string
  port?: number
  encryption?: "none" | "ssl" | "tls"
  username?: string
  password?: string
  from?: string
  to?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function probeTcp(host: string, port: number, timeoutMs = 5000) {
  return new Promise<{ ok: boolean; ms: number; error?: string }>((resolve) => {
    const started = Date.now()
    const socket = new net.Socket()
    let settled = false

    const done = (ok: boolean, error?: string) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ ok, ms: Date.now() - started, error })
    }

    socket.setTimeout(timeoutMs)
    socket.once("connect", () => done(true))
    socket.once("timeout", () => done(false, "连接超时"))
    socket.once("error", (err: NodeJS.ErrnoException) => done(false, err.code || err.message))
    socket.connect(port, host)
  })
}

export async function POST(request: Request) {
  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, message: "请求体解析失败" }, { status: 400 })
  }

  const { host, port, encryption = "tls", username, password, from, to } = body
  const errors: string[] = []

  if (!host || !host.trim()) errors.push("SMTP 服务器地址不能为空")
  if (!port || port < 1 || port > 65535) errors.push("端口号必须在 1–65535 之间")
  if (!username || !username.trim()) errors.push("SMTP 用户名不能为空")
  if (!password) errors.push("SMTP 密码 / 授权码不能为空")
  if (!from || !EMAIL_RE.test(from)) errors.push("发件人邮箱格式不正确")
  if (to && !EMAIL_RE.test(to)) errors.push("测试收件人邮箱格式不正确")

  // 端口与加密方式的常见搭配提示
  const warnings: string[] = []
  if (port === 465 && encryption !== "ssl") warnings.push("端口 465 通常应使用 SSL 加密")
  if (port === 587 && encryption !== "tls") warnings.push("端口 587 通常应使用 STARTTLS(TLS) 加密")
  if (port === 25 && encryption === "ssl") warnings.push("端口 25 一般不使用 SSL")

  if (errors.length > 0) {
    return NextResponse.json({ ok: false, stage: "validate", errors, warnings }, { status: 200 })
  }

  // 连通性探测
  const probe = await probeTcp(host!.trim(), Number(port))
  if (!probe.ok) {
    return NextResponse.json(
      {
        ok: false,
        stage: "connect",
        errors: [`无法连接到 ${host}:${port}（${probe.error ?? "未知错误"}）`],
        warnings,
        latencyMs: probe.ms,
      },
      { status: 200 },
    )
  }

  return NextResponse.json({
    ok: true,
    stage: "connect",
    message: `已成功连接到 ${host}:${port}，邮件服务器参数可用`,
    warnings,
    latencyMs: probe.ms,
  })
}
