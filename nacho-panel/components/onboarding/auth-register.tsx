"use client"

import { useEffect, useRef, useState } from "react"
import {
  ArrowRight,
  Check,
  ChevronUp,
  Copy,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useOnboarding } from "./onboarding-context"

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"

type Mode = "key" | "password"

const authOptions = [
  {
    mode: "key" as const,
    icon: KeyRound,
    eyebrow: "自动生成",
    title: "生成登录密钥",
    description: "创建一组高强度随机密钥，适合希望快速完成设置并安全保存凭据的场景。",
    detailDescription: "生成专属随机密钥，复制并妥善保存后即可继续。",
    features: ["自动避开容易混淆的字符", "仅在本次设置过程中完整显示"],
  },
  {
    mode: "password" as const,
    icon: LockKeyhole,
    eyebrow: "自定义",
    title: "设置密码",
    description: "自行设置熟悉的登录密码，退出面板后使用同一密码重新解锁。",
    detailDescription: "输入两次相同密码，至少包含 4 位字符。",
    features: ["由你创建并在当前浏览器保存", "两次输入一致后才可确认"],
  },
]

/** 生成形如 NP-XXXX-XXXX-XXXX 的登录密钥（去除易混淆字符） */
function generateKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const raw = Array.from(bytes, (byte) => chars[byte % chars.length]).join("")
  return `NP-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`
}

/**
 * 第四部分：登录方式注册（二选一）。
 * 生成登录密钥：一键生成并复制保存；设置密码：输入两次确认。
 * 交互动效沿用服务端注册的卡片展开 + 文字错峰跟随模式。
 */
