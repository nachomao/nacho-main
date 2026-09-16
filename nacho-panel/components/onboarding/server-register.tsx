"use client"

import { useEffect, useRef, useState } from "react"
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronUp,
  Cloud,
  HardDrive,
  KeyRound,
  Link2,
  Loader2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react"
import { LocalControlServerManager } from "@/components/local-control/local-control-server-manager"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useOnboarding, type ServerSource } from "./onboarding-context"

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"

type Mode = "local" | "cloud"
type ConnectionStatus = "idle" | "testing" | "success" | "error"

const sourceOptions = [
  {
    mode: "local" as const,
    icon: HardDrive,
    eyebrow: "此设备",
    title: "本机部署",
    description: "在当前 Windows 设备安装并运行控制服务，适合单机使用与内网环境。",
    features: ["自动检查并配置运行环境", "服务、日志与凭据保留在本机"],
  },
  {
    mode: "cloud" as const,
    icon: Cloud,
    eyebrow: "远程 API",
    title: "云端对接",
    description: "连接已部署的控制服务，适合跨设备访问和集中管理。",
    features: ["连接前验证服务身份与权限", "只需 API 地址与 Panel API Key"],
  },
]

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
  const [openedModes, setOpenedModes] = useState<Mode[]>([])
  const [api, setApi] = useState("")
  const [key, setKey] = useState("")
  const [leaving, setLeaving] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle")
  const [connectionError, setConnectionError] = useState("")
  const [push, setPush] = useState<{ dir: "up" | "down"; k: number } | null>(null)
  const cardButtons = useRef<Record<Mode, HTMLButtonElement | null>>({ local: null, cloud: null })
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
    transform: shown ? "translateY(0)" : "translateY(18px)",
    filter: shown ? "blur(0px)" : "blur(7px)",
    transition: `opacity 650ms ease, transform 650ms ${EASE}, filter 650ms ease`,
    transitionDelay: shown ? `${delay}ms` : "0ms",
  })

  const cloudReady = api.trim().length > 0 && key.trim().length > 0

  const toggleMode = (mode: Mode) => {
    const closing = selected === mode
    setOpenedModes((previous) => (previous.includes(mode) ? previous : [...previous, mode]))
    setSelected(closing ? null : mode)
    window.requestAnimationFrame(() => {
      if (closing) cardButtons.current[mode]?.focus()
      else document.querySelector<HTMLElement>(`#server-source-detail-${mode} [data-source-collapse]`)?.focus()
    })
  }

  return (
    <div
      className="relative isolate h-full w-full overflow-y-auto px-4 py-8 sm:px-6 sm:py-10"
      style={{
        opacity: leaving ? 0 : 1,
        filter: leaving ? "blur(14px)" : "blur(0px)",
        transform: leaving ? "scale(0.97)" : "scale(1)",
        transition: `opacity 700ms ease, filter 700ms ease, transform 700ms ${EASE}`,
      }}
    >
      <div
        className="pointer-events-none fixed inset-0 -z-10 opacity-70"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(circle at 50% 8%, color-mix(in srgb, var(--primary) 9%, transparent) 0, transparent 32%), radial-gradient(circle at 12% 78%, color-mix(in srgb, var(--foreground) 4%, transparent) 0, transparent 27%)",
        }}
      />

      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col justify-center gap-7 sm:gap-8">
        <header
          key={push?.k ?? "init"}
          className={cn(
            "flex flex-col items-center gap-3",
            push?.dir === "up" && "animate-text-push-up",
            push?.dir === "down" && "animate-text-push-down",
          )}
        >
          <Badge variant="outline" className="border-border/60 bg-background/35 px-2.5 text-muted-foreground backdrop-blur-md" style={reveal(0)}>
            <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
            控制服务
          </Badge>
          <h1 className="text-balance text-center text-3xl font-semibold tracking-tight text-foreground sm:text-4xl" style={reveal(70)}>
            选择你的使用方式
          </h1>
          <p className="max-w-xl text-balance text-center text-sm leading-6 text-muted-foreground sm:text-[15px]" style={reveal(140)}>
            两种方式使用同一套管理能力，选择最适合当前环境的连接方式。
          </p>
        </header>

        <div className="source-choice-grid w-full items-start gap-3.5 sm:gap-4" data-selected={selected ?? "none"}>
          {sourceOptions.map((option, index) => {
            const active = selected === option.mode
            const displaced = selected !== null && !active
            const opened = openedModes.includes(option.mode)
            const Icon = option.icon
            return (
              <div key={option.mode} className="min-w-0 self-start" style={reveal(220 + index * 110)}>
                <article
                  aria-label={`${option.title}使用方式`}
                  className={cn(
                    "relative isolate overflow-hidden rounded-[1.75rem] border border-border/55 bg-card/42 shadow-[0_18px_55px_-42px_rgba(0,0,0,0.9)] backdrop-blur-xl transition-[border-color,background-color,box-shadow,transform,opacity] duration-700 ease-out",
                    active && "-translate-y-1 border-border/80 bg-card/62 shadow-[0_24px_80px_-42px_rgba(0,0,0,0.92)] ring-1 ring-foreground/5",
                    displaced && "sm:translate-y-5 sm:scale-[0.97] sm:bg-card/32 sm:opacity-80",
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent transition-opacity duration-500",
                      active ? "opacity-100" : "opacity-55",
                    )}
                    aria-hidden="true"
                  />

                  <div
                    className="grid motion-reduce:transition-none"
                    style={{
                      gridTemplateRows: active ? "0fr" : "1fr",
                      transition: active ? "none" : `grid-template-rows 560ms ${EASE}`,
                    }}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <button
                        ref={(element) => {
                          cardButtons.current[option.mode] = element
                        }}
                        type="button"
                        onClick={() => toggleMode(option.mode)}
                        aria-expanded={active}
                        aria-controls={`server-source-detail-${option.mode}`}
                        aria-hidden={active}
                        inert={active}
                        tabIndex={active ? -1 : 0}
                        className={cn(
                          "group flex min-h-64 w-full flex-col p-5 text-left outline-none transition-[min-height,padding] duration-700 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-6",
                          displaced && "sm:min-h-52 sm:p-4",
                        )}
                        style={{
                          opacity: active ? 0 : 1,
                          filter: active ? "blur(12px)" : "blur(0px)",
                          transform: active ? "scale(0.94)" : "scale(1)",
                          transition: `opacity 260ms ease, filter 420ms ease, transform 520ms ${EASE}`,
                          pointerEvents: active ? "none" : "auto",
                        }}
                      >
                        <span className="flex w-full items-start justify-between gap-3">
                          <span
                            className={cn(
                              "flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border/55 bg-background/35 text-foreground shadow-sm transition-[width,height,border-radius,background-color,color] duration-500 group-hover:bg-background/55",
                              displaced && "sm:size-10 sm:rounded-xl",
                            )}
                          >
                            <Icon className="size-5" aria-hidden="true" />
                          </span>
                          <Badge variant="outline" className="border-border/55 bg-background/25 text-muted-foreground">
                            {option.eyebrow}
                          </Badge>
                        </span>

                        <span className={cn("mt-5 block transition-[margin] duration-500", displaced && "sm:mt-4")}>
                          <span className="block text-xl font-semibold tracking-tight text-foreground">{option.title}</span>
                          <span
                            className={cn(
                              "mt-2 block max-h-24 max-w-md overflow-hidden text-sm leading-6 text-muted-foreground transition-[max-height,margin,opacity,filter] duration-500",
                              displaced && "sm:mt-0 sm:max-h-0 sm:opacity-0 sm:blur-sm",
                            )}
                          >
                            {option.description}
                          </span>
                        </span>

                        <span
                          className={cn(
                            "mt-5 flex max-h-24 flex-col gap-2 overflow-hidden opacity-100 transition-[max-height,margin,opacity,filter] duration-500",
                            displaced && "sm:mt-0 sm:max-h-0 sm:opacity-0 sm:blur-sm",
                          )}
                        >
                          {option.features.map((feature) => (
                            <span key={feature} className="flex items-center gap-2 text-xs leading-5 text-muted-foreground">
                              <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/30 text-foreground/70">
                                <Check className="size-2.5" aria-hidden="true" />
                              </span>
                              {feature}
                            </span>
                          ))}
                        </span>

                        <span className="mt-auto flex w-full items-center justify-between pt-5 text-sm font-medium text-foreground">
                          <span>{displaced ? "切换到此方式" : "选择此方式"}</span>
                          <span className="flex size-8 items-center justify-center rounded-full border border-border/55 bg-background/25 transition-all duration-300 group-hover:translate-x-0.5 group-hover:bg-background/50">
                            <ArrowRight className="size-3.5" aria-hidden="true" />
                          </span>
                        </span>
                      </button>
                    </div>
                  </div>

                  <div
                    id={`server-source-detail-${option.mode}`}
                    className={cn("grid motion-reduce:transition-none", !active && "pointer-events-none")}
                    aria-hidden={!active}
                    style={{
                      gridTemplateRows: active ? "1fr" : "0fr",
                      transition: active ? "none" : `grid-template-rows 720ms ${EASE}`,
                    }}
                  >
                    <div className="min-h-0 overflow-hidden">
                      {opened && (
                        <div
                          style={{
                            opacity: active ? 1 : 0,
                            filter: active ? "blur(0px)" : "blur(14px)",
                            transition: `opacity 440ms ease ${active ? "160ms" : "0ms"}, filter 520ms ease ${active ? "160ms" : "0ms"}`,
                          }}
                        >
                          {option.mode === "local" ? (
                            <LocalControlServerManager surface="onboarding" onConnected={finish} onCollapse={() => toggleMode("local")} />
                          ) : (
                            <section className="overflow-hidden">
                              <div className="flex flex-col gap-4 border-b border-border/45 bg-foreground/[0.018] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                                <div className="flex min-w-0 items-center gap-3.5">
                                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border/55 bg-background/35 text-foreground shadow-sm">
                                    <Cloud className="size-5" aria-hidden="true" />
                                  </span>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h2 className="text-base font-semibold text-foreground">连接云端控制服务</h2>
                                      <Badge variant="outline" className="border-border/55 bg-background/25 text-muted-foreground">远程 API</Badge>
                                    </div>
                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">输入部署地址与访问密钥，验证通过后即可继续。</p>
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <LockKeyhole className="size-3.5" aria-hidden="true" />
                                    凭据仅保存在当前浏览器
                                  </span>
                                  <Button type="button" variant="ghost" size="sm" className="rounded-xl" data-source-collapse onClick={() => toggleMode("cloud")}>
                                    <ChevronUp data-icon="inline-start" aria-hidden="true" />
                                    收起
                                  </Button>
                                </div>
                              </div>

                              <div className="mx-auto flex max-w-2xl flex-col gap-5 p-5 sm:p-6">
                                <div className="flex flex-col gap-4">
                                  <label htmlFor="cloud-api" className="flex flex-col gap-2">
                                    <span className="flex items-center justify-between gap-3 text-xs font-medium text-foreground">
                                      云端 API 地址
                                      <span className="font-normal text-muted-foreground">HTTP 或 HTTPS</span>
                                    </span>
                                    <span className="relative block">
                                      <Link2 className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                      <Input
                                        id="cloud-api"
                                        type="url"
                                        value={api}
                                        onChange={(event) => {
                                          setApi(event.target.value)
                                          setConnectionStatus("idle")
                                          setConnectionError("")
                                        }}
                                        placeholder="https://api.example.com"
                                        autoComplete="url"
                                        aria-invalid={connectionStatus === "error" && connectionError.includes("地址")}
                                        className="h-11 rounded-xl border-border/55 bg-background/30 pl-10 shadow-none backdrop-blur-sm"
                                      />
                                    </span>
                                  </label>

                                  <label htmlFor="cloud-key" className="flex flex-col gap-2">
                                    <span className="flex items-center justify-between gap-3 text-xs font-medium text-foreground">
                                      Panel API Key
                                      <span className="font-normal text-muted-foreground">用于面板鉴权</span>
                                    </span>
                                    <span className="relative block">
                                      <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                      <Input
                                        id="cloud-key"
                                        type="password"
                                        value={key}
                                        onChange={(event) => {
                                          setKey(event.target.value)
                                          setConnectionStatus("idle")
                                          setConnectionError("")
                                        }}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229 && cloudReady) void confirmCloud()
                                        }}
                                        placeholder="输入 Panel API Key"
                                        autoComplete="off"
                                        aria-invalid={connectionStatus === "error" && connectionError.includes("Key")}
                                        className="h-11 rounded-xl border-border/55 bg-background/30 pl-10 font-mono shadow-none backdrop-blur-sm"
                                      />
                                    </span>
                                  </label>
                                </div>

                                <div className="flex flex-col gap-2 rounded-2xl bg-background/20 px-4 py-3 ring-1 ring-border/40 sm:flex-row sm:items-center sm:justify-between">
                                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <ShieldCheck className="size-4 text-foreground/70" aria-hidden="true" />
                                    连接前会校验服务身份与面板权限
                                  </span>
                                  <span className="text-xs text-muted-foreground">不会上传至 NachoPanel</span>
                                </div>

                                {connectionStatus === "error" && (
                                  <Alert variant="destructive" className="border-destructive/25 bg-destructive/5" aria-live="polite">
                                    <AlertCircle aria-hidden="true" />
                                    <AlertTitle>连接验证失败</AlertTitle>
                                    <AlertDescription>{connectionError}</AlertDescription>
                                  </Alert>
                                )}

                                <Button
                                  type="button"
                                  variant="outline"
                                  size="lg"
                                  onClick={() => void confirmCloud()}
                                  disabled={!cloudReady || connectionStatus === "testing" || connectionStatus === "success"}
                                  className="h-11 w-full rounded-xl"
                                >
                                  {connectionStatus === "testing" && <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />}
                                  {connectionStatus === "success" && <Check data-icon="inline-start" aria-hidden="true" />}
                                  {connectionStatus === "testing" ? "正在校验连接" : connectionStatus === "success" ? "校验成功" : "验证并使用云端服务"}
                                  {connectionStatus === "idle" || connectionStatus === "error" ? <ArrowRight data-icon="inline-end" aria-hidden="true" /> : null}
                                </Button>
                              </div>
                            </section>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
