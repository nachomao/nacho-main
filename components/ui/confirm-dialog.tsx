"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Info, ShieldAlert, X } from "lucide-react"
import { cn } from "@/lib/utils"

/* ==================== 类型 ====================
 * 统一替代 window.confirm / window.prompt 的应用内弹层。
 * tone 决定强调色：danger=不可逆操作，warning=有副作用，default=常规确认。
 *
 * 传入 origin（触发按钮）时启用「卡片翻转」形态：
 * 触发按钮所在的卡片绕竖轴翻转，正面转出、弹层作为背面转入，
 * 关闭时原路翻回。未传 origin 时回退为屏幕居中弹层。
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
 * 卡片翻转：真实卡片是正面，弹层是背面，两者绕同一根竖轴同步转动。
 * 双方都开启 backface-visibility: hidden，转过 90° 时正面自然隐去、
 * 背面接手，整个过程是一条连续的物理动作，没有分段与拼接。
 *
 *   正面（卡片）   rotateY   0° ──────────────► 180°
 *   背面（弹层）   rotateY -180° ──────────────►   0°
 *                            ↑ 90° 处完成交接
 */

/** 单次翻转时长；正反面共用，保证始终共面 */
const FLIP_MS = 520

/** 确认后卡片通常随即被移除，回翻整体加速 */
const ACCEPT_SPEED = 0.6

/** 翻转用对称 easeInOut，接近真实卡片被手指拨转的手感 */
const EASE_FLIP = "cubic-bezier(0.66, 0, 0.34, 1)"
const EASE_SOFT = "cubic-bezier(0.4, 0, 0.2, 1)"

/** 透视距离：越小越夸张，1400px 在卡片尺寸下透视自然 */
const PERSPECTIVE = 1400

/** 翻转中途略微缩小并压暗，模拟卡片转向侧面时的受光变化 */
const MID_SCALE = 0.94
const MID_BRIGHTNESS = 0.72

/** 背面内容在交接完成后补一段渐显，避免边缘出现硬切 */
const CONTENT_FADE = { delay: 300, duration: 200 }

/** 居中回退形态的退场时长，与 animate-dropdown-out 对齐 */
const CENTERED_OUT_MS = 130

type Geometry = {
  /** 卡片静止状态相对视口的位置 */
  top: number
  left: number
  width: number
  height: number
  radius: string
  /** 翻转方向：按钮在卡片右半侧时朝反向转，转轴总是背离手指 */
  dir: 1 | -1
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

  // 按钮落在右半侧时反向翻转，视觉上像是被按钮推着转过去
  const originX = originRect.left + originRect.width / 2 - rect.left
  const dir: 1 | -1 = originX > rect.width / 2 ? -1 : 1

  const top = rect.top - shift.y

  return {
    top,
    left: rect.left - shift.x,
    width: rect.width,
    height: rect.height,
    radius: window.getComputedStyle(surface).borderRadius || "1rem",
    dir,
  }
}

/** 统一拼装翻转 transform，保证正反面用完全一致的透视与缩放 */
function flipAt(angle: number, scale: number) {
  return `perspective(${PERSPECTIVE}px) rotateY(${angle}deg) scale(${scale})`
}