export function AuthRegister({ onDone }: { onDone: () => void }) {
  const { setAuth } = useOnboarding()
  const [shown, setShown] = useState(false)
  const [selected, setSelected] = useState<Mode | null>(null)
  const [openedModes, setOpenedModes] = useState<Mode[]>([])
  const [leaving, setLeaving] = useState(false)
  const [genKey, setGenKey] = useState("")
  const [copied, setCopied] = useState(false)
  const [pwd, setPwd] = useState("")
  const [pwd2, setPwd2] = useState("")
  const [push, setPush] = useState<{ dir: "up" | "down"; k: number } | null>(null)
  const cardButtons = useRef<Record<Mode, HTMLButtonElement | null>>({ key: null, password: null })
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

  useEffect(() => {
    if (selected === "key" && !genKey) setGenKey(generateKey())
  }, [selected, genKey])

  const copyKey = async () => {
    if (!genKey) return
    let copiedSuccessfully = false

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(genKey)
        copiedSuccessfully = true
      }
    } catch {
      copiedSuccessfully = false
    }

    if (!copiedSuccessfully) {
      try {
        const textarea = document.createElement("textarea")
        textarea.value = genKey
        textarea.setAttribute("readonly", "")
        textarea.style.position = "fixed"
        textarea.style.top = "-9999px"
        textarea.style.opacity = "0"
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        copiedSuccessfully = document.execCommand("copy")
        document.body.removeChild(textarea)
      } catch {
        copiedSuccessfully = false
      }
    }

    if (copiedSuccessfully) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
  }

  const regenerate = () => {
    setGenKey(generateKey())
    setCopied(false)
  }

  const confirm = (mode: Mode) => {
    if (leaving) return
    setAuth(mode === "key" ? { mode: "key", secret: genKey } : { mode: "password", secret: pwd })
    setLeaving(true)
    window.setTimeout(onDone, 750)
  }

  const toggleMode = (mode: Mode) => {
    const closing = selected === mode
    setOpenedModes((previous) => (previous.includes(mode) ? previous : [...previous, mode]))
    setSelected(closing ? null : mode)
    window.requestAnimationFrame(() => {
      // 展开中的 overflow-hidden 容器也会被 focus 滚动，随后滚动范围收缩会让内容先上冲再回正。
      if (closing) cardButtons.current[mode]?.focus({ preventScroll: true })
      else document.querySelector<HTMLElement>(`#auth-method-detail-${mode} [data-auth-collapse]`)?.focus({ preventScroll: true })
    })
  }

  const reveal = (delay: number): React.CSSProperties => ({
    opacity: shown ? 1 : 0,
    transform: shown ? "translateY(0)" : "translateY(18px)",
    filter: shown ? "blur(0px)" : "blur(7px)",
    transition: `opacity 650ms ease, transform 650ms ${EASE}, filter 650ms ease`,
    transitionDelay: shown ? `${delay}ms` : "0ms",
  })

  const pwdReady = pwd.trim().length >= 4 && pwd === pwd2
  const passwordMismatch = pwd2.length > 0 && pwd !== pwd2
  const passwordStatus =
    pwd.length === 0
      ? "密码至少需要 4 位字符"
      : pwd.trim().length < 4
        ? `还需要 ${4 - pwd.trim().length} 位字符`
        : pwd2.length === 0
          ? "再次输入密码后即可确认"
          : passwordMismatch
            ? "两次输入的密码不一致"
            : "两次输入一致，可以继续"

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
            "radial-gradient(circle at 50% 8%, color-mix(in srgb, var(--primary) 9%, transparent) 0, transparent 32%), radial-gradient(circle at 88% 80%, color-mix(in srgb, var(--foreground) 4%, transparent) 0, transparent 27%)",
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
          <Badge
            variant="outline"
            className="border-border/60 bg-background/35 px-2.5 text-muted-foreground backdrop-blur-md"
            style={reveal(0)}
          >
            <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
            登录保护
          </Badge>
          <h1
            className="text-balance text-center text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
            style={reveal(70)}
          >
            最后，设置你的登录方式
          </h1>
          <p
            className="max-w-xl text-balance text-center text-sm leading-6 text-muted-foreground sm:text-[15px]"
            style={reveal(140)}
          >
            密钥和密码都只保存在当前浏览器中，退出登录后将凭所选方式重新解锁 NachoPanel。
          </p>
        </header>

        <div className="auth-choice-grid w-full items-start gap-3.5 sm:gap-4" data-selected={selected ?? "none"}>
          {authOptions.map((option, index) => {
            const active = selected === option.mode
            const displaced = selected !== null && !active
            const opened = openedModes.includes(option.mode)
            const Icon = option.icon

            return (
              <div key={option.mode} className="min-w-0 self-start" style={reveal(220 + index * 110)}>
                <article
                  aria-label={`${option.title}登录方式`}
                  className={cn(
                    "relative isolate overflow-hidden rounded-[1.75rem] border border-border/55 bg-card/42 shadow-[0_18px_55px_-42px_rgba(0,0,0,0.9)] backdrop-blur-xl transition-[border-color,background-color,box-shadow,transform,opacity] duration-700 ease-out",
                    active &&
                      "-translate-y-1 border-border/80 bg-card/62 shadow-[0_24px_80px_-42px_rgba(0,0,0,0.92)] ring-1 ring-foreground/5",
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
                    style={{ gridTemplateRows: active ? "0fr" : "1fr", transition: `grid-template-rows 560ms ${EASE}` }}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <button
                        ref={(element) => {
                          cardButtons.current[option.mode] = element
                        }}
                        type="button"
                        onClick={() => toggleMode(option.mode)}
                        aria-expanded={active}
                        aria-controls={`auth-method-detail-${option.mode}`}
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
                    id={`auth-method-detail-${option.mode}`}
                    className={cn("grid motion-reduce:transition-none", !active && "pointer-events-none")}
                    aria-hidden={!active}
                    style={{ gridTemplateRows: active ? "1fr" : "0fr", transition: `grid-template-rows 720ms ${EASE}` }}
                  >
                    <div className="min-h-0 overflow-hidden">
                      {opened && (
                        <section
                          style={{
                            opacity: active ? 1 : 0,
                            filter: active ? "blur(0px)" : "blur(14px)",
                            transform: active ? "translateY(0) scale(1)" : "translateY(8px) scale(0.975)",
                            transition: `opacity 440ms ease ${active ? "160ms" : "0ms"}, filter 520ms ease ${active ? "160ms" : "0ms"}, transform 620ms ${EASE} ${active ? "140ms" : "0ms"}`,
                          }}
                        >
                          <div className="flex flex-col gap-4 border-b border-border/45 bg-foreground/[0.018] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                            <div className="flex min-w-0 items-center gap-3.5">
                              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border/55 bg-background/35 text-foreground shadow-sm">
                                <Icon className="size-5" aria-hidden="true" />
                              </span>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h2 className="text-base font-semibold text-foreground">{option.title}</h2>
                                  <Badge variant="outline" className="border-border/55 bg-background/25 text-muted-foreground">
                                    {option.eyebrow}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-muted-foreground">{option.detailDescription}</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                <ShieldCheck className="size-3.5" aria-hidden="true" />
                                凭据仅保存在当前浏览器
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="rounded-xl"
                                data-auth-collapse
                                onClick={() => toggleMode(option.mode)}
                              >
                                <ChevronUp data-icon="inline-start" aria-hidden="true" />
                                收起
                              </Button>
                            </div>
                          </div>

                          <div className="mx-auto flex max-w-2xl flex-col gap-5 p-5 sm:p-6">
                            {option.mode === "key" ? (
                              <>
                                <div className="flex flex-col gap-2">
                                  <span className="flex items-center justify-between gap-3 text-xs font-medium text-foreground">
                                    登录密钥
                                    <span className="font-normal text-muted-foreground">仅本次完整显示</span>
                                  </span>
                                  <div className="flex h-12 items-center gap-1 rounded-xl border border-border/55 bg-background/30 px-3 shadow-none backdrop-blur-sm">
                                    <span className="relative min-w-0 flex-1 px-1">
                                      <span
                                        className="block truncate whitespace-nowrap font-mono text-sm tracking-wider text-foreground"
                                        style={{
                                          opacity: copied ? 0 : 1,
                                          filter: copied ? "blur(5px)" : "blur(0px)",
                                          transition: `opacity 620ms ease, filter 620ms ${EASE}`,
                                        }}
                                        aria-hidden={copied}
                                      >
                                        {genKey || "…"}
                                      </span>
                                      <span
                                        className="absolute inset-0 flex items-center whitespace-nowrap px-1 text-sm font-medium text-foreground"
                                        style={{
                                          opacity: copied ? 1 : 0,
                                          filter: copied ? "blur(0px)" : "blur(5px)",
                                          transition: `opacity 620ms ease, filter 620ms ${EASE}`,
                                          pointerEvents: "none",
                                        }}
                                        aria-hidden={!copied}
                                      >
                                        已复制到剪贴板
                                      </span>
                                    </span>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={regenerate}
                                      aria-label="重新生成密钥"
                                      className="rounded-lg text-muted-foreground"
                                    >
                                      <RefreshCw aria-hidden="true" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={() => void copyKey()}
                                      aria-label={copied ? "已复制" : "复制密钥"}
                                      className={cn("rounded-lg text-muted-foreground", copied && "bg-muted text-foreground")}
                                    >
                                      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                                    </Button>
                                  </div>
                                  <span className="sr-only" aria-live="polite">
                                    {copied ? "登录密钥已复制到剪贴板" : ""}
                                  </span>
                                </div>

                                <div className="flex flex-col gap-2 rounded-2xl bg-background/20 px-4 py-3 ring-1 ring-border/40 sm:flex-row sm:items-center sm:justify-between">
                                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <ShieldCheck className="size-4 text-foreground/70" aria-hidden="true" />
                                    请先复制并妥善保管这组密钥
                                  </span>
                                  <span className="text-xs text-muted-foreground">退出登录后将用于解锁</span>
                                </div>

                                <Button
                                  type="button"
                                  variant="outline"
                                  size="lg"
                                  onClick={() => confirm("key")}
                                  className="h-11 w-full rounded-xl"
                                >
                                  <Check data-icon="inline-start" aria-hidden="true" />
                                  我已保存，使用密钥登录
                                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <div className="flex flex-col gap-4">
                                  <label htmlFor="auth-password" className="flex flex-col gap-2">
                                    <span className="flex items-center justify-between gap-3 text-xs font-medium text-foreground">
                                      登录密码
                                      <span className="font-normal text-muted-foreground">至少 4 位字符</span>
                                    </span>
                                    <span className="relative block">
                                      <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                      <Input
                                        id="auth-password"
                                        type="password"
                                        value={pwd}
                                        onChange={(event) => setPwd(event.target.value)}
                                        placeholder="输入登录密码"
                                        autoComplete="new-password"
                                        className="h-11 rounded-xl border-border/55 bg-background/30 pl-10 shadow-none backdrop-blur-sm"
                                      />
                                    </span>
                                  </label>

                                  <label htmlFor="auth-password-confirm" className="flex flex-col gap-2">
                                    <span className="flex items-center justify-between gap-3 text-xs font-medium text-foreground">
                                      确认密码
                                      <span className="font-normal text-muted-foreground">再次输入相同密码</span>
                                    </span>
                                    <span className="relative block">
                                      <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                      <Input
                                        id="auth-password-confirm"
                                        type="password"
                                        value={pwd2}
                                        onChange={(event) => setPwd2(event.target.value)}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229 && pwdReady) confirm("password")
                                        }}
                                        placeholder="再次输入密码"
                                        autoComplete="new-password"
                                        aria-describedby="auth-password-status"
                                        aria-invalid={passwordMismatch}
                                        className="h-11 rounded-xl border-border/55 bg-background/30 pl-10 shadow-none backdrop-blur-sm"
                                      />
                                    </span>
                                  </label>
                                </div>

                                <div
                                  id="auth-password-status"
                                  className={cn(
                                    "flex items-center gap-2 rounded-2xl bg-background/20 px-4 py-3 text-xs text-muted-foreground ring-1 ring-border/40",
                                    passwordMismatch && "text-destructive ring-destructive/25",
                                  )}
                                  aria-live="polite"
                                >
                                  <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
                                  {passwordStatus}
                                </div>

                                <Button
                                  type="button"
                                  variant="outline"
                                  size="lg"
                                  onClick={() => confirm("password")}
                                  disabled={!pwdReady}
                                  className="h-11 w-full rounded-xl"
                                >
                                  <Check data-icon="inline-start" aria-hidden="true" />
                                  确认使用密码登录
                                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                                </Button>
                              </>
                            )}
                          </div>
                        </section>
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
