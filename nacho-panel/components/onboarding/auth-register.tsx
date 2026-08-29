"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Copy, KeyRound, LockKeyhole, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { useOnboarding } from "./onboarding-context"

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"

type Mode = "key" | "password"

/** 生成形如 NP-XXXX-XXXX-XXXX 的登录密钥（去除易混淆字符） */
function generateKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const raw = Array.from(bytes, (b) => chars[b % chars.length]).join("")
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
  const [leaving, setLeaving] = useState(false)

  // 密钥模式
  const [genKey, setGenKey] = useState("")
  const [copied, setCopied] = useState(false)
  // 密码模式
  const [pwd, setPwd] = useState("")
  const [pwd2, setPwd2] = useState("")

  // 文字"被卡片推上去"的惯性跟随（与服务端注册一致）：
  // 每次展开/收起时切换关键帧动画并借助 key 重放，方向决定推动来向。
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

  // 首次展开密钥卡片时自动生成
  useEffect(() => {
    if (selected === "key" && !genKey) setGenKey(generateKey())
  }, [selected, genKey])

  const copyKey = async () => {
    if (!genKey) return
    let ok = false
    // 优先使用异步剪贴板 API（需安全上下文）
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(genKey)
        ok = true
      }
    } catch {
      ok = false
    }
    // 降级方案：在 iframe / 非安全上下文中通过临时 textarea + execCommand 复制
    if (!ok) {
      try {
        const ta = document.createElement("textarea")
        ta.value = genKey
        ta.setAttribute("readonly", "")
        ta.style.position = "fixed"
        ta.style.top = "-9999px"
        ta.style.opacity = "0"
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        ok = document.execCommand("copy")
        document.body.removeChild(ta)
      } catch {
        ok = false
      }
    }
    // 无论走哪条路径，只要成功就给出反馈
    if (ok) {
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

  /** 错峰入场揭示样式 */
  const reveal = (delay: number): React.CSSProperties => ({
    opacity: shown ? 1 : 0,
    transform: shown ? "translateY(0)" : "translateY(26px)",
    filter: shown ? "blur(0px)" : "blur(12px)",
    transition: `opacity 700ms ease, transform 700ms ${EASE}, filter 700ms ease`,
    transitionDelay: shown ? `${delay}ms` : "0ms",
  })

  const pwdReady = pwd.trim().length >= 4 && pwd === pwd2

  const cards: { mode: Mode; icon: React.ReactNode; title: string; desc: string }[] = [
    {
      mode: "key",
      icon: <KeyRound className="h-6 w-6" />,
      title: "生成登录密钥",
      desc: "自动生成专属密钥，请妥善保存",
    },
    {
      mode: "password",
      icon: <LockKeyhole className="h-6 w-6" />,
      title: "设置密码",
      desc: "自定义登录密码，至少 4 位字符",
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
            最后，设置您的登录方式
          </h1>
          <p className="text-sm text-muted-foreground" style={reveal(120)}>
            退出登录后将凭此密钥或密码解锁 NachoPanel
          </p>
        </div>

        <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-start">
          {cards.map((c, i) => {
            const active = selected === c.mode
            const dimmed = selected !== null && !active
            return (
              // 外层承载入场错峰揭示，内层承载选中/让位过渡
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
                        active
                          ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                          : "bg-muted text-primary",
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
                      {c.mode === "key" ? (
                        <>
                          <div className="flex h-12 items-center gap-2 rounded-full border border-border bg-card px-4">
                            {/* 密钥 / 「已复制」两层叠放，点击复制时交叉模糊渐隐渐显，复位后自动反向切回。
                                注意：不使用 overflow-hidden，避免模糊光晕被裁成方形硬边。 */}
                            <span className="relative flex-1">
                              <span
                                className="block whitespace-nowrap font-mono text-sm tracking-wider text-foreground"
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
                                className="absolute inset-0 flex items-center whitespace-nowrap text-sm font-medium tracking-wide text-primary"
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
                            <button
                              type="button"
                              onClick={regenerate}
                              aria-label="重新生成密钥"
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all duration-300 hover:bg-muted hover:text-foreground active:scale-90"
                            >
                              <RefreshCw className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={copyKey}
                              aria-label={copied ? "已复制" : "复制密钥"}
                              className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-300 active:scale-90",
                                copied
                                  ? "bg-primary text-primary-foreground"
                                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
                              )}
                            >
                              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </button>
                          </div>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            密钥仅显示这一次，请复制并妥善保存。退出登录后需凭此密钥解锁。
                          </p>
                          <button
                            type="button"
                            onClick={() => confirm("key")}
                            className="flex h-12 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-300 ease-out hover:scale-[1.02] active:scale-95"
                          >
                            <Check className="h-4 w-4" />
                            我已保存，使用密钥登录
                          </button>
                        </>
                      ) : (
                        <>
                          <label className="flex h-12 items-center gap-2.5 rounded-full border border-border bg-card px-4 transition-colors focus-within:border-primary/50">
                            <LockKeyhole className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <input
                              type="password"
                              value={pwd}
                              onChange={(e) => setPwd(e.target.value)}
                              placeholder="设置密码（至少 4 位）"
                              aria-label="设置密码"
                              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
                            />
                          </label>
                          <label className="flex h-12 items-center gap-2.5 rounded-full border border-border bg-card px-4 transition-colors focus-within:border-primary/50">
                            <LockKeyhole className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <input
                              type="password"
                              value={pwd2}
                              onChange={(e) => setPwd2(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229 && pwdReady)
                                  confirm("password")
                              }}
                              placeholder="再次输入确认"
                              aria-label="确认密码"
                              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => confirm("password")}
                            disabled={!pwdReady}
                            className="flex h-12 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-300 ease-out hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                          >
                            <Check className="h-4 w-4" />
                            确认使用密码登录
                          </button>
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