/** 一次翻转的三个关键帧：起始角 → 中途（缩小压暗）→ 终止角 */
function flipFrames(from: number, to: number): Keyframe[] {
  return [
    { transform: flipAt(from, 1), filter: "brightness(1)" },
    { transform: flipAt((from + to) / 2, MID_SCALE), filter: `brightness(${MID_BRIGHTNESS})`, offset: 0.5 },
    { transform: flipAt(to, 1), filter: "brightness(1)" },
  ]
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

      // 确认后卡片一般立即消失，回翻整体加速
      const duration = Math.round(FLIP_MS * (accepted ? ACCEPT_SPEED : 1))
      const timing = { duration, easing: EASE_FLIP }

      // 让正面重新参与渲染，才能接住回翻的后半程
      surface.style.visibility = ""

      // 背面转出、正面转回，方向与展开完全镜像
      play(dialog, flipFrames(0, -180 * geo.dir), timing)
      play(surface, flipFrames(180 * geo.dir, 0), timing)
      play(content, [{ opacity: 1 }, { opacity: 0 }], {
        duration: Math.round(duration * 0.45),
        easing: EASE_SOFT,
      })

      closeTimer.current = window.setTimeout(finish, duration)
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
      // 关掉卡片自身的 transition，避免与翻转动画争夺 transform
      surface.style.transition = "none"
      // 正面转过 90° 后即隐去，不会露出镜像内容
      surface.style.backfaceVisibility = "hidden"
      surface.style.willChange = "transform, filter"

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
      dialog.style.transform = flipAt(0, 1)
      content.style.opacity = "1"
      surface.style.visibility = "hidden"
      focusTarget()
      return
    }

    const timing = { duration: FLIP_MS, easing: EASE_FLIP }

    // 正面：卡片本体转出视野
    play(surface, flipFrames(0, 180 * geometry.dir), timing)

    // 背面：弹层从卡片反面转入，与正面始终共面
    const flip = play(dialog, flipFrames(-180 * geometry.dir, 0), timing)

    play(content, [{ opacity: 0 }, { opacity: 1 }], { ...CONTENT_FADE, easing: EASE_SOFT })

    flip.finished
      .then(() => {
        content.style.pointerEvents = "auto"
        dialog.style.willChange = "auto"
        // 翻转结束后正面已完全背对镜头，直接隐藏省下持续的合成开销
        surface.style.visibility = "hidden"
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
          "shrink-0 whitespace-nowrap rounded-xl font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-card-foreground",
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
          "shrink-0 whitespace-nowrap rounded-xl font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100",
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
                // 严格沿用卡片尺寸，靠内部布局消化内容
                className="card-glow @container pointer-events-auto h-full w-full overflow-hidden bg-card ring-1 ring-border"
                style={{
                  borderRadius: geometry.radius,
                  // 首帧停在背面（完全背对镜头），随后由 WAAPI 接管
                  transform: flipAt(-180 * geometry.dir, 1),
                  backfaceVisibility: "hidden",
                  willChange: "transform, filter",
                }}
              >
                <div
                  ref={contentRef}
                  className="flex h-full w-full flex-col p-4"
                  style={{ opacity: 0, pointerEvents: "none", willChange: "opacity" }}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-xl ring-1",
                        tone.ring,
                        tone.text,
                      )}
                    >
                      <ToneIcon size={16} aria-hidden />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <h2
                        id="confirm-dialog-title"
                        className="break-words text-pretty text-sm font-semibold leading-5 text-card-foreground"
                      >
                        {options.title}
                      </h2>
                      {options.description ? (
                        <p className="text-pretty text-xs leading-5 text-muted-foreground">{options.description}</p>
                      ) : null}
                    </div>
                    <button
                      onClick={() => settle(false)}
                      aria-label="关闭"
                      className="-mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-card-foreground"
                    >
                      <X size={14} aria-hidden />
                    </button>
                  </div>

                  {/* 信息区占据剩余空间并垂直居中；内容多时 justify-center 自动让位于滚动 */}
                  <div className="mt-2 flex min-h-0 flex-1 flex-col justify-center gap-1.5 overflow-y-auto">
                    {rows.length > 0 ? (
                      <dl className="flex flex-wrap gap-x-1.5 gap-y-1">
                        {rows.map((row) => (
                          // 键值合成一枚胶囊横向排列，两行表格压缩成一行
                          <div
                            key={`${row.label}-${row.value}`}
                            className="flex min-w-0 items-baseline gap-1.5 rounded-lg bg-surface/70 px-2 py-1"
                          >
                            <dt className="shrink-0 text-[11px] text-muted-foreground">{row.label}</dt>
                            <dd className="min-w-0 break-all font-mono text-xs leading-4 text-card-foreground">
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

                  <div className="mt-2 flex flex-wrap items-center justify-end gap-2">{actions(true)}</div>
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
  el.style.visibility = ""
  el.style.backfaceVisibility = ""
}

export function useConfirm(): ConfirmApi {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error("useConfirm 必须在 ConfirmDialogProvider 内使用")
  return context
}
