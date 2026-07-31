"use client"

import { useEffect, useRef, useState } from "react"
import { AlertCircle, Check, Cloud, HardDrive, KeyRound, Link2, Loader2 } from "lucide-react"
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

/**
 * 第三部分：服务端注册。
 * 标题与两张来源卡片错峰模糊渐显；点选卡片后其内部面板平滑展开
 * （本地部署直接确认 / 云端对接需填写 API 地址 + Key），确认后整体渐隐。
 */
export function ServerRegister({ onDone }: { onDone: () => void }) {
  const { setServerSource } = useOnboarding()
  const [shown, setShown] = useState(false) // 入场揭示
  const [selected, setSelected] = useState<Mode | null>(null)
  const [api, setApi] = useState("")
  const [key, setKey] = useState("")
  const [leaving, setLeaving] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle")
  const [connectionError, setConnectionError] = useState("")

  // 文字"被卡片推上去"的惯性跟随：每次展开/收起切换关键帧动画并借助 key 重放。
  const [push, setPush] = useState<{ dir: "up" | "down"; k: number } | null>(null)
  const prevOpen = useRef(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const isOpen = selected !== null
    if (prevOpen.current === isOpen) return
    prevOpen.current = isOpen
    setPush((p) => ({ dir: isOpen ? "up" : "down", k: (p?.k ?? 0) + 1 }))
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
    const timeout = window.setTimeout(() => controller.abort(), 8000)

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

  /** 错峰入场揭示样式 */
  const reveal = (delay: number): React.CSSProperties => ({
    opacity: shown ? 1 : 0,
    transform: shown ? "translateY(0)" : "translateY(26px)",
    filter: shown ? "blur(0px)" : "blur(12px)",
    transition: `opacity 700ms ease, transform 700ms ${EASE}, filter 700ms ease`,
    transitionDelay: shown ? `${delay}ms` : "0ms",
  })

  const cloudReady = api.trim().length > 0 && key.trim().length > 0

  const cards: {
    mode: Mode
    icon: React.ReactNode
    title: string
    desc: string
  }[] = [
    {
      mode: "local",
      icon: <HardDrive className="h-6 w-6" />,
      title: "本地部署",
      desc: "直接通过本地部署的服务端连接",
    },
    {
      mode: "cloud",
      icon: <Cloud className="h-6 w-6" />,
      title: "云端对接",
      desc: "输入云端 API 地址与访问密钥",
    },
  ]

  return (
    <div
      className="flex h-full w-full items-center justify-center px-6"
      style={{
        opacity: leaving ? 0 : 1,
        filter: leaving ? "blur(14px)" : "blur(0px)",
        transform: leaving ? "scale(0.97)" : "scale(1)",
        transition: `opacity 700ms ease, filter 700ms ease, transform 700ms ${EASE}`,
      }}
    >
      <div className="flex w-full max-w-2xl flex-col items-center gap-10">
        {/* 文字组：key 变化触发关键帧重放，被展开的卡片以惯性推上/放下 */}
        <div
          key={push?.k ?? "init"}
          className={cn(
            "flex flex-col items-center gap-3",
            push?.dir === "up" && "animate-text-push-up",
            push?.dir === "down" && "animate-text-push-down",
          )}
        >
          <h1
            className="text-balance text-center text-2xl font-semibold text-foreground sm:text-3xl"
            style={reveal(0)}
          >
            此项需要您提供服务端来源
          </h1>
          <p className="text-sm text-muted-foreground" style={reveal(120)}>
            请选择 NachoPanel 的服务端连接方式
          </p>
        </div>

        <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-start">
          {cards.map((c, i) => {
            const active = selected === c.mode
            const dimmed = selected !== null && !active
            return (
              // 外层承载入场错峰揭示，内层承载选中/让位过渡，二者互不干扰
              <div key={c.mode} className="w-full sm:flex-1" style={reveal(240 + i * 130)}>
                <div
                  style={{
                    opacity: dimmed ? 0.38 : 1,
                    transform: dimmed ? "scale(0.97)" : "scale(1)",
                    filter: dimmed ? "blur(1.5px)" : "blur(0px)",
                    transition: `opacity 400ms ease, transform 400ms ${EASE}, filter 400ms ease`,
                  }}
                >
                <button
                  type="button"
                  onClick={() => setSelected(active ? null : c.mode)}
                  aria-expanded={active}
                  className={cn(
                    "flex w-full items-center gap-4 rounded-t-3xl border p-5 text-left transition-all duration-300 ease-out",
                    active
                      ? "border-primary/50 bg-surface"
                      : "rounded-b-3xl border-border bg-card hover:border-primary/30 hover:bg-surface",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-all duration-300",
                      active ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25" : "bg-muted text-primary",
                    )}
                  >
                    {c.icon}
                  </span>
                  <span className="flex-1">
                    <span className="block text-base font-semibold text-foreground">{c.title}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{c.desc}</span>
                  </span>
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-all duration-300",
                      active ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent",
                    )}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                </button>

                {/* 展开面板：grid-rows 0fr→1fr 按内容精确高度平滑展开，内容层做模糊渐显 */}
                <div
                  className="grid rounded-b-3xl"
                  style={{
                    gridTemplateRows: active ? "1fr" : "0fr",
                    transition: `grid-template-rows 520ms ${EASE}`,
                  }}
                >
                  <div className="min-h-0 overflow-hidden">
                  <div
                    className="flex flex-col gap-3 rounded-b-3xl border border-t-0 border-primary/50 bg-surface p-5 pt-1"
                    style={{
                      opacity: active ? 1 : 0,
                      transform: active ? "translateY(0)" : "translateY(-10px)",
                      filter: active ? "blur(0px)" : "blur(6px)",
                      transition: `opacity 450ms ease ${active ? "120ms" : "0ms"}, transform 450ms ${EASE} ${active ? "120ms" : "0ms"}, filter 450ms ease ${active ? "120ms" : "0ms"}`,
                    }}
                  >
                    {c.mode === "local" ? (
                      <>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          将自动发现并连接本机运行的 NachoPanel 服务端，无需额外配置。
                        </p>
                        <button
                          type="button"
                          onClick={() => finish({ mode: "local" })}
                          className="flex h-12 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-300 ease-out hover:scale-[1.02] active:scale-95"
                        >
                          <Check className="h-4 w-4" />
                          确认使用本地部署
                        </button>
                      </>
                    ) : (
                      <>
                        <label className="flex h-12 items-center gap-2.5 rounded-full border border-border bg-card px-4 transition-colors focus-within:border-primary/50">
                          <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <input
                            type="url"
                            value={api}
                            onChange={(e) => {
                              setApi(e.target.value)
                              setConnectionStatus("idle")
                              setConnectionError("")
                            }}
                            placeholder="云端 API 地址"
                            aria-label="云端 API 地址"
                            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
                          />
                        </label>
                        <label className="flex h-12 items-center gap-2.5 rounded-full border border-border bg-card px-4 transition-colors focus-within:border-primary/50">
                          <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <input
                            type="password"
                            value={key}
                            onChange={(e) => {
                              setKey(e.target.value)
                              setConnectionStatus("idle")
                              setConnectionError("")
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229 && cloudReady)
                                void confirmCloud()
                            }}
                            placeholder="访问密钥 Key"
                            aria-label="访问密钥"
                            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => void confirmCloud()}
                          disabled={!cloudReady || connectionStatus === "testing" || connectionStatus === "success"}
                          className="flex h-12 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-300 ease-out hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                        >
                          {connectionStatus === "testing" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                          {connectionStatus === "testing"
                            ? "正在校验连接"
                            : connectionStatus === "success"
                              ? "校验成功"
                              : "确认云端对接"}
                        </button>
                        {/* 错误提示：高度 0fr→1fr 平滑展开 + 模糊渐显，模拟 iOS 弹性浮现 */}
                        <div
                          className="grid"
                          style={{
                            gridTemplateRows: connectionStatus === "error" ? "1fr" : "0fr",
                            transition: `grid-template-rows 480ms ${EASE}`,
                          }}
                        >
                          <div className="min-h-0 overflow-hidden">
                            <p
                              aria-live="polite"
                              className="flex items-start gap-1.5 px-1 pb-0.5 text-xs leading-relaxed text-negative"
                              style={{
                                opacity: connectionStatus === "error" ? 1 : 0,
                                transform:
                                  connectionStatus === "error"
                                    ? "translateY(0) scale(1)"
                                    : "translateY(-6px) scale(0.96)",
                                filter: connectionStatus === "error" ? "blur(0px)" : "blur(6px)",
                                transformOrigin: "top left",
                                transition: `opacity 420ms ease ${connectionStatus === "error" ? "80ms" : "0ms"}, transform 480ms ${EASE} ${connectionStatus === "error" ? "80ms" : "0ms"}, filter 420ms ease ${connectionStatus === "error" ? "80ms" : "0ms"}`,
                              }}
                            >
                              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span>{connectionError || "\u00A0"}</span>
                            </p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  </div>
                </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
