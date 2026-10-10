"use client"

import { useState } from "react"
import { KeyRound, RefreshCw, ShieldAlert } from "lucide-react"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { useOnboarding } from "./onboarding-context"

export function CredentialRecovery() {
  const { recoveryError, retryRecovery, reinitializeCredentials } = useOnboarding()
  const { promptText } = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function retry() {
    setBusy(true)
    setError(null)
    try { await retryRecovery() }
    finally { setBusy(false) }
  }
  async function reinitialize() {
    if (await promptText({
      title: "备份并重新初始化本机凭据？",
      description: "原始密文会保留为备份。当前面板的连接及登录方式需要重新设置；用户名、主题与 Linux 服务端数据保持原样。",
      label: "请输入「重新初始化」确认", requireValue: "重新初始化",
      confirmLabel: "备份并重新初始化", tone: "warning",
    }) !== "重新初始化") return
    setBusy(true)
    try { await reinitializeCredentials() }
    catch { setError("重新初始化未完成，原记录仍保留。请重试。"); setBusy(false) }
  }
  return (
    <div className="electron-no-drag flex h-full w-full items-center justify-center overflow-y-auto p-5 sm:p-8">
      <section aria-labelledby="credential-recovery-title" className="w-full max-w-xl rounded-3xl border border-border bg-card p-6 sm:p-8">
        <ShieldAlert className="mb-5 size-10 text-warning" aria-hidden="true" />
        <h1 id="credential-recovery-title" className="text-xl font-semibold">本地凭据需要恢复</h1>
        <p role="alert" className="mt-3 text-sm leading-6 text-muted-foreground">
          {recoveryError?.message || "当前加密记录尚未完成恢复。"}
        </p>
        <p className="mt-2 break-words font-mono text-xs text-muted-foreground">诊断代码：{recoveryError?.code || "read-failed"}</p>
        <div className="mt-5 rounded-xl bg-surface p-4 text-sm leading-6 text-muted-foreground">
          <p>原记录保持保留，面板不会自动解锁或重新播放首次引导。</p>
          <p className="mt-2">请先恢复此 Windows 用户下原有的加密上下文，再重试读取。此次恢复仅处理本机记录，不会连接 SSH 或改动服务端。</p>
        </div>
        {error && <p role="status" className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button type="button" autoFocus disabled={busy} onClick={() => void retry()}
            className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
            <RefreshCw className="size-4" aria-hidden="true" />{busy ? "正在处理…" : "重试读取凭据"}
          </button>
          <button type="button" disabled={busy} onClick={() => void reinitialize()}
            className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground disabled:opacity-50">
            <KeyRound className="size-4" aria-hidden="true" />备份并重新初始化
          </button>
        </div>
      </section>
    </div>
  )
}
