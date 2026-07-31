"use client"

import { useState } from "react"
import {
  Mail,
  BellRing,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  WifiOff,
  CircleX,
  Cpu,
  MemoryStick,
  HardDrive,
  MoonStar,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { SettingCard, SettingRow, Toggle, TextField, NumberStepper, ThresholdSlider } from "./primitives"
import type { EmailSettings, NotifyConditions } from "./settings-data"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type TestResult =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; message: string; latencyMs?: number; warnings?: string[] }
  | { status: "error"; errors: string[]; warnings?: string[] }

function EmailBlock({
  value,
  onChange,
}: {
  value: EmailSettings
  onChange: (patch: Partial<EmailSettings>) => void
}) {
  const [result, setResult] = useState<TestResult>({ status: "idle" })

  const fromInvalid = value.from.length > 0 && !EMAIL_RE.test(value.from)
  const toInvalid = value.to.length > 0 && !EMAIL_RE.test(value.to)

  const runTest = async () => {
    setResult({ status: "testing" })
    try {
      const res = await fetch("/api/settings/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      })
      const data = await res.json()
      if (data.ok) {
        setResult({ status: "ok", message: data.message, latencyMs: data.latencyMs, warnings: data.warnings })
      } else {
        setResult({ status: "error", errors: data.errors ?? ["校验失败"], warnings: data.warnings })
      }
    } catch {
      setResult({ status: "error", errors: ["请求失败，请检查服务端是否正常运行"] })
    }
  }

  const encryptionOptions: { id: EmailSettings["encryption"]; label: string }[] = [
    { id: "none", label: "无" },
    { id: "ssl", label: "SSL" },
    { id: "tls", label: "STARTTLS" },
  ]

  return (
    <SettingCard
      title="邮件通知"
      desc="配置 SMTP 服务器，用于发送告警与通知邮件"
      icon={<Mail className="h-5 w-5" />}
      action={<Toggle checked={value.enabled} onChange={(v) => onChange({ enabled: v })} label="启用邮件通知" />}
    >
      <div
        className={cn(
          "flex flex-col transition-opacity",
          !value.enabled && "pointer-events-none select-none opacity-40",
        )}
      >
        {/* SMTP 主机 + 端口 */}
        <div className="grid grid-cols-1 gap-4 border-t border-border py-4 first:border-t-0 first:pt-0 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="smtp-host" className="text-sm font-medium">SMTP 服务器</label>
            <TextField
              id="smtp-host"
              value={value.host}
              onChange={(v) => onChange({ host: v })}
              placeholder="smtp.example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="smtp-port" className="text-sm font-medium">端口</label>
            <NumberStepper
              id="smtp-port"
              value={value.port}
              onChange={(v) => onChange({ port: v })}
              min={1}
              max={65535}
              className="w-full"
            />
          </div>
        </div>

        {/* 加密方式 */}
        <SettingRow label="加密方式" hint="端口 465 → SSL，端口 587 → STARTTLS，端口 25 → 无加密。">
          <div className="flex items-center gap-1 rounded-full border border-border bg-surface/60 p-1">
            {encryptionOptions.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onChange({ encryption: o.id })}
                className={cn(
                  "h-8 rounded-full px-3 text-xs font-medium transition-colors",
                  value.encryption === o.id
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </SettingRow>

        {/* 用户名 + 密码 */}
        <div className="grid grid-cols-1 gap-4 border-t border-border py-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="smtp-user" className="text-sm font-medium">用户名</label>
            <TextField
              id="smtp-user"
              value={value.username}
              onChange={(v) => onChange({ username: v })}
              placeholder="notify@example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="smtp-pass" className="text-sm font-medium">密码 / 授权码</label>
            <TextField
              id="smtp-pass"
              type="password"
              value={value.password}
              onChange={(v) => onChange({ password: v })}
              placeholder="••••••••"
            />
          </div>
        </div>

        {/* 发件人 + 测试收件人 */}
        <div className="grid grid-cols-1 gap-4 border-t border-border py-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="smtp-from" className="text-sm font-medium">发件人邮箱</label>
            <TextField
              id="smtp-from"
              value={value.from}
              onChange={(v) => onChange({ from: v })}
              placeholder="notify@example.com"
              invalid={fromInvalid}
            />
            {fromInvalid && <span className="text-xs text-negative">邮箱格式不正确</span>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="smtp-to" className="text-sm font-medium">测试收件人</label>
            <TextField
              id="smtp-to"
              value={value.to}
              onChange={(v) => onChange({ to: v })}
              placeholder="admin@example.com"
              invalid={toInvalid}
            />
            {toInvalid && <span className="text-xs text-negative">邮箱格式不正确</span>}
          </div>
        </div>

        {/* 校验按钮 + 结果 */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={runTest}
              disabled={result.status === "testing"}
              className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:brightness-105 active:scale-95 disabled:opacity-60"
            >
              {result.status === "testing" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在校验参数…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  校验参数可用性
                </>
              )}
            </button>
            <p className="text-xs text-muted-foreground">校验邮箱格式并探测 SMTP 服务器连通性，不会真实发信。</p>
          </div>

          {result.status === "ok" && (
            <div className="flex flex-col gap-1 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
              <span className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                {result.message}
                {result.latencyMs != null && (
                  <span className="text-xs text-primary/70">· 耗时 {result.latencyMs}ms</span>
                )}
              </span>
              {result.warnings?.map((w, i) => (
                <span key={i} className="flex items-center gap-2 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {w}
                </span>
              ))}
            </div>
          )}

          {result.status === "error" && (
            <div className="flex flex-col gap-1 rounded-xl border border-negative/40 bg-negative/10 px-4 py-3 text-sm">
              {result.errors.map((e, i) => (
                <span key={i} className="flex items-center gap-2 font-medium text-negative">
                  <XCircle className="h-4 w-4" />
                  {e}
                </span>
              ))}
              {result.warnings?.map((w, i) => (
                <span key={`w-${i}`} className="flex items-center gap-2 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {w}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </SettingCard>
  )
}

/* 通知条件项：图标 + 标题 + 开关，展开可含阈值滑块 */
function ConditionRow({
  icon,
  tone,
  label,
  hint,
  enabled,
  onToggle,
  children,
}: {
  icon: React.ReactNode
  tone: "primary" | "warning" | "negative"
  label: string
  hint: string
  enabled: boolean
  onToggle: (v: boolean) => void
  children?: React.ReactNode
}) {
  const toneCls = {
    primary: "text-primary bg-primary/12",
    warning: "text-warning bg-warning/15",
    negative: "text-negative bg-negative/15",
  }[tone]
  return (
    <div className="flex flex-col gap-3 border-t border-border py-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", toneCls)}>{icon}</span>
          <div className="leading-tight">
            <p className="text-sm font-medium">{label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
          </div>
        </div>
        <Toggle checked={enabled} onChange={onToggle} label={label} />
      </div>
      {enabled && children && <div className="pl-12">{children}</div>}
    </div>
  )
}

function ConditionsBlock({
  value,
  onChange,
}: {
  value: NotifyConditions
  onChange: (patch: Partial<NotifyConditions>) => void
}) {
  return (
    <SettingCard
      title="通知条件"
      desc="选择在哪些事件发生时触发通知，并为资源类告警设置阈值"
      icon={<BellRing className="h-5 w-5" />}
    >
      <ConditionRow
        icon={<WifiOff className="h-5 w-5" />}
        tone="negative"
        label="客户端离线"
        hint="任一客户端心跳超时被标记为离线时通知。"
        enabled={value.clientOffline}
        onToggle={(v) => onChange({ clientOffline: v })}
      />
      <ConditionRow
        icon={<CircleX className="h-5 w-5" />}
        tone="negative"
        label="任务失败"
        hint="计划任务或命令执行失败（含重试耗尽）时通知。"
        enabled={value.taskFailed}
        onToggle={(v) => onChange({ taskFailed: v })}
      />
      <ConditionRow
        icon={<Cpu className="h-5 w-5" />}
        tone="warning"
        label="CPU 告警"
        hint="客户端 CPU 使用率持续超过阈值时通知。"
        enabled={value.cpuAlert}
        onToggle={(v) => onChange({ cpuAlert: v })}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">CPU 告警阈值</span>
          <ThresholdSlider
            value={value.cpuThreshold}
            onChange={(v) => onChange({ cpuThreshold: v })}
            tone="warning"
          />
        </div>
      </ConditionRow>
      <ConditionRow
        icon={<MemoryStick className="h-5 w-5" />}
        tone="warning"
        label="内存告警"
        hint="客户端内存占用超过阈值时通知。"
        enabled={value.memAlert}
        onToggle={(v) => onChange({ memAlert: v })}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">内存告警阈值</span>
          <ThresholdSlider
            value={value.memThreshold}
            onChange={(v) => onChange({ memThreshold: v })}
            tone="warning"
          />
        </div>
      </ConditionRow>
      <ConditionRow
        icon={<HardDrive className="h-5 w-5" />}
        tone="warning"
        label="磁盘告警"
        hint="任一磁盘分区占用超过阈值时通知。"
        enabled={value.diskAlert}
        onToggle={(v) => onChange({ diskAlert: v })}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">磁盘告警阈值</span>
          <ThresholdSlider
            value={value.diskThreshold}
            onChange={(v) => onChange({ diskThreshold: v })}
            tone="negative"
          />
        </div>
      </ConditionRow>
      <ConditionRow
        icon={<MoonStar className="h-5 w-5" />}
        tone="primary"
        label="免打扰时段"
        hint="每日 23:00 – 07:00 仅记录不推送（严重告警除外）。"
        enabled={value.quietHours}
        onToggle={(v) => onChange({ quietHours: v })}
      />
    </SettingCard>
  )
}

export function NotificationsPanel({
  email,
  conditions,
  onEmailChange,
  onConditionsChange,
}: {
  email: EmailSettings
  conditions: NotifyConditions
  onEmailChange: (patch: Partial<EmailSettings>) => void
  onConditionsChange: (patch: Partial<NotifyConditions>) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <EmailBlock value={email} onChange={onEmailChange} />
      <ConditionsBlock value={conditions} onChange={onConditionsChange} />
    </div>
  )
}
