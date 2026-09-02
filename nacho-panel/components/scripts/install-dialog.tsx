"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import {
  Check,
  Copy,
  Download,
  DownloadCloud,
  Save,
  ServerCog,
  Tag,
  Terminal,
  X,
} from "lucide-react"
import { defaultServerBaseUrl } from "@/lib/server-connection"

/* 将用户输入的服务器地址规范化：仅填 IP / IP:端口 时自动补全 http:// 协议 */
function normalizeServer(raw: string): string {
  const v = raw.trim()
  if (!v) return "http://<server-address>"
  if (/^https?:\/\//i.test(v)) return v.replace(/\/+$/, "")
  return `http://${v.replace(/\/+$/, "")}`
}

/* 复用脚本中心的字段样式 */
function Field({
  label,
  icon,
  hint,
  children,
}: {
  label: string
  icon?: React.ReactNode
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      {children}
      {hint && <span className="text-xs leading-relaxed text-muted-foreground/70">{hint}</span>}
    </label>
  )
}

const inputCls =
  "h-11 w-full rounded-xl border border-border bg-surface/60 px-4 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:bg-surface"

/* 带复制按钮的命令块 */
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

/* 纯注释/说明块（带序号），无复制按钮 */
function NoteStep({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 px-1">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary">
        {index}
      </span>
      <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
    </div>
  )
}

export function InstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [serverInput, setServerInput] = useState(defaultServerBaseUrl)
  const [enrollmentKey, setEnrollmentKey] = useState("")
  const [savedFlash, setSavedFlash] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  // 入场 / 退场动画：mounted 在退场期间保持挂载，shown 驱动模糊缩放渐显 / 渐隐
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)

  // 挂载 / 卸载：open 关闭时先播放渐隐，过渡结束后再卸载
  useEffect(() => {
    if (open) {
      setMounted(true)
      const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
      window.addEventListener("keydown", onKey)
      return () => window.removeEventListener("keydown", onKey)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), 460)
    return () => clearTimeout(t)
  }, [open, onClose])

  // 揭示：挂载后用双重 rAF 确保模糊帧先绘制，再切到清晰态，保证渐显动画
  useEffect(() => {
    if (!mounted || !open) return
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setShown(true))
    })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
    }
  }, [mounted, open])

  if (!mounted || typeof document === "undefined") return null

  const server = normalizeServer(serverInput)
  const scriptUrl = `${server}/nacho.ps1`

  const flash = () => {
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1600)
  }

  /* 下载控制服务端动态生成的真实 nacho.ps1。 */
  const handleDownload = () => {
    const a = document.createElement("a")
    a.href = scriptUrl
    a.download = "nacho.ps1"
    a.target = "_blank"
    a.rel = "noreferrer"
    a.click()
    flash()
  }

  const copyLink = () => {
    navigator.clipboard?.writeText(scriptUrl)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 1600)
  }

  const keyPrefix = enrollmentKey.trim() ? `$env:NACHO_ENROLLMENT_KEY='${enrollmentKey.trim().replaceAll("'", "''")}'; ` : ""
  const cmdInstall = `${keyPrefix}irm "${scriptUrl}" | iex`
  const cmdWget = `iwr "${scriptUrl}" -OutFile nacho.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File .\\nacho.ps1${enrollmentKey.trim() ? ` -EnrollmentKey '${enrollmentKey.trim().replaceAll("'", "''")}'` : ""}`
  const cmdBoot = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${keyPrefix}irm '${scriptUrl}' | iex"`

  // 通过 Portal 渲染到 body，脱离带 transform 的祖先（页面过渡容器），
  // 否则 fixed 会相对该祖先定位，导致弹窗底部超出视口被裁剪。
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* 遮罩 */}
      <button
        aria-label="关闭"
        onClick={onClose}
        className="fixed inset-0 bg-background/70 backdrop-blur-sm"
        style={{
          opacity: shown ? 1 : 0,
          transition: shown ? "opacity 360ms ease-out" : "opacity 420ms cubic-bezier(0.55,0,0.68,0.4)",
        }}
      />

      {/* 面板 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="客户端安装脚本"
        className="card-glow relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-card"
        style={{
          transform: shown ? "translateY(0) scale(1)" : "translateY(12px) scale(0.97)",
          opacity: shown ? 1 : 0,
          filter: shown ? "blur(0px)" : "blur(8px)",
          // 入场 ease-out 快速就位，退场 ease-in 缓慢起步，让模糊渐隐全程可见
          transition: shown
            ? "transform 460ms cubic-bezier(0.22,1,0.36,1), opacity 460ms ease-out, filter 460ms ease-out"
            : "transform 420ms cubic-bezier(0.55,0,0.68,0.4), opacity 420ms cubic-bezier(0.55,0,0.68,0.4), filter 420ms cubic-bezier(0.55,0,0.68,0.4)",
        }}
      >
        {/* 头部 */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border text-foreground">
              <DownloadCloud className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">客户端安装脚本</h2>
              <p className="mt-1 text-sm text-muted-foreground">下载并配置代理安装 PowerShell 脚本</p>
            </div>
          </div>
          <button
            aria-label="关闭"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {/* PowerShell 安装脚本 卡片 */}
          <div className="rounded-3xl border border-border bg-surface/40 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-primary" />
                <div>
                  <h3 className="text-sm font-semibold">PowerShell 安装脚本</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">在目标 Windows 机器上以管理员身份运行</p>
                </div>
              </div>
              <span className="flex h-7 items-center gap-1.5 rounded-full bg-primary/12 px-3 text-xs font-medium text-primary">
                <Tag className="h-3 w-3" />
                1.0.0
              </span>
            </div>

            {/* 动作按钮 */}
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleDownload}
                className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-95"
              >
                <Download className="h-4 w-4" />
                保存并下载脚本
              </button>
              <button
                type="button"
                onClick={flash}
                className="flex h-11 items-center gap-2 rounded-xl border border-border bg-surface/60 px-5 text-sm font-medium text-foreground transition-colors hover:bg-surface"
              >
                <Save className="h-4 w-4" />
                {savedFlash ? "已保存" : "保存配置"}
              </button>
              <button
                type="button"
                onClick={() => setServerInput(defaultServerBaseUrl())}
                className="flex h-11 items-center gap-2 rounded-xl border border-border bg-surface/60 px-5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
              >
                <ServerCog className="h-4 w-4" />
                使用当前服务端
              </button>
          </div>
        </div>

          {/* 部署命令 */}
          <div className="mt-5">
            <p className="mb-3 px-1 text-xs text-muted-foreground/80">
              安装脚本由当前控制服务端动态生成
            </p>

            <div className="flex flex-col gap-3">
              <NoteStep index={1}>打开 PowerShell（脚本会自动弹 UAC 请求管理员权限）</NoteStep>

              <CommandBlock title="2. PowerShell 一键部署" command={cmdInstall} />

              <CommandBlock title="2a. 强制 menu 菜单模式" command={`& { $env:NACHO_INSTALL_MODE='menu'; ${cmdInstall} }`} />

              <CommandBlock title="3. 下载后执行" command={cmdWget} />

              {/* 5. 一键部署模式 */}
              <div className="rounded-2xl border border-border bg-background/40 p-3">
                <p className="px-1 pb-2 text-xs font-medium text-muted-foreground">
                  4. 一键部署模式
                </p>

                <div className="flex flex-col gap-3">
                  <div className="rounded-xl border border-border bg-surface/60 p-3">
                    <p className="pb-2 text-xs text-muted-foreground">
                      部署链接（与控制服务端共用端口，可分发给自动化系统）
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12.5px] text-foreground">
                        {scriptUrl}
                      </code>
                      <button
                        type="button"
                        onClick={copyLink}
                        className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        {linkCopied ? (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {linkCopied ? "已复制" : "复制链接"}
                      </button>
                    </div>
                  </div>

                  <CommandBlock title="部署执行命令" command={cmdBoot} />
                </div>

                <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground/80">
                  说明：部署脚本、版本清单和 Agent 制品均由当前控制服务端的同一地址与端口提供。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
