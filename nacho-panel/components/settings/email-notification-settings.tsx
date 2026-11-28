"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Mail, XCircle } from "lucide-react"
import { useServerData } from "@/components/server-data-context"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"
import { EMAIL_ADDRESS, emailTestBlockReason, getEmailAuthorizationUrl, readEmailStatus, type EmailAttempt, type EmailProvider, type EmailStatus } from "./email-settings"
import { NumberStepper, SettingCard, SettingRow, TextField, Toggle } from "./primitives"
import type { EmailSettings } from "./settings-data"

export type EmailNotificationSettingsProps = {
  value: EmailSettings
  saved: EmailSettings
  dirty: boolean
  status: EmailStatus | null
  unavailable: string | null
  saving: boolean
  refreshStatus?: () => Promise<void>
  refreshMailState: () => Promise<void>
  onStatusUpdate: (status: EmailStatus) => void
  onChange: (patch: Partial<EmailSettings>) => void
}

const PROVIDER_NAMES = { gmail: "Gmail", outlook: "Outlook" } as const
const MODES = [{ id: "smtp", label: "SMTP" }, { id: "gmail", label: "Gmail" }, { id: "outlook", label: "Outlook" }] as const
const TLS_MODES = [{ id: "ssl", label: "TLS" }, { id: "tls", label: "STARTTLS" }] as const
const mainButton = "inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
const lightButton = "inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"

type Feedback = { tone: "positive" | "warning" | "negative"; message: string }
type PendingAuthorization = { id: string; provider: EmailProvider; url: string; expiresAt: number }

function authorizationFeedback(provider: EmailProvider, attempt: EmailAttempt): Feedback {
  const name = PROVIDER_NAMES[provider]
  switch (attempt.state) {
    case "connected": return { tone: "positive", message: `${name} 邮箱已授权。` }
    case "canceled": return { tone: "warning", message: `${name} 授权已取消，可重新发起。` }
    case "expired": return { tone: "warning", message: `${name} 授权已过期，请重新发起。` }
    default: return { tone: "negative", message: attempt.message || `${name} 授权未完成，请重新发起。` }
  }
}

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  const Icon = feedback.tone === "positive" ? CheckCircle2 : feedback.tone === "warning" ? AlertTriangle : XCircle
  return (
    <div role="status" className={cn("flex items-start gap-2 rounded-xl border px-4 py-3 text-sm break-words", {
      "border-primary/30 bg-primary/10 text-primary": feedback.tone === "positive",
      "border-warning/30 bg-warning/10 text-warning": feedback.tone === "warning",
      "border-negative/40 bg-negative/10 text-negative": feedback.tone === "negative",
    })}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0">{feedback.message}</span>
    </div>
  )
}

