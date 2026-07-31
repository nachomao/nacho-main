"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, Copy, KeyRound, Loader2, MonitorSmartphone, Plus, RefreshCw, Tag, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { useServerData } from "@/components/server-data-context"
import { ModalShell, OverlayHeader } from "./overlay"

type OS = "Windows" | "Linux" | "macOS"

/** 生成一个接入密钥（仅演示：随机 24 位十六进制） */
function makeToken(): string {
  const chars = "abcdef0123456789"
  let t = ""
  for (let i = 0; i < 24; i++) t += chars[Math.floor(Math.random() * chars.length)]
  return t
}

/** 带复制按钮的命令块（沿用脚本中心样式） */
function CommandBlock({ title, command }: { title: string; command: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(command)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className="rounded-2xl border border-border bg-background/40 p-3">
      <p className="px-1 pb-2 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="flex items-start gap-2 rounded-xl border border-border bg-surface/60 p-3">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12.5px] leading-relaxed text-foreground">
          {command}
        </pre>
        <button
          type="button"
          onClick={copy}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "已复制" : "复制命令"}
        </button>
      </div>
    </div>
  )
}

const inputCls =
  "h-11 w-full rounded-xl border border-border bg-surface/60 px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:bg-surface"

/**
 * 添加客户端向导：填写名称/分组/系统 → 生成接入密钥与一键接入命令，
 * 复制到目标设备执行即可完成接入。
 */
export function AddClientDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { groups, apiRequest, refresh } = useServerData()
  const [name, setName] = useState("")
  const [group, setGroup] = useState("")
  const [os, setOs] = useState<OS>("Linux")
  const [token, setToken] = useState(makeToken)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!group && groups[0]) setGroup(groups[0])
  }, [group, groups])

  const displayName = name.trim() || "新客户端"

  const command = useMemo(() => {
    const base = `http://<server-address>`
    if (os === "Windows")
      return `powershell -ep bypass -c "iwr '${base}/api/agent/join?token=${token}&name=${encodeURIComponent(displayName)}' | iex"`
    return `curl -fsSL "${base}/api/agent/join?token=${token}&name=${encodeURIComponent(displayName)}" | sudo bash`
  }, [os, token, displayName])

  const copyToken = () => {
    navigator.clipboard?.writeText(token)
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 1600)
  }

  async function saveClient() {
    if (saving || !name.trim()) return
    setSaving(true)
    setError("")
    try {
      await apiRequest("/clients", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), hostname: name.trim(), os, group: group || undefined }),
      })
      await refresh()
      setName("")
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存客户端失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} label="添加客户端" maxWidth="max-w-xl">
      <OverlayHeader
        icon={<UserPlus className="h-5 w-5" />}
        title="添加客户端"
        desc="生成接入密钥与一键命令，在目标设备上执行即可接入"
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
        <div className="flex flex-col gap-4">
          {/* 基本信息 */}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <MonitorSmartphone className="h-3.5 w-3.5" />
                客户端名称
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：核心服务器 02"
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Tag className="h-3.5 w-3.5" />
                所属分组
              </span>
              <select value={group} onChange={(e) => setGroup(e.target.value)} className={cn(inputCls, "appearance-none")}>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* 操作系统 */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">操作系统</span>
            <div className="flex gap-2">
              {(["Linux", "Windows", "macOS"] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOs(o)}
                  aria-pressed={os === o}
                  className={cn(
                    "flex h-10 flex-1 items-center justify-center rounded-xl border text-sm font-medium transition-colors",
                    os === o
                      ? "border-primary/50 bg-primary/12 text-primary"
                      : "border-border bg-surface/60 text-muted-foreground hover:bg-surface hover:text-foreground",
                  )}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>

          {/* 接入密钥 */}
          <div className="rounded-2xl border border-border bg-surface/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5" />
                接入密钥（单次有效）
              </span>
              <button
                type="button"
                onClick={() => setToken(makeToken())}
                className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <RefreshCw className="h-3 w-3" />
                重新生成
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-border bg-background/50 px-3 py-2.5 font-mono text-[13px] text-primary">
                {token}
              </code>
              <button
                type="button"
                onClick={copyToken}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {tokenCopied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                {tokenCopied ? "已复制" : "复制"}
              </button>
            </div>
          </div>

          {/* 一键接入命令 */}
          <CommandBlock
            title={os === "Windows" ? "在目标设备的 PowerShell（管理员）中执行" : "在目标设备的终端中执行"}
            command={command}
          />

          <p className="px-1 text-xs leading-relaxed text-muted-foreground/70">
            设备执行命令后会自动下载代理并使用该密钥注册到「{group}」分组，接入成功后将出现在客户端列表中。
          </p>
        </div>
      </div>

      {/* 底部动作 */}
      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border p-4 sm:px-6">
        {error && <p className="mr-auto text-xs text-negative">{error}</p>}
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 items-center gap-2 rounded-xl border border-border bg-surface/60 px-5 text-sm font-medium text-foreground transition-colors hover:bg-surface"
        >
          稍后接入
        </button>
        <button
          type="button"
          onClick={() => void saveClient()}
          disabled={saving || !name.trim()}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          保存客户端
        </button>
      </div>
    </ModalShell>
  )
}
