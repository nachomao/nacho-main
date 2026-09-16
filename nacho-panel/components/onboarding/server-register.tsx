"use client"

import { useEffect, useRef, useState } from "react"
import { AlertCircle, Check, Cloud, HardDrive, KeyRound, Link2, Loader2 } from "lucide-react"
import { LocalControlServerManager } from "@/components/local-control/local-control-server-manager"
import { cn } from "@/lib/utils"
import { useOnboarding, type ServerSource } from "./onboarding-context"

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"

type Mode = "local" | "cloud"
type ConnectionStatus = "idle" | "testing" | "success" | "error"

function normalizeApiUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "")
  return trimmed && !/^https?:\/\//i.test(trimmed) ? `http://${trimmed}` : trimmed
}

function isOverviewResponse(value: unknown): value is { ok: true; data: object } {
  if (!value || typeof value !== "object") return false
  const response = value as { ok?: unknown; data?: unknown }
  return response.ok === true && typeof response.data === "object" && response.data !== null
}

export function ServerRegister({ onDone }: { onDone: () => void }) {
  const { setServerSource } = useOnboarding()
  const [shown, setShown] = useState(false)
  const [selected, setSelected] = useState<Mode | null>(null)
  const [api, setApi] = useState("")
  const [key, setKey] = useState("")
  const [leaving, setLeaving] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle")
  const [connectionError, setConnectionError] = useState("")
  const [push, setPush] = useState<{ dir: "up" | "down"; k: number } | null>(null)
  const prevOpen = useRef(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const isOpen = selected !== null
    if (prevOpen.current === isOpen) return
    prevOpen.current = isOpen
    setPush((previous) => ({ dir: isOpen ? "up" : "down", k: (previous?.k ?? 0) + 1 }))
  }, [selected])

  const finish = (source: Exclude<ServerSource, null>) => {
    if (leaving) return
    setServerSource(source)
    setLeaving(true)
    window.setTimeout(onDone, 750)
  }

  const confirmCloud = async () => {
    if (leaving || connectionStatus === "testing") return
    const baseUrl = normalizeApiUrl(api)
    const apiKey = key.trim()
    if (!baseUrl || !apiKey) return

    try {
      const parsedUrl = new URL(baseUrl)
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") throw new Error("invalid protocol")
    } catch {
      setConnectionStatus("error")
      setConnectionError("API 地址格式不正确")
      return
    }

    setConnectionStatus("testing")
    setConnectionError("")
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8_000)

    try {
      const response = await fetch(`${baseUrl}/api/panel/overview`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      })
      if (response.status === 401 || response.status === 403) {
        setConnectionStatus("error")
        setConnectionError("面板 API Key 校验失败，请检查后重试")
        return
      }
      if (!response.ok) {
        setConnectionStatus("error")
        setConnectionError(`服务端响应异常（HTTP ${response.status}）`)
        return
      }
      const body: unknown = await response.json()
      if (!isOverviewResponse(body)) {
        setConnectionStatus("error")
        setConnectionError("目标地址不是有效的 NachoPanel 服务端")
        return
      }
      setConnectionStatus("success")
      window.setTimeout(() => finish({ mode: "cloud", api: baseUrl, key: apiKey }), 500)
    } catch (error) {
      setConnectionStatus("error")
      setConnectionError(
        error instanceof DOMException && error.name === "AbortError"
          ? "连接超时，请检查地址与网络"
          : "连接服务端失败，请检查 API 地址、网络和跨域配置",
      )
    } finally {
      window.clearTimeout(timeout)
    }
  }

  const reveal = (delay: number): React.CSSProperties => ({
    opacity: shown ? 1 : 0,
    transform: shown ? "translateY(0)" : "translateY(26px)",
    filter: shown ? "blur(0px)" : "blur(12px)",
    transition: `opacity 700ms ease, transform 700ms ${EASE}, filter 700ms ease`,
    transitionDelay: shown ? `${delay}ms` : "0ms",
  })

  const cloudReady = api.trim().length > 0 && key.trim().length > 0
  const cards: { mode: Mode; icon: React.ReactNode; title: string; desc: string }[] = [
    { mode: "local", icon: <HardDrive className="size-6" />, title: "本机部署", desc: "在当前 Windows 设备安装并运行控制服务" },
    { mode: "cloud", icon: <Cloud className="size-6" />, title: "云端对接", desc: "连接已部署的远程 API 与访问密钥" },
  ]

  return (
    <div
      className="h-full w-full overflow-y-auto px-4 py-10 sm:px-6"
      style={{
        opacity: leaving ? 0 : 1,
        filter: leaving ? "blur(14px)" : "blur(0px)",
        transform: leaving ? "scale(0.97)" : "scale(1)",
        transition: `opacity 700ms ease, filter 700ms ease, transform 700ms ${EASE}`,
      }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center gap-8">
        <div
          key={push?.k ?? "init"}
          className={cn(
            "flex flex-col items-center gap-3",
            push?.dir === "up" && "animate-text-push-up",
            push?.dir === "down" && "animate-text-push-down",
          )}
        >
          <h1 className="text-balance text-center text-2xl font-semibold text-foreground sm:text-3xl" style={reveal(0)}>
            选择控制服务来源
          </h1>
          <p className="text-center text-sm text-muted-foreground" style={reveal(120)}>
            在此设备完成本机部署，或连接已有的云端服务
          </p>
        </div>

        <div className="grid w-full gap-3 sm:grid-cols-2">
          {cards.map((card, index) => {
            const active = selected === card.mode
            const dimmed = selected !== null && !active
            return (
              <div key={card.mode} style={reveal(240 + index * 130)}>
                <button
                  type="button"
                  onClick={() => setSelected(active ? null : card.mode)}
                  aria-expanded={active}
                  aria-controls="server-source-detail"
                  className={cn(
                    "flex w-full items-center gap-4 rounded-3xl border p-5 text-left outline-none transition-all duration-300 ease-out focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "border-primary/50 bg-surface shadow-lg shadow-primary/8" : "border-border bg-card hover:border-primary/30 hover:bg-surface",
                  )}
                  style={{
                    opacity: dimmed ? 0.48 : 1,
                    transform: dimmed ? "scale(0.98)" : active ? "translateY(-2px)" : "scale(1)",
                    filter: dimmed ? "blur(1px)" : "blur(0px)",
                  }}
                >
                  <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-2xl transition-all duration-300", active ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25" : "bg-muted text-primary")}>
                    {card.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold text-foreground">{card.title}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{card.desc}</span>
                  </span>
                  <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border transition-all duration-300", active ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent")}>
                    <Check className="size-3.5" aria-hidden="true" />
                  </span>
                </button>
              </div>
            )
          })}
        </div>

        <div
          id="server-source-detail"
          className="grid w-full"
          style={{ gridTemplateRows: selected ? "1fr" : "0fr", transition: `grid-template-rows 520ms ${EASE}` }}
        >
          <div className="min-h-0 overflow-hidden">
            <div
              className="pb-2"
              style={{
                opacity: selected ? 1 : 0,
                transform: selected ? "translateY(0)" : "translateY(-14px)",
                filter: selected ? "blur(0px)" : "blur(8px)",
                transition: `opacity 450ms ease ${selected ? "120ms" : "0ms"}, transform 450ms ${EASE} ${selected ? "120ms" : "0ms"}, filter 450ms ease ${selected ? "120ms" : "0ms"}`,
              }}
            >
              {selected === "local" && <LocalControlServerManager surface="onboarding" onConnected={finish} />}
              {selected === "cloud" && (
                <section className="rounded-3xl border border-primary/35 bg-surface p-5 shadow-xl shadow-primary/5 sm:p-6">
                  <div className="mx-auto max-w-xl space-y-3">
                    <div className="mb-4 text-center">
                      <h2 className="text-base font-semibold text-foreground">连接云端控制服务</h2>
                      <p className="mt-1 text-xs text-muted-foreground">凭据只保存在当前浏览器中，连接前会验证服务身份与权限。</p>
                    </div>
                    <label className="flex h-12 items-center gap-2.5 rounded-full border border-border bg-card px-4 transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
                      <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <input
                        type="url"
                        value={api}
                        onChange={(event) => { setApi(event.target.value); setConnectionStatus("idle"); setConnectionError("") }}
                        placeholder="云端 API 地址"
                        aria-label="云端 API 地址"
                        autoComplete="url"
                        className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
                      />
                    </label>
                    <label className="flex h-12 items-center gap-2.5 rounded-full border border-border bg-card px-4 transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
                      <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <input
                        type="password"
                        value={key}
                        onChange={(event) => { setKey(event.target.value); setConnectionStatus("idle"); setConnectionError("") }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229 && cloudReady) void confirmCloud()
                        }}
                        placeholder="Panel API Key"
                        aria-label="Panel API Key"
                        autoComplete="off"
                        className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void confirmCloud()}
                      disabled={!cloudReady || connectionStatus === "testing" || connectionStatus === "success"}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-300 ease-out hover:scale-[1.01] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40"
                    >
                      {connectionStatus === "testing" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
                      {connectionStatus === "testing" ? "正在校验连接" : connectionStatus === "success" ? "校验成功" : "验证并使用云端服务"}
                    </button>
                    <div className="grid" style={{ gridTemplateRows: connectionStatus === "error" ? "1fr" : "0fr", transition: `grid-template-rows 480ms ${EASE}` }}>
                      <div className="min-h-0 overflow-hidden">
                        <p
                          aria-live="polite"
                          className="flex items-start gap-1.5 px-1 pt-2 text-xs leading-relaxed text-negative"
                          style={{ opacity: connectionStatus === "error" ? 1 : 0, filter: connectionStatus === "error" ? "blur(0px)" : "blur(6px)", transition: "opacity 420ms ease, filter 420ms ease" }}
                        >
                          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          <span>{connectionError || "\u00A0"}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
