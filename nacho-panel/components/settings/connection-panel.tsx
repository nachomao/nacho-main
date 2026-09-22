"use client"

import { useState } from "react"
import { Cloud, Copy, Eye, EyeOff, RefreshCw } from "lucide-react"
import { useOnboarding } from "@/components/onboarding/onboarding-context"
import { useServerData } from "@/components/server-data-context"
import { LocalControlServerManager } from "@/components/local-control/local-control-server-manager"

export function ConnectionPanel() {
  const { serverSource, setServerSource } = useOnboarding()
  const { error, loading, refreshing, refresh } = useServerData()
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)
  const [cloudApi, setCloudApi] = useState(serverSource?.mode === "cloud" ? serverSource.api : "")
  const [cloudKey, setCloudKey] = useState(serverSource?.mode === "cloud" ? serverSource.key : "")

  const copyKey = () => {
    if (!cloudKey) return
    void navigator.clipboard.writeText(cloudKey)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const saveCloud = () => {
    const api = cloudApi.trim().replace(/\/+$/, "")
    const key = cloudKey.trim()
    if (!api || !key) return
    setServerSource({ mode: "cloud", api, key })
    window.setTimeout(() => void refresh(), 0)
  }

  const showLocalOperations = !serverSource || serverSource.mode === "local"
  const showCloudOperations = !serverSource || serverSource.mode === "cloud"
  const description = serverSource?.mode === "local"
    ? "管理当前 Windows 本机控制服务。"
    : serverSource?.mode === "cloud"
      ? "管理当前云端控制服务连接。"
      : "选择 Windows 本机控制服务或已有的云端服务。"

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">连接设置</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>

      {showLocalOperations && (
        <LocalControlServerManager
          surface="settings"
          currentSource={serverSource}
          onConnected={setServerSource}
          onUninstalled={() => {
            if (serverSource?.mode === "local") setServerSource(null)
          }}
        />
      )}

      {showCloudOperations && (
        <div className="card-glow rounded-3xl bg-card p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl border border-border text-foreground">
              <Cloud className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">云端服务</p>
              <p className="text-[11px] text-muted-foreground">连接到远程部署的控制服务端</p>
            </div>
            {serverSource?.mode === "cloud" && (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                当前来源
              </span>
            )}
          </div>
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs text-muted-foreground">API 地址</span>
              <input
                value={cloudApi}
                onChange={(event) => setCloudApi(event.target.value)}
                className="h-9 w-full rounded-xl border border-border bg-surface/60 px-3 font-mono text-xs text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
                placeholder="https://api.example.com"
                autoComplete="url"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-muted-foreground">API Key</span>
              <div className="flex h-9 items-center rounded-xl border border-border bg-surface/60 px-3 transition focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15">
                <input
                  value={cloudKey}
                  onChange={(event) => setCloudKey(event.target.value)}
                  type={showKey ? "text" : "password"}
                  className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none"
                  placeholder="输入 Panel API Key"
                  autoComplete="off"
                />
                <button type="button" onClick={() => setShowKey((value) => !value)} className="ml-2 text-muted-foreground transition hover:text-foreground" aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}>
                  {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
                <button type="button" onClick={copyKey} disabled={!cloudKey} className="ml-2 text-muted-foreground transition hover:text-foreground disabled:opacity-40" aria-label="复制 API Key">
                  <Copy className="size-3.5" />
                </button>
              </div>
              {copied && <p className="mt-1 text-[11px] text-emerald-400" role="status">已复制到剪贴板</p>}
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={saveCloud}
                disabled={!cloudApi.trim() || !cloudKey.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
              >
                保存并使用云端连接
              </button>
              {serverSource?.mode === "cloud" && (
                <span className="text-xs text-muted-foreground">
                  状态：{loading ? "连接中" : error ? "连接失败" : "已连接"}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <section className="card-glow rounded-3xl bg-card p-6" aria-live="polite">
        <div className="flex flex-wrap items-center gap-3">
          <RefreshCw className={refreshing ? "size-3.5 animate-spin text-primary" : "size-3.5 text-muted-foreground"} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground">当前连接状态</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {serverSource ? `${serverSource.mode === "local" ? "本机服务" : "云端服务"} · ${serverSource.api}` : "尚未选择控制服务来源"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={!serverSource || refreshing}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            重新检测
          </button>
        </div>
        <p className={error ? "mt-3 text-xs text-destructive" : "mt-3 text-xs text-muted-foreground"}>
          {!serverSource ? "配置本机部署或云端连接后，面板才会读取真实业务数据。" : loading || refreshing ? "正在验证控制服务连接…" : error || "控制服务连接正常。"}
        </p>
      </section>
    </div>
  )
}
