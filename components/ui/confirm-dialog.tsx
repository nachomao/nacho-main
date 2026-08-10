"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Info, ShieldAlert, X } from "lucide-react"
import { cn } from "@/lib/utils"

/* ==================== 类型 ====================
 * 统一替代 window.confirm / window.prompt 的应用内弹层。
 * tone 决定强调色：danger=不可逆操作，warning=有副作用，default=常规确认。
 *
 * 传入 origin（触发按钮）时启用「就地展开」形态：
 * 卡片模糊淡出、圆形遮罩自按钮中心扩展至四角、内容去模糊显现，
 * 三段动画彼此重叠成一条连续动作；关闭时整体反向收回按钮。
 * 未传 origin 时回退为屏幕居中弹层。
 */

export type ConfirmTone = "default" | "warning" | "danger"

export type ConfirmOptions = {
  /** 弹层标题，一句话说明将发生什么 */
  title: string
  /** 补充段落，说明影响范围或风险 */
  description?: string
  /** 多行「键：值」明细，按行传入后自动解析成结构化清单 */
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
  /**
   * 触发该确认的按钮。提供后弹层会在按钮所属的 [data-confirm-surface]
   * 卡片内就地展开；找不到卡片时自动回退为居中弹层。
   */
  origin?: HTMLElement | null
}

export type PromptOptions = ConfirmOptions & {
  label?: string
  placeholder?: string
  defaultValue?: string
  /** 需要用户逐字输入该值才允许确认（用于删除账户这类不可逆操作） */
  requireValue?: string
}

type ConfirmApi = {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  promptText: (options: PromptOptions) => Promise<string | null>
}

type Pending =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void }

const ConfirmContext = createContext<ConfirmApi | null>(null)

/* ==================== 动画编排 ====================
 * 每段动画各自带 delay 并互相重叠，浏览器一次性插值到底，
 * 不再用 setTimeout 分段推进，因此中途没有重渲染与时序抖动。
 *
 *  展开 460ms      0 ─────────────────────────────► 460
 *    卡片模糊        ███████
 *    遮罩扩展            ████████████████████████████
 *    内容显现                        ████████████████
 */

const OPEN_TIMELINE = {
  veil: { delay: 0, duration: 110 },
  clip: { delay: 90, duration: 370 },
  content: { delay: 230, duration: 230 },
}
const OPEN_TOTAL = 460

const CLOSE_TIMELINE = {
  content: { delay: 0, duration: 110 },
  clip: { delay: 70, duration: 230 },
  unveil: { delay: 200, duration: 130 },
}
const CLOSE_TOTAL = 330

/** 确认后卡片通常随即被移除，收回过程整体加速 */
const ACCEPT_SPEED = 0.55

/** 遮罩扩展用 easeOutQuint 起步快、收尾稳；收回用镜像的 easeInQuint */
const EASE_EXPAND = "cubic-bezier(0.22, 1, 0.36, 1)"
const EASE_COLLAPSE = "cubic-bezier(0.64, 0, 0.78, 0)"
const EASE_SOFT = "cubic-bezier(0.4, 0, 0.2, 1)"

const SURFACE_BLUR = "blur(5px) saturate(0.9)"
const SURFACE_DIM = "0.4"
const CONTENT_BLUR = "blur(8px)"

/** 居中回退形态的退场时长，与 animate-dropdown-out 对齐 */
const CENTERED_OUT_MS = 130

type Geometry = {
  /** 卡片静止状态相对视口的位置 */
  top: number
  left: number
  width: number
  height: number
  radius: string
  /** 按钮中心相对卡片左上角的坐标 */
  originX: number
  originY: number
  /** 覆盖卡片四角所需的最小半径 */
  maxRadius: number
}

/* ==================== 明细解析 ====================
 * 把 "Shell：powershell\n目标：win-office-07\n超时：300 秒" 这类多行文本
 * 解析成键值清单，其余行作为独立说明段落展示。
 */

type DetailRow = { label: string; value: string }

function parseBody(body: string | undefined): { rows: DetailRow[]; notes: string[] } {
  const rows: DetailRow[] = []
  const notes: string[] = []
  if (!body) return { rows, notes }
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    const matched = /^(.{1,16}?)[：:]\s*(.+)$/.exec(line)
    if (matched && matched[2].trim()) rows.push({ label: matched[1].trim(), value: matched[2].trim() })
    else notes.push(line)
  }
  return { rows, notes }
}

