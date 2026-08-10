"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Info, ShieldAlert, X } from "lucide-react"
import { cn } from "@/lib/utils"

/* ==================== 类型 ====================
 * 统一替代 window.confirm / window.prompt 的应用内弹层。
 * tone 决定强调色：danger=不可逆操作，warning=有副作用，default=常规确认。
 *
 * 传入 origin（触发按钮）时启用「就地展开」形态：
 * 先把所在卡片模糊淡出，再从按钮中心向卡片四角扩展铺满，最后内容去模糊显现；
 * 关闭时反向收回到按钮。未传 origin 时回退为屏幕居中弹层。
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

/* ==================== 动画时序（毫秒） ====================
 * 展开：卡片模糊 -> 从按钮向四角扩展 -> 内容去模糊显现
 * 收回：内容模糊淡出 -> 从四周收回到按钮 -> 卡片去模糊复原
 */

const VEIL_MS = 140
const EXPAND_MS = 300
const REVEAL_MS = 190
const CONTENT_OUT_MS = 140
const COLLAPSE_MS = 260
const UNVEIL_MS = 150
/** 确认后卡片通常随即被移除，收回过程用更短时长避免悬空 */
const FAST_SCALE = 0.55

/** 居中弹层的进出场时长 */
const CENTERED_OUT_MS = 130

type Phase = "veil" | "expand" | "open" | "contentOut" | "collapse" | "unveil"