export function EmailNotificationSettings({ value, saved, dirty, status, unavailable, saving, refreshStatus, refreshMailState, onStatusUpdate, onChange }: EmailNotificationSettingsProps) {
  const { apiRequest } = useServerData()
  const { confirm } = useConfirm()
  const mounted = useRef(false)
  const operation = useRef<symbol | null>(null)
  const [busy, setBusy] = useState<"authorize" | "disconnect" | "test" | null>(null)
  const [pending, setPending] = useState<PendingAuthorization | null>(null)
  const [pollError, setPollError] = useState(false)
  const [authFeedback, setAuthFeedback] = useState<Feedback | null>(null)
  const [testFeedback, setTestFeedback] = useState<Feedback | null>(null)
  const canConfigure = status?.configurable === true

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; operation.current = null }
  }, [])

  useEffect(() => {
    // 换服务端时，上一连接的授权请求与结果都不随面板会话迁移。
    operation.current = null
    setBusy(null)
    setPending(null)
    setPollError(false)
    setAuthFeedback(null)
    setTestFeedback(null)
  }, [apiRequest])

  useEffect(() => {
    if (!pending || !canConfigure) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const { id: attemptId, expiresAt, provider } = pending
    async function poll() {
      if (controller.signal.aborted) return
      if (Date.now() >= expiresAt) {
        setPending(null)
        setPollError(false)
        setAuthFeedback({ tone: "warning", message: "授权等待已超时，请刷新状态后重试。" })
        void refreshStatus?.()
        return
      }
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)])
        const result = readEmailStatus(await apiRequest<unknown>(`/email/status?attemptId=${encodeURIComponent(attemptId)}`, { signal, redirect: "error" }))
        if (controller.signal.aborted) return
        const attempt = result?.attempt
        if (!result || !attempt || attempt.id !== attemptId) throw new Error()
        setPollError(false)
        onStatusUpdate(result)
        if (attempt.state !== "pending") {
          setPending(null)
          setAuthFeedback(authorizationFeedback(provider, attempt))
          void refreshMailState()
          return
        }
      } catch {
        if (controller.signal.aborted) return
        setPollError(true)
      }
      timer = setTimeout(() => void poll(), 2_000)
    }
    timer = setTimeout(() => void poll(), 1_000)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [apiRequest, canConfigure, onStatusUpdate, pending, refreshMailState, refreshStatus])

  const startOperation = (kind: typeof busy) => {
    if (operation.current || !canConfigure || saving) return null
    const token = Symbol()
    operation.current = token
    setBusy(kind)
    return token
  }

  const isCurrent = (token: symbol) => mounted.current && operation.current === token

  const endOperation = (token: symbol) => {
    if (!isCurrent(token)) return
    operation.current = null
    setBusy(null)
  }

  const beginAuthorization = async (provider: EmailProvider) => {
    if (pending || !status?.providers[provider].available) return
    const token = startOperation("authorize")
    if (!token) return
    setAuthFeedback(null)
    setTestFeedback(null)
    try {
      const start = await apiRequest<{ authorizationUrl?: unknown; attemptId?: unknown } | null>(`/email/oauth/${provider}`, { method: "POST", redirect: "error" })
      if (!isCurrent(token)) return
      const url = getEmailAuthorizationUrl(provider, start?.authorizationUrl)
      if (!url || typeof start?.attemptId !== "string" || !start.attemptId) throw new Error("服务端没有返回有效的授权入口，请更新服务端并重试。")
      setPollError(false)
      setPending({ id: start.attemptId, provider, url, expiresAt: Date.now() + 11 * 60_000 })
      if (window.nachoEmailOAuth) {
        try { await window.nachoEmailOAuth.openBrowser(provider, url) }
        catch {
          if (isCurrent(token)) setAuthFeedback({ tone: "warning", message: "未能打开系统浏览器。请点击下方按钮重试。" })
        }
      }
    } catch (error) {
      if (isCurrent(token)) setAuthFeedback({ tone: "negative", message: error instanceof Error ? error.message : "无法发起邮箱授权，请重试。" })
    } finally {
      endOperation(token)
    }
  }

  const disconnect = async (provider: EmailProvider) => {
    if (pending) return
    const token = startOperation("disconnect")
    if (!token) return
    try {
      const accepted = await confirm({ title: `解除 ${PROVIDER_NAMES[provider]} 绑定？`, description: "这会删除 Nacho 保存的账号授权，不会修改邮箱账户。需要重新授权后才能继续通过它发送邮件。", confirmLabel: "解除本地绑定", tone: "warning" })
      if (!accepted || !isCurrent(token)) return
      setAuthFeedback(null)
      setTestFeedback(null)
      await apiRequest(`/email/oauth/${provider}`, { method: "DELETE", redirect: "error" })
      if (!isCurrent(token)) return
      await refreshMailState()
      if (isCurrent(token)) setAuthFeedback({ tone: "positive", message: `${PROVIDER_NAMES[provider]} 的本地绑定已解除。` })
    } catch (error) {
      if (isCurrent(token)) setAuthFeedback({ tone: "negative", message: error instanceof Error ? error.message : "解除绑定失败，请重试。" })
    } finally {
      endOperation(token)
    }
  }

  const runTest = async () => {
    if (!status || pending || emailTestBlockReason(saved, status, dirty)) return
    const token = startOperation("test")
    if (!token) return
    setTestFeedback(null)
    try {
      // 仅让服务端使用已保存的收件人与发送配置，不随测试请求传输表单或凭据。
      const result = await apiRequest<{ status: string } | null>("/email/test", { method: "POST", redirect: "error", signal: AbortSignal.timeout(45_000) })
      if (!isCurrent(token)) return
      if (result?.status !== "accepted") throw new Error("未能确认发送服务是否受理。请先查收，再决定是否重试。")
      setTestFeedback({ tone: "positive", message: "发送服务已受理测试邮件，不代表已投递；请检查收件箱和垃圾邮件。" })
    } catch (error) {
      if (!isCurrent(token)) return
      const detail = error instanceof Error ? error.message : ""
      setTestFeedback({ tone: "negative", message: !detail || detail.startsWith("连接服务端失败")
        ? "连接中断，未能确认发送服务是否受理。请先查收，再决定是否重试。"
        : detail })
      await refreshMailState()
    } finally {
      endOperation(token)
    }
  }

  const change = (patch: Partial<EmailSettings>) => {
    setTestFeedback(null)
    onChange(patch)
  }

  const toInvalid = !!value.to.trim() && !EMAIL_ADDRESS.test(value.to.trim())
  const fromInvalid = !!value.from.trim() && !EMAIL_ADDRESS.test(value.from.trim())
  const transportChanged = value.host !== saved.host || value.port !== saved.port || value.username !== saved.username || value.encryption !== saved.encryption
  const provider = value.mode === "smtp" ? null : value.mode
  const providerStatus = provider && status?.providers[provider]
  const testBlock = status ? emailTestBlockReason(saved, status, dirty) : null
  const interactionDisabled = saving || busy !== null

  return (
    <SettingCard title="邮件通知" desc="选用手动 SMTP 或授权邮箱发信；测试和告警使用同一个收件人" icon={<Mail className="h-5 w-5" />}
      action={canConfigure && <fieldset disabled={interactionDisabled}><Toggle checked={value.enabled} onChange={(enabled) => change({ enabled })} label="启用邮件告警" /></fieldset>}>
      {!canConfigure ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span role="status">{unavailable || "正在读取服务端邮件配置…"}</span>
          {unavailable && refreshStatus && <button type="button" className={lightButton} onClick={() => void refreshStatus()}>重试检查</button>}
        </div>
      ) : (
        <>
          <SettingRow label="发送方式" hint="切换发送方式不会删除已保存的其他邮箱凭据。">
            <fieldset disabled={interactionDisabled || pending !== null} className="flex min-w-0 flex-wrap items-center gap-1 rounded-full border border-border bg-surface/60 p-1">
              {MODES.map((mode) => <button type="button" key={mode.id} aria-pressed={value.mode === mode.id} onClick={() => { setAuthFeedback(null); change({ mode: mode.id }) }} className={cn("h-8 rounded-full px-3 text-xs font-medium transition-colors disabled:opacity-70", value.mode === mode.id ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground")}>{mode.label}</button>)}
            </fieldset>
          </SettingRow>
          <fieldset disabled={interactionDisabled} className="min-w-0">
            {value.mode === "smtp" && (
              <>
                {value.encryption === "none" && <FeedbackLine feedback={{ tone: "warning", message: "这是旧的无加密 SMTP 配置。请迁移到 TLS 或 STARTTLS，填写新的密码或授权码后保存。" }} />}
                <div className="grid grid-cols-1 gap-4 border-t border-border py-4 sm:grid-cols-3">
                  <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2"><label htmlFor="smtp-host" className="text-sm font-medium">SMTP 服务器</label><TextField id="smtp-host" value={value.host} onChange={(host) => change({ host })} placeholder="smtp.qq.com 或 smtp.163.com" /></div>
                  <div className="flex min-w-0 flex-col gap-1.5"><label htmlFor="smtp-port" className="text-sm font-medium">端口</label><NumberStepper id="smtp-port" value={value.port} onChange={(port) => change({ port })} min={1} max={65535} className="w-full" /></div>
                </div>
                <SettingRow label="传输加密" hint="通常使用 465（TLS）或 587（STARTTLS），请以邮箱服务商要求为准。">
                  <div className="flex flex-wrap items-center gap-1 rounded-full border border-border bg-surface/60 p-1">
                    {TLS_MODES.map((mode) => <button type="button" key={mode.id} aria-pressed={value.encryption === mode.id} onClick={() => change({ encryption: mode.id })} className={cn("h-8 rounded-full px-3 text-xs font-medium transition-colors disabled:opacity-70", value.encryption === mode.id ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground")}>{mode.label}</button>)}
                  </div>
                </SettingRow>
                <div className="grid grid-cols-1 gap-4 border-t border-border py-4 sm:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-1.5"><label htmlFor="smtp-user" className="text-sm font-medium">用户名</label><TextField id="smtp-user" value={value.username} onChange={(username) => change({ username })} placeholder="notify@example.com" /></div>
                  <div className="flex min-w-0 flex-col gap-1.5"><label htmlFor="smtp-pass" className="text-sm font-medium">密码 / 授权码</label><TextField id="smtp-pass" type="password" value={value.password} onChange={(password) => change({ password })} placeholder={status?.hasPassword && !transportChanged ? "已保存，留空不更改" : "输入密码或邮箱授权码"} />
                    {transportChanged && <p className="text-xs text-muted-foreground">SMTP 主机、端口、加密方式或用户名更改后，请重新填写密码或授权码。</p>}
                  </div>
                </div>
              </>
            )}
            <div className={cn("grid grid-cols-1 gap-4 border-t border-border py-4", value.mode === "smtp" && "sm:grid-cols-2")}>
              {value.mode === "smtp" && <div className="flex min-w-0 flex-col gap-1.5"><label htmlFor="smtp-from" className="text-sm font-medium">发件人邮箱</label><TextField id="smtp-from" value={value.from} onChange={(from) => change({ from })} placeholder="notify@example.com" invalid={fromInvalid} />{fromInvalid && <span className="text-xs text-negative">邮箱格式不正确</span>}</div>}
              <div className="flex min-w-0 flex-col gap-1.5"><label htmlFor="email-recipient" className="text-sm font-medium">收件人邮箱</label><TextField id="email-recipient" value={value.to} onChange={(to) => change({ to })} placeholder="admin@example.com" invalid={toInvalid} />{toInvalid && <span className="text-xs text-negative">邮箱格式不正确</span>}</div>
            </div>
          </fieldset>
          {provider && providerStatus && (
            <div className="flex flex-col gap-3 border-t border-border py-4">
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                <span className="font-medium">{PROVIDER_NAMES[provider]} 邮箱：{providerStatus.state === "connected" ? "已授权" : providerStatus.state === "reauthorize" ? "需重新授权" : "未授权"}</span>
                {providerStatus.account && <span className="break-all text-muted-foreground">{providerStatus.account}</span>}
                {!providerStatus.available && <span className="text-muted-foreground">服务端尚未配置此邮箱的 OAuth。可请管理员配置，或使用手动 SMTP。</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={mainButton} disabled={interactionDisabled || pending !== null || !providerStatus.available} onClick={() => void beginAuthorization(provider)}><ExternalLink className="h-4 w-4" />{providerStatus.state === "disconnected" ? "连接邮箱" : "重新授权"}</button>
                {providerStatus.state !== "disconnected" && <button type="button" className={lightButton} disabled={interactionDisabled || pending !== null} onClick={() => void disconnect(provider)}>解除本地绑定</button>}
              </div>
              {pending && (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface/60 p-3">
                  <span role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 shrink-0 animate-spin" />正在等待 {PROVIDER_NAMES[pending.provider]} 授权…</span>
                  <span className="text-xs text-muted-foreground">{pollError ? "暂时未能查询授权状态，正在重试。" : "请在浏览器中完成授权，然后回到这里。"}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {typeof window !== "undefined" && window.nachoEmailOAuth ? (
                      <button type="button" className={lightButton} onClick={() => void window.nachoEmailOAuth?.openBrowser(pending.provider, pending.url).catch(() => setAuthFeedback({ tone: "warning", message: "未能打开系统浏览器，请检查浏览器设置后重试。" }))}><ExternalLink className="h-4 w-4" />打开系统浏览器</button>
                    ) : (
                      <a className={lightButton} href={pending.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" />在浏览器新标签页授权</a>
                    )}
                    <button type="button" className={lightButton} onClick={() => { setPending(null); setPollError(false); setAuthFeedback({ tone: "warning", message: "已停止等待。若浏览器授权页仍开着，请在该页面取消或关闭它。" }); void refreshStatus?.() }}>停止等待</button>
                  </div>
                </div>
              )}
              {authFeedback && <FeedbackLine feedback={authFeedback} />}
            </div>
          )}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={mainButton} disabled={interactionDisabled || pending !== null || testBlock !== null} onClick={() => void runTest()}>{busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}{busy === "test" ? "正在发送…" : "发送测试邮件"}</button>
              <p className="text-xs text-muted-foreground">{testBlock || "从控制服务端真实发信；关闭告警时也可以测试。"}</p>
            </div>
            {testFeedback && <FeedbackLine feedback={testFeedback} />}
          </div>
        </>
      )}
    </SettingCard>
  )
}
