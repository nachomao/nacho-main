"use client"

import { useState } from "react"
import { AlertCircle, ArrowRight, Check, Copy, Fingerprint, Loader2, ServerCog, ShieldCheck } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
type DeploymentResult = { api: string; key: string }
type DeployEvent = { type: "progress"; step: string } | { type: "complete"; data: DeploymentResult } | { type: "error"; message: string }

async function readResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as { ok?: boolean; data?: T; message?: string } | null
  if (!response.ok || !body?.ok || !body.data) throw new Error(body?.message || `请求失败（HTTP ${response.status}）`)
  return body.data
}

export function CloudDeployForm({ onConnected }: { onConnected: (source: { mode: "cloud"; api: string; key: string }) => void }) {
  const [host, setHost] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [fingerprint, setFingerprint] = useState("")
  const [busy, setBusy] = useState<"inspect" | "deploy" | "verify" | null>(null)
  const [step, setStep] = useState("")
  const [error, setError] = useState("")
  const [result, setResult] = useState<DeploymentResult | null>(null)
  const [copied, setCopied] = useState(false)

  const inspect = async () => {
    if (busy || !host.trim()) return
    setBusy("inspect")
    setError("")
    setFingerprint("")
    try {
      const fingerprint = await readResponse<{ fingerprint: string }>(await fetch("/api/cloud-deployment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inspect", host: host.trim() }),
      }))
      setFingerprint(fingerprint.fingerprint)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取 SSH 主机指纹失败")
    } finally {
      setBusy(null)
    }
  }

  const verify = async (deployment: DeploymentResult) => {
    setBusy("verify")
    setError("")
    try {
      const response = await fetch(`${deployment.api}/api/panel/overview`, {
        headers: { Authorization: `Bearer ${deployment.key}` },
        signal: AbortSignal.timeout(8_000),
      })
      const body: unknown = await response.json()
      if (!response.ok || !body || typeof body !== "object" || (body as { ok?: unknown }).ok !== true || typeof (body as { data?: unknown }).data !== "object" || (body as { data?: unknown }).data === null) {
        throw new Error("服务端响应异常")
      }
      onConnected({ mode: "cloud", api: deployment.api, key: deployment.key })
    } catch {
      setError("服务已部署，但浏览器暂时无法访问 API。请检查服务器 8443 端口、防火墙及浏览器的 HTTP/HTTPS 限制，再重试验证。")
    } finally {
      setBusy(null)
    }
  }

  const deploy = async () => {
    if (busy || !fingerprint || !username.trim() || !password || result) return
    setBusy("deploy")
    setError("")
    setStep("正在连接已核对的 SSH 主机")
    try {
      const response = await fetch("/api/cloud-deployment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deploy", host: host.trim(), username: username.trim(), password, fingerprint }),
      })
      if (!response.ok || !response.body) {
        await readResponse(response)
        throw new Error("服务器未返回部署进度")
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let installed: DeploymentResult | null = null
      const consume = (line: string) => {
        if (!line.trim()) return
        const event = JSON.parse(line) as DeployEvent
        if (event.type === "progress") setStep(event.step)
        if (event.type === "error") throw new Error(event.message)
        if (event.type === "complete") installed = event.data
      }
      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""
        for (const line of lines) consume(line)
        if (done) break
      }
      consume(buffer)
      if (!installed) throw new Error("部署连接已结束，但未收到服务端确认")
      setPassword("")
      setResult(installed)
      await verify(installed)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "云端部署失败")
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="flex flex-col gap-5" aria-label="自动部署 Linux 控制服务">
      <div className="flex items-start gap-3 rounded-2xl border border-border/50 bg-background/25 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/5 text-foreground">
          <ServerCog className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">部署到你的 Linux 服务器</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">适用于全新 Ubuntu、Debian、CentOS、RHEL、Rocky、AlmaLinux 或 Fedora。自动传输当前版本、安装依赖并启动 systemd 服务。</p>
        </div>
      </div>

      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="deploy-host" className="text-xs">服务器 IPv4 地址</FieldLabel>
          <Input id="deploy-host" inputMode="decimal" placeholder="203.0.113.10" autoComplete="off" value={host} disabled={busy !== null || !!result} onChange={(event) => { setHost(event.target.value); setFingerprint(""); setError("") }} className="h-11 rounded-xl border-border/55 bg-background/30 font-mono shadow-none" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="deploy-user" className="text-xs">SSH 用户名</FieldLabel>
            <Input id="deploy-user" placeholder="root" autoComplete="username" value={username} disabled={busy !== null || !!result} onChange={(event) => setUsername(event.target.value)} className="h-11 rounded-xl border-border/55 bg-background/30 shadow-none" />
          </Field>
          <Field>
            <FieldLabel htmlFor="deploy-password" className="text-xs">SSH 密码</FieldLabel>
            <Input id="deploy-password" type="password" placeholder="输入登录密码" autoComplete="off" value={password} disabled={busy !== null || !!result} onChange={(event) => setPassword(event.target.value)} className="h-11 rounded-xl border-border/55 bg-background/30 shadow-none" />
          </Field>
        </div>
        <FieldDescription className="text-xs">非 root 用户需可用相同密码执行 sudo。SSH 密码只用于本次部署，不会保存；Panel API Key 在连接成功后按原流程保存。</FieldDescription>
      </FieldGroup>

      {!result && (
        <div className="flex flex-col">
          <div className="cloud-deploy-step" data-open={!fingerprint} aria-hidden={!!fingerprint} inert={!!fingerprint}>
            <div className="min-h-0 overflow-hidden">
              <Button type="button" variant="outline" size="lg" disabled={!host.trim() || busy !== null} onClick={() => void inspect()} className="h-11 w-full rounded-xl focus-visible:ring-inset">
                {busy === "inspect" ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <Fingerprint data-icon="inline-start" aria-hidden="true" />}
                {busy === "inspect" ? "正在读取主机指纹" : "检查服务器身份"}
              </Button>
            </div>
          </div>
          <div className="cloud-deploy-step" data-open={!!fingerprint} aria-hidden={!fingerprint} inert={!fingerprint}>
            <div className="min-h-0 overflow-hidden">
              <div className="flex flex-col gap-5">
                <Alert className="border-border/55 bg-background/20">
                  <Fingerprint aria-hidden="true" />
                  <AlertTitle>核对服务器身份</AlertTitle>
                  <AlertDescription className="flex flex-col gap-2">
                    <span>请与服务器控制台提供的 SSH 主机指纹核对，确认一致后再部署。若指纹变化，部署会自动中止。</span>
                    <code className="break-all rounded-lg bg-background/50 px-2.5 py-2 font-mono text-xs text-foreground" aria-label="SSH 主机 SHA256 指纹">{fingerprint}</code>
                  </AlertDescription>
                </Alert>
                <Button type="button" variant="outline" size="lg" disabled={!username.trim() || !password || busy !== null} onClick={() => void deploy()} className="h-11 w-full rounded-xl focus-visible:ring-inset">
                  {busy === "deploy" ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <ShieldCheck data-icon="inline-start" aria-hidden="true" />}
                  {busy === "deploy" ? "正在自动部署，请保持页面打开" : "指纹一致，开始部署"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">{busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}{step}</p>}
      {error && (
        <Alert variant="destructive" className="border-destructive/25 bg-destructive/5" aria-live="polite">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{result ? "服务已安装，连接待验证" : "云端部署未完成"}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {result && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border/50 bg-background/20 p-4">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground"><Check className="size-4" aria-hidden="true" />服务已部署至 {result.api}</span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void verify(result)}>
              {busy === "verify" ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <ArrowRight data-icon="inline-start" aria-hidden="true" />}
              {busy === "verify" ? "正在验证连接" : "重试验证并继续"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(result.key).then(() => setCopied(true)).catch(() => setError("复制失败，请检查剪贴板权限")) }}>
              <Copy data-icon="inline-start" aria-hidden="true" />{copied ? "已复制 API Key" : "复制 API Key"}
            </Button>
          </div>
        </div>
      )}
      <p className="text-xs leading-5 text-muted-foreground">默认通过 HTTP 监听 8443 端口。跨公网长期使用前，请为服务端配置 HTTPS 并限制网络访问。</p>
    </section>
  )
}
