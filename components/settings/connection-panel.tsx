"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Eye, EyeOff, Loader2, Network, PlugZap, Save, XCircle } from "lucide-react"
import { useOnboarding } from "@/components/onboarding/onboarding-context"
import { useServerData } from "@/components/server-data-context"
import { defaultServerBaseUrl } from "@/lib/server-connection"
import { SettingCard, SettingRow } from "./primitives"

type Result = { tone: "success" | "error"; message: string } | null

function normalizeApi(value: string) {
  return value.trim().replace(/\/+$/, "")
}

function validateApi(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

async function probe(api: string, key: string) {
  const response = await fetch(`${normalizeApi(api)}/api/panel/overview`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
  })
  const body = (await response.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null
  if (!response.ok || !body?.ok) {
    throw new Error(body?.message || body?.error || `连接测试失败（HTTP ${response.status}）`)
  }
}

export function ConnectionPanel() {
  const { serverSource, setServerSource } = useOnboarding()
  const { refresh } = useServerData()
  const [api, setApi] = useState("")
  const [key, setKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<Result>(null)

  useEffect(() => {
    if (serverSource?.mode === "cloud") {
      setApi(serverSource.api)
      setKey(serverSource.key)
      return
    }
    setApi(defaultServerBaseUrl())
    setKey(process.env.NEXT_PUBLIC_NACHO_PANEL_API_KEY || "")
  }, [serverSource])

  const validate = () => {
    if (!validateApi(api)) {
      setResult({ tone: "error", message: "请输入以 http:// 或 https:// 开头的有效 API 地址。" })
      return false
    }
    if (!key.trim()) {
      setResult({ tone: "error", message: "Panel API Key 不能为空。" })
      return false
    }
    return true
  }

  const test = async () => {
    if (!validate()) return false
    setTesting(true)
    setResult(null)
    try {
      await probe(api, key.trim())
      setResult({ tone: "success", message: "连接成功，服务端鉴权和面板接口均正常。" })
      return true
    } catch (caught) {
      setResult({ tone: "error", message: caught instanceof Error ? caught.message : "连接测试失败。" })
      return false
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    if (!validate()) return
    setSaving(true)
    const nextApi = normalizeApi(api)
    const nextKey = key.trim()
    setApi(nextApi)
    setServerSource({ mode: "cloud", api: nextApi, key: nextKey })
    try {
      await probe(nextApi, nextKey)
      setResult({ tone: "success", message: "连接配置已保存，服务端数据正在同步。" })
    } catch (caught) {
      setResult({
        tone: "error",
        message: `配置已保存；${caught instanceof Error ? caught.message : "当前未连接到服务端。"}`,
      })
    } finally {
      setSaving(false)
      window.setTimeout(() => void refresh(), 0)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingCard
        title="服务端连接"
        desc="修改面板读取仪表盘、客户端和日志数据时使用的服务端地址与鉴权凭证"
        icon={<Network className="h-5 w-5" />}
      >
        <SettingRow
          label="服务端 API 地址"
          hint="填写服务端根地址，无需附加 /api/panel 路径。"
          htmlFor="server-api-url"
        >
          <input
            id="server-api-url"
            type="url"
            value={api}
            onChange={(event) => {
              setApi(event.target.value)
              setResult(null)
            }}
            placeholder="http://HOST:8443"
            className="h-10 w-full rounded-xl border border-border bg-surface/60 px-3.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 sm:w-80"
          />
        </SettingRow>
        <SettingRow
          label="Panel API Key"
          hint="该凭证仅保存在当前设备，用于服务端面板接口鉴权。"
          htmlFor="panel-api-key"
        >
          <div className="relative w-full sm:w-80">
            <input
              id="panel-api-key"
              type={showKey ? "text" : "password"}
              value={key}
              onChange={(event) => {
                setKey(event.target.value)
                setResult(null)
              }}
              autoComplete="off"
              placeholder="输入 Panel API Key"
              className="h-10 w-full rounded-xl border border-border bg-surface/60 px-3.5 pr-10 font-mono text-sm text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground/60 focus:border-primary/60"
            />
            <button
              type="button"
              onClick={() => setShowKey((value) => !value)}
              aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
              className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </SettingRow>

        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div aria-live="polite" className="min-h-5 text-xs">
            {result && (
              <span className={`flex items-center gap-1.5 ${result.tone === "success" ? "text-primary" : "text-negative"}`}>
                {result.tone === "success" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {result.message}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void test()}
              disabled={testing || saving}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-border bg-surface/60 px-4 text-sm font-medium transition-colors hover:bg-surface disabled:opacity-60"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
              测试连接
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={testing || saving}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:brightness-105 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存并连接
            </button>
          </div>
        </div>
      </SettingCard>
    </div>
  )
}
