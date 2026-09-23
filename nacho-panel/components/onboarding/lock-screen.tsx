"use client"

import { useEffect, useState } from "react"
import { ArrowRight, KeyRound, LockKeyhole, LockKeyholeOpen, RotateCcw, ShieldCheck } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { getAvatar } from "./avatars"
import { useOnboarding } from "./onboarding-context"

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"

/**
 * 锁屏：退出登录后展示。跳过完整首次流程，
 * 仅需输入注册时的登录密钥（密钥注册）或密码（密码注册）即可解锁。
 */
export function LockScreen() {
  const { userName, avatarId, customAvatar, auth, startUnlock, reset } = useOnboarding()
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
  const avatar = getAvatar(avatarId)
  const isCustomAvatar = avatarId === "custom" && Boolean(customAvatar)
  const avatarSource = isCustomAvatar ? customAvatar! : avatar.src

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
      className="relative isolate flex h-full w-full items-center justify-center overflow-hidden px-4 py-5 sm:px-6"
      style={{
        opacity: leaving ? 0 : 1,
        filter: leaving ? "blur(14px)" : "blur(0px)",
        transform: leaving ? "scale(0.97)" : "scale(1)",
        transition: `opacity 500ms ease, filter 500ms ease, transform 500ms ${EASE}`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 -z-20"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--foreground) 8%, transparent) 0, transparent 36%), radial-gradient(circle at 86% 100%, color-mix(in srgb, var(--foreground) 4%, transparent) 0, transparent 30%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.035]"
        aria-hidden="true"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--foreground) 1px, transparent 1px), linear-gradient(to bottom, var(--foreground) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(circle at center, black, transparent 76%)",
        }}
      />

      <div className="absolute left-5 top-5 flex items-center gap-2.5 sm:left-8 sm:top-7" style={reveal(0)}>
        <BrandLogo className="size-7" />
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight text-foreground">NachoPanel</p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Control Center</p>
        </div>
      </div>

      <section
        aria-labelledby="lock-screen-title"
        className="relative w-full max-w-[27rem] overflow-hidden rounded-[1.75rem] border border-border/60 bg-card/48 p-5 shadow-[0_28px_90px_-52px_rgba(0,0,0,0.95)] backdrop-blur-2xl sm:p-6"
        style={reveal(90)}
      >
        <span
          className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-foreground/25 to-transparent"
          aria-hidden="true"
        />

        <header className="flex items-center gap-3.5" style={reveal(150)}>
          <div className="relative shrink-0">
            <div className="flex size-14 items-center justify-center overflow-hidden rounded-2xl border border-border/60 bg-background/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarSource}
                alt={`${userName} 的头像`}
                className={cn("size-full", isCustomAvatar ? "object-cover" : "scale-[0.88] object-contain")}
              />
            </div>
            <span
              className={cn(
                "absolute -bottom-1 -right-1 flex size-6 items-center justify-center overflow-hidden rounded-full border border-border bg-surface text-foreground shadow-md transition-colors duration-500",
                unlocked && "bg-foreground text-background",
              )}
              style={{ transform: unlocked ? "scale(1.12)" : "scale(1)", transition: `transform 550ms ${EASE}` }}
            >
              <span
                className="absolute"
                style={{
                  opacity: unlocked ? 0 : 1,
                  transform: unlocked ? "translateY(-8px) rotate(-10deg) scale(0.75)" : "translateY(0) scale(1)",
                  filter: unlocked ? "blur(4px)" : "blur(0px)",
                  transition: `opacity 400ms ease, transform 520ms ${EASE}, filter 400ms ease`,
                }}
              >
                {isKey ? <KeyRound className="size-3.5" aria-hidden="true" /> : <LockKeyhole className="size-3.5" aria-hidden="true" />}
              </span>
              <span
                className="absolute"
                style={{
                  opacity: unlocked ? 1 : 0,
                  transform: unlocked ? "translateY(0) scale(1)" : "translateY(8px) rotate(10deg) scale(0.75)",
                  filter: unlocked ? "blur(0px)" : "blur(4px)",
                  transition: `opacity 400ms ease 100ms, transform 520ms ${EASE} 100ms, filter 400ms ease 100ms`,
                }}
                aria-hidden={!unlocked}
              >
                <LockKeyholeOpen className="size-3.5" aria-hidden="true" />
              </span>
            </span>
          </div>

          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-medium tracking-[0.16em] text-muted-foreground">面板已锁定</p>
            <h1 id="lock-screen-title" className="truncate text-xl font-semibold tracking-tight text-foreground">
              {`${userName}，欢迎回来`}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">验证{isKey ? "登录密钥" : "登录密码"}后继续管理</p>
          </div>
        </header>

        <div className="mt-6 flex flex-col gap-2" style={reveal(230)}>
          <label htmlFor="unlock-credential" className="flex items-center justify-between gap-3 text-xs font-medium text-foreground">
            {isKey ? "登录密钥" : "登录密码"}
            <span className="font-normal text-muted-foreground">仅在此设备校验</span>
          </label>
          <Input
            id="unlock-credential"
            type={isKey ? "text" : "password"}
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              if (error) setError(false)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) submit()
            }}
            placeholder={isKey ? "NP-XXXX-XXXX-XXXX" : "输入登录密码"}
            aria-invalid={error}
            aria-describedby="unlock-status"
            autoComplete={isKey ? "off" : "current-password"}
            autoFocus
            className={cn(
              "h-11 rounded-xl border-border/55 bg-background/30 px-3.5 shadow-none backdrop-blur-sm",
              error && "animate-lock-shake",
              isKey && "font-mono tracking-wider",
            )}
          />
          <p
            id="unlock-status"
            aria-live="polite"
            className="min-h-5 text-xs text-negative transition-[opacity,transform] duration-300"
            style={{ opacity: error ? 1 : 0, transform: error ? "translateY(0)" : "translateY(-3px)" }}
          >
            {isKey ? "密钥不正确，请重试" : "密码不正确，请重试"}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3" style={reveal(300)}>
          <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-foreground/70" aria-hidden="true" />
            凭据保留在本机
          </span>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={submit}
            disabled={value.trim().length === 0}
            className="h-10 shrink-0 rounded-xl bg-background/30 px-4"
          >
            进入面板
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Button>
        </div>

        {confirmReset ? (
          <div
            className="mt-5 flex flex-col gap-3 rounded-2xl border border-negative/25 bg-negative/5 p-3.5 sm:flex-row sm:items-center sm:justify-between"
            aria-live="polite"
          >
            <p className="text-xs leading-5 text-muted-foreground">将清除本机保存的登录方式、用户名和头像。</p>
            <div className="flex shrink-0 justify-end gap-1.5">
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmReset(false)} className="rounded-lg">
                取消
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={reset} className="rounded-lg">
                确认重置
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 border-t border-border/45 pt-3.5 text-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmReset(true)}
              className="rounded-xl text-muted-foreground"
            >
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              重新初始化此面板
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