const toneStyles: Record<ConfirmTone, { icon: typeof Info; text: string; ring: string; confirm: string }> = {
  default: {
    icon: Info,
    text: "text-primary",
    ring: "bg-primary/12 ring-primary/25",
    confirm: "bg-primary text-primary-foreground hover:brightness-110",
  },
  warning: {
    icon: AlertTriangle,
    text: "text-warning",
    ring: "bg-warning/12 ring-warning/25",
    confirm: "bg-warning text-background hover:brightness-110",
  },
  danger: {
    icon: ShieldAlert,
    text: "text-negative",
    ring: "bg-negative/12 ring-negative/25",
    confirm: "bg-negative text-foreground hover:brightness-110",
  },
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/* ==================== 几何测量 ====================
 * 卡片常带 hover:-translate-y-1 的位移。弹层遮住卡片后 hover 失效，
 * 卡片会自行回落，因此这里扣掉当前 transform 的平移量，
 * 直接按「静止位置」定位弹层，避免落位时出现几像素错位。
 */

function translationOf(el: HTMLElement): { x: number; y: number } {
  const raw = window.getComputedStyle(el).transform
  if (!raw || raw === "none") return { x: 0, y: 0 }
  try {
    const matrix = new DOMMatrixReadOnly(raw)
    return { x: matrix.m41, y: matrix.m42 }
  } catch {
    return { x: 0, y: 0 }
  }
}

function measure(surface: HTMLElement, origin: HTMLElement): Geometry {
  const rect = surface.getBoundingClientRect()
  const originRect = origin.getBoundingClientRect()
  const shift = translationOf(surface)

  // 按钮与卡片被同一 transform 平移，相对坐标无需修正
  const originX = originRect.left + originRect.width / 2 - rect.left
  const originY = originRect.top + originRect.height / 2 - rect.top

  const maxRadius = Math.max(
    Math.hypot(originX, originY),
    Math.hypot(rect.width - originX, originY),
    Math.hypot(originX, rect.height - originY),
    Math.hypot(rect.width - originX, rect.height - originY),
  )

  return {
    top: rect.top - shift.y,
    left: rect.left - shift.x,
    width: rect.width,
    height: rect.height,
    radius: window.getComputedStyle(surface).borderRadius || "1rem",
    originX,
    originY,
    maxRadius: Math.ceil(maxRadius),
  }
}

/* ==================== Provider ==================== */

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const [centeredClosing, setCenteredClosing] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [value, setValue] = useState("")

  const surfaceRef = useRef<HTMLElement | null>(null)
  const originRef = useRef<HTMLElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  const animations = useRef<Animation[]>([])
  const closeTimer = useRef<number | null>(null)
  /** 防止同一次展开被 effect 重复触发 */
  const openedFor = useRef<Pending | null>(null)
  const closingRef = useRef(false)

  const stopAnimations = useCallback(() => {
    animations.current.forEach((animation) => animation.cancel())
    animations.current = []
  }, [])

  const play = useCallback(
    (el: HTMLElement, keyframes: Keyframe[], timing: KeyframeAnimationOptions) => {
      const animation = el.animate(keyframes, { fill: "both", ...timing })
      animations.current.push(animation)
      return animation
    },
    [],
  )

  useEffect(() => {
    setMounted(true)
    return () => {
      animations.current.forEach((animation) => animation.cancel())
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
      if (surfaceRef.current) releaseSurface(surfaceRef.current)
    }
  }, [])

  const finish = useCallback(() => {
    stopAnimations()
    if (surfaceRef.current) releaseSurface(surfaceRef.current)
    surfaceRef.current = null
    originRef.current = null
    openedFor.current = null
    closingRef.current = false
    setPending(null)
    setGeometry(null)
    setCenteredClosing(false)
    setValue("")
    restoreFocus.current?.focus?.()
    restoreFocus.current = null
  }, [stopAnimations])

  const settle = useCallback(
    (accepted: boolean) => {
      const current = pending
      if (!current || closingRef.current) return
      closingRef.current = true

      if (current.kind === "confirm") current.resolve(accepted)
      else current.resolve(accepted ? inputRef.current?.value ?? "" : null)

      const surface = surfaceRef.current
      const dialog = dialogRef.current
      const content = contentRef.current
      const geo = geometry

      // 居中回退形态：交给 CSS 退场动画
      if (!surface || !dialog || !content || !geo) {
        setCenteredClosing(true)
        closeTimer.current = window.setTimeout(finish, CENTERED_OUT_MS)
        return
      }

      stopAnimations()
      content.style.pointerEvents = "none"

      if (prefersReducedMotion()) {
        finish()
        return
      }

      // 确认后卡片一般立即消失，整体收回加速
      const speed = accepted ? ACCEPT_SPEED : 1
      const at = (step: { delay: number; duration: number }) => ({
        delay: Math.round(step.delay * speed),
        duration: Math.round(step.duration * speed),
      })

      play(
        content,
        [
          { opacity: 1, filter: "blur(0px)" },
          { opacity: 0, filter: CONTENT_BLUR },
        ],
        { ...at(CLOSE_TIMELINE.content), easing: EASE_SOFT },
      )

      play(
        dialog,
        [
          { clipPath: `circle(${geo.maxRadius}px at ${geo.originX}px ${geo.originY}px)` },
          { clipPath: `circle(0px at ${geo.originX}px ${geo.originY}px)` },
        ],
        { ...at(CLOSE_TIMELINE.clip), easing: EASE_COLLAPSE },
      )

      play(
        surface,
        [
          { opacity: SURFACE_DIM, filter: SURFACE_BLUR },
          { opacity: "1", filter: "blur(0px)" },
        ],
        { ...at(CLOSE_TIMELINE.unveil), easing: EASE_SOFT },
      )

      closeTimer.current = window.setTimeout(finish, Math.round(CLOSE_TOTAL * speed))
    },
    [finish, geometry, pending, play, stopAnimations],
  )

  const open = useCallback(
    (next: Pending, initialValue: string) => {
      stopAnimations()
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
      if (surfaceRef.current) releaseSurface(surfaceRef.current)

      closingRef.current = false
      openedFor.current = null
      restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setValue(initialValue)
      setCenteredClosing(false)

      const origin = next.options.origin ?? null
      const surface = origin?.closest<HTMLElement>("[data-confirm-surface]") ?? null

      if (!origin || !surface) {
        surfaceRef.current = null
        originRef.current = null
        setGeometry(null)
        setPending(next)
        return
      }

      surfaceRef.current = surface
      originRef.current = origin
      // 立刻交出交互权，卡片随之解除 hover 并回落到静止位置
      surface.style.pointerEvents = "none"
      surface.style.willChange = "filter, opacity"

      setGeometry(measure(surface, origin))
      setPending(next)
    },
    [stopAnimations],
  )

  /* 展开：等弹层节点就位后一次性排好三段重叠动画 */
  useEffect(() => {
    if (!pending || !geometry || openedFor.current === pending) return
    const surface = surfaceRef.current
    const dialog = dialogRef.current
    const content = contentRef.current
    if (!surface || !dialog || !content) return
    openedFor.current = pending

    const focusTarget = () => {
      const target = pending.kind === "prompt" ? inputRef.current : confirmRef.current
      target?.focus({ preventScroll: true })
    }

    if (prefersReducedMotion()) {
      dialog.style.clipPath = "none"
      content.style.opacity = "1"
      content.style.filter = "blur(0px)"
      surface.style.opacity = SURFACE_DIM
      focusTarget()
      return
    }

    play(
      surface,
      [
        { opacity: "1", filter: "blur(0px)" },
        { opacity: SURFACE_DIM, filter: SURFACE_BLUR },
      ],
      { ...OPEN_TIMELINE.veil, easing: EASE_SOFT },
    )

    play(
      dialog,
      [
        { clipPath: `circle(0px at ${geometry.originX}px ${geometry.originY}px)` },
        { clipPath: `circle(${geometry.maxRadius}px at ${geometry.originX}px ${geometry.originY}px)` },
      ],
      { ...OPEN_TIMELINE.clip, easing: EASE_EXPAND },
    )

    const reveal = play(
      content,
      [
        { opacity: 0, filter: CONTENT_BLUR },
        { opacity: 1, filter: "blur(0px)" },
      ],
      { ...OPEN_TIMELINE.content, easing: EASE_SOFT },
    )

    reveal.finished
      .then(() => {
        content.style.pointerEvents = "auto"
        dialog.style.willChange = "auto"
        focusTarget()
      })
      .catch(() => {
        /* 动画被取消（提前关闭），无需处理 */
      })
  }, [geometry, pending, play])

  /* 卡片可能位于滚动容器内：直接写 DOM 跟随，避免动画期间重渲染 */
  useEffect(() => {
    if (!pending || !geometry) return
    let queued = 0
    // 只重算位置并按帧合并，避免滚动时反复触发同步布局
    const sync = () => {
      if (queued) return
      queued = window.requestAnimationFrame(() => {
        queued = 0
        const surface = surfaceRef.current
        const frame = frameRef.current
        if (!surface || !frame) return
        const rect = surface.getBoundingClientRect()
        const shift = translationOf(surface)
        frame.style.top = `${rect.top - shift.y}px`
        frame.style.left = `${rect.left - shift.x}px`
      })
    }
    window.addEventListener("scroll", sync, { capture: true, passive: true })
    window.addEventListener("resize", sync)
    return () => {
      if (queued) window.cancelAnimationFrame(queued)
      window.removeEventListener("scroll", sync, true)
      window.removeEventListener("resize", sync)
    }
  }, [pending, geometry])

  useEffect(() => {
    if (!pending) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      settle(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [pending, settle])

  const api = useMemo<ConfirmApi>(
    () => ({
      confirm: (options) => new Promise<boolean>((resolve) => open({ kind: "confirm", options, resolve }, "")),
      promptText: (options) =>
        new Promise<string | null>((resolve) =>
          open({ kind: "prompt", options, resolve }, options.defaultValue ?? ""),
        ),
    }),
    [open],
  )

  const options = pending?.options
  const tone = toneStyles[options?.tone ?? "default"]
  const ToneIcon = tone.icon
  const { rows, notes } = parseBody(options?.body)
  const requireValue = pending?.kind === "prompt" ? pending.options.requireValue : undefined
  const canConfirm = !requireValue || value.trim() === requireValue

  if (!mounted || !pending || !options) return <ConfirmContext.Provider value={api}>{children}</ConfirmContext.Provider>

  const promptField =
    pending.kind === "prompt" ? (
      <label className="flex flex-col gap-1.5">
        {pending.options.label ? (
          <span className="text-xs font-medium text-muted-foreground">{pending.options.label}</span>
        ) : null}
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // 兼容中日韩输入法：合成阶段的 Enter 不触发提交
            if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return
            event.preventDefault()
            if (canConfirm) settle(true)
          }}
          placeholder={pending.options.placeholder}
          spellCheck={false}
          autoComplete="off"
          className="w-full rounded-xl bg-surface/70 px-3 py-2 font-mono text-sm text-card-foreground outline-none ring-1 ring-border transition-shadow placeholder:font-sans placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-primary/60"
        />
      </label>
    ) : null

  const actions = (compact: boolean) => (
    <>
      <button
        onClick={() => settle(false)}
        className={cn(
          "rounded-xl font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-card-foreground",
          compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
        )}
      >
        {options.cancelLabel ?? "取消"}
      </button>
      <button
        ref={confirmRef}
        onClick={() => settle(true)}
        disabled={!canConfirm}
        className={cn(
          "rounded-xl font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100",
          compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
          tone.confirm,
        )}
      >
        {options.confirmLabel ?? "确认"}
      </button>
    </>
  )

  /* ---------- 就地展开形态：覆盖触发按钮所在的卡片 ---------- */
  if (geometry) {
    return (
      <ConfirmContext.Provider value={api}>
        {children}
        {createPortal(
          <>
            <button
              aria-label="取消"
              tabIndex={-1}
              onClick={() => settle(false)}
              className="fixed inset-0 z-[99] cursor-default"
            />
            <div
              ref={frameRef}
              className="pointer-events-none fixed z-[100]"
              style={{
                top: geometry.top,
                left: geometry.left,
                width: geometry.width,
                height: geometry.height,
              }}
            >
              <div
                ref={dialogRef}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="confirm-dialog-title"
                className="card-glow pointer-events-auto h-full w-full overflow-hidden bg-card ring-1 ring-border"
                style={{
                  borderRadius: geometry.radius,
                  // 首帧保持闭合，随后由 WAAPI 接管
                  clipPath: `circle(0px at ${geometry.originX}px ${geometry.originY}px)`,
                  // 提升为独立合成层，遮罩重绘不再牵动底层卡片
                  transform: "translateZ(0)",
                  willChange: "clip-path",
                }}
              >
                <div
                  ref={contentRef}
                  className="flex h-full w-full flex-col p-3.5"
                  style={{ opacity: 0, filter: CONTENT_BLUR, pointerEvents: "none", willChange: "opacity, filter" }}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-xl ring-1",
                        tone.ring,
                        tone.text,
                      )}
                    >
                      <ToneIcon size={16} aria-hidden />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <h2
                        id="confirm-dialog-title"
                        className="text-pretty text-[13px] font-semibold leading-5 text-card-foreground"
                      >
                        {options.title}
                      </h2>
                      {options.description ? (
                        <p className="text-pretty text-[11px] leading-4 text-muted-foreground">
                          {options.description}
                        </p>
                      ) : null}
                    </div>
                    <button
                      onClick={() => settle(false)}
                      aria-label="关闭"
                      className="-mr-1 -mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-card-foreground"
                    >
                      <X size={14} aria-hidden />
                    </button>
                  </div>

                  <div className="mt-2.5 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                    {rows.length > 0 ? (
                      <dl className="flex flex-col divide-y divide-border overflow-hidden rounded-xl bg-surface/60">
                        {rows.map((row) => (
                          <div
                            key={`${row.label}-${row.value}`}
                            className="flex items-baseline justify-between gap-3 px-2.5 py-1.5"
                          >
                            <dt className="shrink-0 text-[11px] font-medium text-muted-foreground">{row.label}</dt>
                            <dd className="min-w-0 truncate text-right font-mono text-[11px] leading-4 text-card-foreground">
                              {row.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {notes.map((note) => (
                      <p key={note} className="text-pretty text-[11px] leading-4 text-muted-foreground">
                        {note}
                      </p>
                    ))}
                    {promptField}
                  </div>

                  <div className="mt-2.5 flex items-center justify-end gap-1.5 border-t border-border pt-2.5">
                    {actions(true)}
                  </div>
                </div>
              </div>
            </div>
          </>,
          document.body,
        )}
      </ConfirmContext.Provider>
    )
  }

  /* ---------- 回退形态：屏幕居中弹层 ---------- */
  return (
    <ConfirmContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <button
            aria-label="取消"
            tabIndex={-1}
            onClick={() => settle(false)}
            className={cn(
              "fixed inset-0 bg-background/70 backdrop-blur-sm transition-opacity",
              centeredClosing ? "opacity-0 duration-100" : "opacity-100 duration-200",
            )}
          />

          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            className={cn(
              "card-glow relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-card",
              centeredClosing ? "animate-dropdown-out" : "animate-dropdown-in",
            )}
          >
            <header className="flex items-start gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-2xl ring-1",
                  tone.ring,
                  tone.text,
                )}
              >
                <ToneIcon size={20} aria-hidden />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h2
                  id="confirm-dialog-title"
                  className="text-pretty text-base font-semibold leading-6 text-card-foreground"
                >
                  {options.title}
                </h2>
                {options.description ? (
                  <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{options.description}</p>
                ) : null}
              </div>
              <button
                onClick={() => settle(false)}
                aria-label="关闭"
                className="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted/60 hover:text-card-foreground"
              >
                <X size={16} aria-hidden />
              </button>
            </header>

            {rows.length > 0 || notes.length > 0 || promptField ? (
              <div className="flex flex-col gap-3 px-5 pt-4 sm:px-6">
                {rows.length > 0 ? (
                  <dl className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl bg-surface/60">
                    {rows.map((row) => (
                      <div
                        key={`${row.label}-${row.value}`}
                        className="flex items-baseline justify-between gap-4 px-3.5 py-2.5"
                      >
                        <dt className="shrink-0 text-xs font-medium text-muted-foreground">{row.label}</dt>
                        <dd className="min-w-0 break-all text-right font-mono text-xs leading-5 text-card-foreground">
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {notes.map((note) => (
                  <p key={note} className="text-pretty text-xs leading-5 text-muted-foreground">
                    {note}
                  </p>
                ))}
                {promptField}
              </div>
            ) : null}

            <footer className="mt-5 flex items-center justify-end gap-2 border-t border-border px-5 py-4 sm:px-6">
              {actions(false)}
            </footer>
          </div>
        </div>,
        document.body,
      )}
    </ConfirmContext.Provider>
  )
}

/* ==================== 卡片状态复原 ==================== */

function releaseSurface(el: HTMLElement) {
  el.style.filter = ""
  el.style.opacity = ""
  el.style.pointerEvents = ""
  el.style.willChange = ""
  el.style.transition = ""
  el.style.transform = ""
}

export function useConfirm(): ConfirmApi {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error("useConfirm 必须在 ConfirmDialogProvider 内使用")
  return context
}
