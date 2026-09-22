"use client"

import { useState } from "react"
import {
  ShieldCheck,
  KeyRound,
  Plus,
  Trash2,
  Copy,
  Check,
  LogOut,
  Fingerprint,
  Network,
  Lock,
  AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { SettingCard, SettingRow, Toggle, NumberStepper, TextField } from "./primitives"
import { initialApiKeys, type SecuritySettings, type ApiKey } from "./settings-data"

const scopeMeta: Record<ApiKey["scope"], { label: string; cls: string }> = {
  read: { label: "只读", cls: "bg-primary/12 text-primary" },
  write: { label: "读写", cls: "bg-warning/15 text-warning" },
  admin: { label: "管理", cls: "bg-negative/15 text-negative" },
}

function randomKey() {
  const chars = "abcdef0123456789"
  let s = ""
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return `nk_live_${s}`
}

function ApiKeyManager({ enabled }: { enabled: boolean }) {
  const [keys, setKeys] = useState<ApiKey[]>(initialApiKeys)
  const [newName, setNewName] = useState("")
  const [newScope, setNewScope] = useState<ApiKey["scope"]>("read")
  const [justCreated, setJustCreated] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const createKey = () => {
    const name = newName.trim()
    if (!name) return
    const prefix = randomKey()
    const key: ApiKey = {
      id: `k-${Date.now()}`,
      name,
      prefix,
      createdAt: new Date().toISOString().slice(0, 10),
      lastUsed: "从未使用",
      scope: newScope,
    }
    setKeys((k) => [key, ...k])
    setNewName("")
    setJustCreated(`${prefix}${randomKey().replace("nk_live_", "")}${randomKey().replace("nk_live_", "")}`)
  }

  const revoke = (id: string) => setKeys((k) => k.filter((x) => x.id !== id))

  const copy = (text: string, id: string) => {
    navigator.clipboard?.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className={cn("flex flex-col transition-opacity", !enabled && "pointer-events-none select-none opacity-40")}>
      {/* 新建密钥 */}
      <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_auto_auto]">
        <TextField value={newName} onChange={setNewName} placeholder="密钥名称，如「监控采集器」" className="w-full" />
        <div className="flex items-center gap-1 rounded-xl border border-border bg-surface/60 p-1">
          {(["read", "write", "admin"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setNewScope(s)}
              className={cn(
                "h-8 rounded-lg px-3 text-xs font-medium transition-colors",
                newScope === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {scopeMeta[s].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={createKey}
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:brightness-105 active:scale-95"
        >
          <Plus className="h-4 w-4" />
          生成密钥
        </button>
      </div>

      {/* 新建成功后一次性完整密钥展示 */}
      {justCreated && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs text-primary">请立即复制并妥善保管，密钥完整值仅显示一次：</p>
            <p className="mt-1 truncate font-mono text-sm text-foreground">{justCreated}</p>
          </div>
          <button
            type="button"
            onClick={() => copy(justCreated, "new")}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-transform active:scale-95"
          >
            {copied === "new" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied === "new" ? "已复制" : "复制"}
          </button>
        </div>
      )}

      {/* 密钥列表 */}
      <div className="mt-4 flex flex-col gap-2.5">
        {keys.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
            <KeyRound className="h-7 w-7" />
            <p className="text-sm">暂无 API 密钥</p>
          </div>
        ) : (
          keys.map((k) => {
            const meta = scopeMeta[k.scope]
            return (
              <div
                key={k.id}
                className="flex items-center gap-3 rounded-2xl border border-border bg-surface/60 px-4 py-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background/40 text-muted-foreground">
                  <KeyRound className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{k.name}</p>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", meta.cls)}>{meta.label}</span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="font-mono">{k.prefix}••••••••</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span>创建于 {k.createdAt}</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span>最近使用 {k.lastUsed}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copy(`${k.prefix}••••••••`, k.id)}
                  aria-label="复制前缀"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
                >
                  {copied === k.id ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => revoke(k.id)}
                  aria-label="吊销密钥"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-negative/15 hover:text-negative"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export function SecurityPanel({
  value,
  onChange,
}: {
  value: SecuritySettings
  onChange: (patch: Partial<SecuritySettings>) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* 会话与登录 */}
      <SettingCard
        title="会话与登录"
        desc="控制登录会话的有效期与登录安全策略"
        icon={<ShieldCheck className="h-5 w-5" />}
      >
        <SettingRow
          label="会话超时"
          hint="用户无操作超过该时长后自动退出登录，需重新认证。"
          htmlFor="session-timeout"
        >
          <NumberStepper
            id="session-timeout"
            value={value.sessionTimeout}
            onChange={(v) => onChange({ sessionTimeout: v })}
            min={5}
            max={1440}
            step={5}
            unit="分钟"
          />
        </SettingRow>

        <SettingRow
          label="双因素认证 (2FA)"
          hint="登录时除密码外，额外校验动态验证码 (TOTP)，显著提升账号安全性。"
        >
          <div className="flex items-center gap-2">
            {value.twoFactor && (
              <span className="flex items-center gap-1 rounded-full bg-primary/12 px-2.5 py-1 text-xs font-medium text-primary">
                <Fingerprint className="h-3.5 w-3.5" />
                已启用
              </span>
            )}
            <Toggle checked={value.twoFactor} onChange={(v) => onChange({ twoFactor: v })} label="双因素认证" />
          </div>
        </SettingRow>

        <SettingRow
          label="登录失败锁定"
          hint="连续 5 次登录失败后，临时锁定账号 15 分钟以防暴力破解。"
        >
          <Toggle checked={value.loginLockout} onChange={(v) => onChange({ loginLockout: v })} />
        </SettingRow>
      </SettingCard>

      {/* 访问控制 */}
      <SettingCard
        title="访问控制"
        desc="传输安全与来源限制"
        icon={<Lock className="h-5 w-5" />}
      >
        <SettingRow label="强制 HTTPS" hint="所有面板与 API 请求强制经由 HTTPS，拒绝明文访问。">
          <Toggle checked={value.forceHttps} onChange={(v) => onChange({ forceHttps: v })} />
        </SettingRow>
        <SettingRow
          label="IP 访问白名单"
          hint="仅允许白名单内的 IP 访问管理后台，其余来源一律拒绝。"
        >
          <div className="flex items-center gap-2">
            {value.ipAllowlist && (
              <span className="flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning">
                <Network className="h-3.5 w-3.5" />
                生效中
              </span>
            )}
            <Toggle checked={value.ipAllowlist} onChange={(v) => onChange({ ipAllowlist: v })} />
          </div>
        </SettingRow>
        <SettingRow
          label="允许客户端免密注册"
          hint="关闭时，Agent 首次注册必须提供服务端入网密钥。"
        >
          <Toggle checked={value.openEnrollment} onChange={(v) => onChange({ openEnrollment: v })} label="允许客户端免密注册" />
        </SettingRow>
        {value.openEnrollment && (
          <div className="-mt-1 mb-2 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs leading-relaxed text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>开启后，任何能访问此服务端的陌生客户端都可以无需入网密钥直接注册。仅建议在可信网络或临时部署时使用。</span>
          </div>
        )}
        <SettingRow label="登出所有其他会话" hint="立即使当前设备之外的所有已登录会话失效。">
          <button
            type="button"
            className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface/60 px-4 text-xs font-medium transition-colors hover:bg-surface"
          >
            <LogOut className="h-3.5 w-3.5" />
            全部登出
          </button>
        </SettingRow>
      </SettingCard>

      {/* API 密钥管理 */}
      <SettingCard
        title="API 密钥管理"
        desc="用于第三方系统调用面板 API 的鉴权凭证"
        icon={<KeyRound className="h-5 w-5" />}
        action={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">启用 API Key 鉴权</span>
            <Toggle checked={value.apiKeyAuth} onChange={(v) => onChange({ apiKeyAuth: v })} label="启用 API Key 鉴权" />
          </div>
        }
      >
        <ApiKeyManager enabled={value.apiKeyAuth} />
      </SettingCard>
    </div>
  )
}