type Geometry = {
  /** 卡片相对视口的位置，随滚动/缩放实时更新 */
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

/* ==================== 卡片模糊：命令式控制 ====================
 * 内联样式优先于 Tailwind 的 hover:-translate-y-1，先把 transform 归零，
 * 这样后续测量到的卡片矩形不会因悬停位移而偏移。
 */

function freezeSurface(el: HTMLElement) {
  el.style.transform = "none"
  el.style.transition = `filter ${VEIL_MS}ms ease, opacity ${VEIL_MS}ms ease`
  el.style.filter = "blur(0px)"
  el.style.opacity = "1"
  el.style.pointerEvents = "none"
}

function setSurfaceBlur(el: HTMLElement, blurred: boolean, durationMs: number) {
  el.style.transition = `filter ${durationMs}ms ease, opacity ${durationMs}ms ease`
  el.style.filter = blurred ? "blur(6px) saturate(0.9)" : "blur(0px)"
  el.style.opacity = blurred ? "0.35" : "1"
}

function releaseSurface(el: HTMLElement) {
  el.style.transform = ""
  el.style.transition = ""
  el.style.filter = ""
  el.style.opacity = ""
  el.style.pointerEvents = ""
}

function measure(surface: HTMLElement, origin: HTMLElement): Geometry {
  const rect = surface.getBoundingClientRect()
  const originRect = origin.getBoundingClientRect()
  const originX = originRect.left + originRect.width / 2 - rect.left
  const originY = originRect.top + originRect.height / 2 - rect.top
  // 到四个角的最远距离，保证扩展后完整覆盖卡片
  const maxRadius = Math.max(
    Math.hypot(originX, originY),
    Math.hypot(rect.width - originX, originY),
    Math.hypot(originX, rect.height - originY),
    Math.hypot(rect.width - originX, rect.height - originY),
  )
  return {
    top: rect.top,
    left: rect.left,
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
  const [phase, setPhase] = useState<Phase>("open")
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const [mounted, setMounted] = useState(false)
  const [value, setValue] = useState("")

  const timers = useRef<number[]>([])
  const frames = useRef<number[]>([])
  const surfaceRef = useRef<HTMLElement | null>(null)
  const originRef = useRef<HTMLElement | null>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  const clearScheduled = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id))
    frames.current.forEach((id) => window.cancelAnimationFrame(id))
    timers.current = []
    frames.current = []
  }, [])

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])

  const nextFrame = useCallback((fn: () => void) => {
    frames.current.push(window.requestAnimationFrame(() => frames.current.push(window.requestAnimationFrame(fn))))
  }, [])

  useEffect(() => {
    setMounted(true)
    return () => {
      timers.current.forEach((id) => window.clearTimeout(id))
      frames.current.forEach((id) => window.cancelAnimationFrame(id))
      if (surfaceRef.current) releaseSurface(surfaceRef.current)
    }
  }, [])

  const finish = useCallback(() => {
    if (surfaceRef.current) releaseSurface(surfaceRef.current)
    surfaceRef.current = null
    originRef.current = null
    setPending(null)
    setGeometry(null)
    setValue("")
    restoreFocus.current?.focus?.()
    restoreFocus.current = null
  }, [])

  const settle = useCallback(
    (accepted: boolean) => {
      let kind: Pending["kind"] | null = null
      setPending((current) => {
        if (!current) return null
        kind = current.kind
        if (current.kind === "confirm") current.resolve(accepted)
        else current.resolve(accepted ? inputRef.current?.value ?? "" : null)
        return current
      })
      if (!kind) return

      clearScheduled()
      const morph = surfaceRef.current !== null
      if (!morph) {
        // 居中弹层：沿用简单的淡出
        setPhase("contentOut")
        later(finish, CENTERED_OUT_MS)
        return
      }

      // 确认后卡片往往立即被移除，压缩收回时长
      const scale = accepted ? FAST_SCALE : 1
      const contentOut = Math.round(CONTENT_OUT_MS * scale)
      const collapse = Math.round(COLLAPSE_MS * scale)
      const unveil = Math.round(UNVEIL_MS * scale)

      setPhase("contentOut")
      later(() => setPhase("collapse"), contentOut)
      later(() => {
        setPhase("unveil")
        if (surfaceRef.current) setSurfaceBlur(surfaceRef.current, false, unveil)
      }, contentOut + collapse)
      later(finish, contentOut + collapse + unveil)
    },
    [clearScheduled, finish, later],
  )

  const open = useCallback(
    (next: Pending, initialValue: string) => {
      clearScheduled()
      if (surfaceRef.current) releaseSurface(surfaceRef.current)

      restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setValue(initialValue)

      const origin = next.options.origin ?? null
      const surface = origin?.closest<HTMLElement>("[data-confirm-surface]") ?? null

      if (!origin || !surface) {
        // 回退：屏幕居中弹层
        surfaceRef.current = null
        originRef.current = null
        setGeometry(null)
        setPhase("open")
        setPending(next)
        return
      }

      surfaceRef.current = surface
      originRef.current = origin
      freezeSurface(surface)
      setPhase("veil")
      setPending(next)

      // 等 transform 归零生效后再测量，避免悬停位移导致的偏差
      nextFrame(() => {
        const currentSurface = surfaceRef.current
        const currentOrigin = originRef.current
        if (!currentSurface || !currentOrigin) return
        setGeometry(measure(currentSurface, currentOrigin))
        setSurfaceBlur(currentSurface, true, VEIL_MS)
        later(() => setPhase("expand"), VEIL_MS)
        later(() => setPhase("open"), VEIL_MS + EXPAND_MS)
      })
    },
    [clearScheduled, later, nextFrame],
  )

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

  // 卡片可能位于滚动容器中，展开期间跟随其位置
  useLayoutEffect(() => {
    if (!pending || !surfaceRef.current) return
    const sync = () => {
      const surface = surfaceRef.current
      const origin = originRef.current
      if (!surface || !origin) return
      setGeometry(measure(surface, origin))
    }
    window.addEventListener("scroll", sync, true)
    window.addEventListener("resize", sync)
    return () => {
      window.removeEventListener("scroll", sync, true)
      window.removeEventListener("resize", sync)
    }
  }, [pending])

  // 内容显现后把焦点交给输入框或确认按钮，便于键盘直接操作
  useEffect(() => {
    if (!pending || phase !== "open") return
    const target = pending.kind === "prompt" ? inputRef.current : confirmRef.current
    const timer = window.setTimeout(() => target?.focus(), 40)
    return () => window.clearTimeout(timer)
  }, [pending, phase])

  useEffect(() => {
    if (!pending) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        settle(false)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [pending, settle])

  const options = pending?.options
  const tone = toneStyles[options?.tone ?? "default"]
  const ToneIcon = tone.icon
  const { rows, notes } = parseBody(options?.body)
  const requireValue = pending?.kind === "prompt" ? pending.options.requireValue : undefined
  const canConfirm = !requireValue || value.trim() === requireValue
  const morph = geometry !== null
  const contentVisible = phase === "open"
  const closing = phase === "contentOut" || phase === "collapse" || phase === "unveil"

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
  if (morph && geometry) {
    const radius = phase === "veil" || phase === "collapse" || phase === "unveil" ? 0 : geometry.maxRadius
    const collapsing = phase === "collapse" || phase === "unveil"
    const scale = closing ? FAST_SCALE : 1

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
              className="pointer-events-none fixed z-[100]"
              style={{
                top: geometry.top,
                left: geometry.left,
                width: geometry.width,
                height: geometry.height,
              }}
            >
              <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="confirm-dialog-title"
                className="card-glow pointer-events-auto h-full w-full overflow-hidden bg-card ring-1 ring-border"
                style={{
                  borderRadius: geometry.radius,
                  clipPath: `circle(${radius}px at ${geometry.originX}px ${geometry.originY}px)`,
                  transition: `clip-path ${
                    collapsing ? Math.round(COLLAPSE_MS * scale) : EXPAND_MS
                  }ms cubic-bezier(0.22, 1, 0.36, 1)`,
                }}
              >
                <div
                  className="flex h-full w-full flex-col p-3.5"
                  style={{
                    opacity: contentVisible ? 1 : 0,
                    filter: contentVisible ? "blur(0px)" : "blur(10px)",
                    transition: `opacity ${
                      contentVisible ? REVEAL_MS : Math.round(CONTENT_OUT_MS * scale)
                    }ms ease, filter ${contentVisible ? REVEAL_MS : Math.round(CONTENT_OUT_MS * scale)}ms ease`,
                  }}
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
              closing ? "opacity-0 duration-100" : "opacity-100 duration-200",
            )}
          />

          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            className={cn(
              "card-glow relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-card",
              closing ? "animate-dropdown-out" : "animate-dropdown-in",
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
              <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
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

            {rows.length > 0 || notes.length > 0 || pending.kind === "prompt" ? (
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
                  <p key={note} className="text-pretty text-xs leading-relaxed text-muted-foreground">
                    {note}
                  </p>
                ))}

                {promptField}
              </div>
            ) : null}

            <footer className="mt-5 flex items-center justify-end gap-2 border-t border-border bg-surface/30 px-5 py-4 sm:px-6">
              {actions(false)}
            </footer>
          </div>
        </div>,
        document.body,
      )}
    </ConfirmContext.Provider>
  )
}

/** 在客户端组件中获取应用内确认/输入弹层 */
export function useConfirm(): ConfirmApi {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error("useConfirm 必须在 ConfirmDialogProvider 内使用")
  return context
}
