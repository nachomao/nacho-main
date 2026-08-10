"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

/* ==================== Provider ==================== */

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [closing, setClosing] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [value, setValue] = useState("")
  const closeTimer = useRef<number | null>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    setMounted(true)
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    }
  }, [])

  const settle = useCallback((accepted: boolean) => {
    setPending((current) => {
      if (!current) return null
      if (current.kind === "confirm") current.resolve(accepted)
      else current.resolve(accepted ? inputRef.current?.value ?? "" : null)
      return current
    })
    setClosing(true)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      setPending(null)
      setClosing(false)
      setValue("")
      restoreFocus.current?.focus?.()
      restoreFocus.current = null
    }, 130)
  }, [])

  const open = useCallback((next: Pending, initialValue: string) => {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    setClosing(false)
    setValue(initialValue)
    setPending(next)
  }, [])

  const api = useMemo<ConfirmApi>(
    () => ({
      confirm: (options) =>
        new Promise<boolean>((resolve) => open({ kind: "confirm", options, resolve }, "")),
      promptText: (options) =>
        new Promise<string | null>((resolve) =>
          open({ kind: "prompt", options, resolve }, options.defaultValue ?? ""),
        ),
    }),
    [open],
  )

  // 打开后把焦点交给输入框或确认按钮，便于键盘直接操作
  useEffect(() => {
    if (!pending || closing) return
    const target = pending.kind === "prompt" ? inputRef.current : confirmRef.current
    const timer = window.setTimeout(() => target?.focus(), 40)
    return () => window.clearTimeout(timer)
  }, [pending, closing])

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

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      {mounted && pending && options
        ? createPortal(
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
                      <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
                        {options.description}
                      </p>
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

                    {pending.kind === "prompt" ? (
                      <label className="flex flex-col gap-1.5">
                        {pending.options.label ? (
                          <span className="text-xs font-medium text-muted-foreground">
                            {pending.options.label}
                          </span>
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
                    ) : null}
                  </div>
                ) : null}

                <footer className="mt-5 flex items-center justify-end gap-2 border-t border-border bg-surface/30 px-5 py-4 sm:px-6">
                  <button
                    onClick={() => settle(false)}
                    className="rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-card-foreground"
                  >
                    {options.cancelLabel ?? "取消"}
                  </button>
                  <button
                    ref={confirmRef}
                    onClick={() => settle(true)}
                    disabled={!canConfirm}
                    className={cn(
                      "rounded-xl px-4 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100",
                      tone.confirm,
                    )}
                  >
                    {options.confirmLabel ?? "确认"}
                  </button>
                </footer>
              </div>
            </div>,
            document.body,
          )
        : null}
    </ConfirmContext.Provider>
  )
}

/** 在客户端组件中获取应用内确认/输入弹层 */
export function useConfirm(): ConfirmApi {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error("useConfirm 必须在 ConfirmDialogProvider 内使用")
  return context
}
