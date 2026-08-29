"use client"

import { useEffect, useState } from "react"
import { ArrowRight, KeyRound, LockKeyhole, LockKeyholeOpen, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { useOnboarding } from "./onboarding-context"

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"

/**
 * 锁屏：退出登录后展示。跳过完整首次流程，
 * 仅需输入注册时的登录密钥（密钥注册）或密码（密码注册）即可解锁。
 */
export function LockScreen() {
  const { userName, auth, startUnlock, reset } = useOnboarding()
  const [shown, setShown] = useState(false)
  const [value, setValue] = useState("")
  const [error, setError] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // 校验通过后先播放「锁 → 解锁」动画，再整体渐隐离场
  const [unlocked, setUnlocked] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const isKey = auth?.mode === "key"

  const submit = () => {
    if (leaving || unlocked || !auth) return
    // 密钥不区分大小写比对，密码严格比对
    const ok = isKey
      ? value.trim().toUpperCase() === auth.secret.toUpperCase()
      : value === auth.secret
    if (!ok) {
      setError(true)
      window.setTimeout(() => setError(false), 600)
      return
    }
    // 时序：锁徽章变为解锁姿态（约 900ms）→ 整体渐隐 → 进入主页
    setUnlocked(true)
    window.setTimeout(() => setLeaving(true), 900)
    window.setTimeout(startUnlock, 1400)
  }

  /** 错峰入场揭示样式 */
  const reveal = (delay: number): React.CSSProperties => ({
    opacity: shown ? 1 : 0,
    transform: shown ? "translateY(0)" : "translateY(26px)",
    filter: shown ? "blur(0px)" : "blur(12px)",
    transition: `opacity 700ms ease, transform 700ms ${EASE}, filter 700ms ease`,
    transitionDelay: shown ? `${delay}ms` : "0ms",
  })

  return (
    <div
      className="flex h-full w-full items-center justify-center px-6"
      style={{
        opacity: leaving ? 0 : 1,
        filter: leaving ? "blur(14px)" : "blur(0px)",
        transform: leaving ? "scale(0.97)" : "scale(1)",
        transition: `opacity 500ms ease, filter 500ms ease, transform 500ms ${EASE}`,
      }}
    >
      <div className="flex w-full max-w-md flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3">
          <span
            className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-3xl transition-colors duration-500"
            style={{
              ...reveal(0),
              // 解锁成功时徽章轻微放大庆祝，随入场揭示共用 transform 故叠加 scale
              transform: shown
                ? unlocked
                  ? "translateY(0) scale(1.08)"
                  : "translateY(0)"
                : "translateY(26px)",
              backgroundColor: unlocked ? "color-mix(in oklab, var(--color-primary) 18%, transparent)" : undefined,
            }}
          >
            <span className={cn("absolute inset-0 rounded-3xl", !unlocked && "bg-muted")} aria-hidden="true" />
            {/* 锁定图标：解锁时向上弹出并模糊淡出 */}
            <span
              className="absolute text-primary"
              style={{
                opacity: unlocked ? 0 : 1,
                transform: unlocked ? "translateY(-14px) rotate(-10deg) scale(0.85)" : "translateY(0) rotate(0deg) scale(1)",
                filter: unlocked ? "blur(6px)" : "blur(0px)",
                transition: `opacity 450ms ease, transform 550ms ${EASE}, filter 450ms ease`,
              }}
            >
              {isKey ? <KeyRound className="h-7 w-7" /> : <LockKeyhole className="h-7 w-7" />}
            </span>
            {/* 解锁图标：从下方带模糊弹入，锁梁张开 */}
            <span
              className="absolute text-primary"
              style={{
                opacity: unlocked ? 1 : 0,
                transform: unlocked ? "translateY(0) rotate(0deg) scale(1)" : "translateY(14px) rotate(10deg) scale(0.85)",
                filter: unlocked ? "blur(0px)" : "blur(6px)",
                transition: `opacity 450ms ease 120ms, transform 550ms ${EASE} 120ms, filter 450ms ease 120ms`,
              }}
              aria-hidden={!unlocked}
            >
              <LockKeyholeOpen className="h-7 w-7" />
            </span>
          </span>
          <h1
            className="text-balance text-center text-2xl font-semibold text-foreground sm:text-3xl"
            style={reveal(100)}
          >
            {`欢迎回来，${userName}`}
          </h1>
          <p className="text-sm text-muted-foreground" style={reveal(200)}>
            {isKey ? "请输入登录密钥以解锁 NachoPanel" : "请输入密码以解锁 NachoPanel"}
          </p>
        </div>

        <div className="flex w-full flex-col gap-3" style={reveal(320)}>
          <label
            className={cn(
              "flex h-13 items-center gap-2.5 rounded-full border bg-card px-5 py-3.5 transition-colors focus-within:border-primary/50",
              error ? "animate-lock-shake border-negative/70" : "border-border",
            )}
          >
            {isKey ? (
              <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <LockKeyhole className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <input
              type={isKey ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) submit()
              }}
              placeholder={isKey ? "NP-XXXX-XXXX-XXXX" : "登录密码"}
              aria-label={isKey ? "登录密钥" : "登录密码"}
              autoFocus
              className={cn(
                "w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60",
                isKey && "font-mono tracking-wider",
              )}
            />
          </label>
          <p
            aria-live="polite"
            className="h-4 text-center text-xs text-negative transition-opacity duration-300"
            style={{ opacity: error ? 1 : 0 }}
          >
            {isKey ? "密钥不正确，请重试" : "密码不正确，请重试"}
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={value.trim().length === 0}
            className="flex h-12 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-300 ease-out hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            解锁
            <ArrowRight className="h-4 w-4" />
          </button>
          {confirmReset ? (
            <div className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-negative/30 bg-negative/5 px-4 py-2.5">
              <p className="text-xs leading-relaxed text-muted-foreground">
                将清除本机保存的登录方式、用户名和头像，并重新进入首次设置。
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="h-8 px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="h-8 rounded-md bg-negative px-3 text-xs font-medium text-white transition-opacity hover:opacity-90"
                >
                  确认重置
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="flex h-9 items-center justify-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              重新初始化此面板
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
