"use client"

/* 原位展开菜单：触发按钮不再另起浮层，卡片本体从按钮位置长出来。
 * 关闭态按钮仍参与文档流；展开期间布局宽度锁定为按钮自然宽度，卡片向一侧溢出，不推挤同行内容。
 * 展开用无回弹弹簧，收回用略短弹簧平滑归位；尺寸、阴影与内容层级都由同一开合进度驱动。 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import { animate, motion, useMotionValue, useTransform } from "motion/react"
import { cn } from "@/lib/utils"
import { useMotionPreference } from "@/lib/motion-preference"

const OPEN = { type: "spring", visualDuration: 0.42, bounce: 0 } as const
const CLOSE = { type: "spring", visualDuration: 0.36, bounce: 0.18 } as const
const REDUCED = { duration: 0.16, ease: "easeOut" } as const
const VIEWPORT_MARGIN = 8

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

type Align = "start" | "end"

export type InlineExpandMenuProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 关闭态按钮内容 */
  trigger: ReactNode
  triggerLabel: string
  panelLabel: string
  /** 卡片目标宽度；空间不足时会自动收窄 */
  panelWidth: number
  /** 触发按钮高度，默认 48 */
  triggerHeight?: number
  /** 卡片与按钮的圆角，默认 24 */
  radius?: number
  /** 卡片展开方向；auto 按视口剩余空间选择 */
  align?: Align | "auto"
  /** 向下或向上长出；向上适合放在卡片底部、避免被列表滚动容器裁剪 */
  placement?: "bottom" | "top"
  /** 触发按钮类，必须使用显式圆角，不能与内联圆角混用 */
  triggerClassName: string
  /** 展开态附加类，例如去掉按钮底色 */
  expandedTriggerClassName?: string
  /** 卡片外观 */
  skinClassName?: string
  /** 卡片顶部、按钮旁边的标题/操作区 */
  header?: ReactNode
  children: ReactNode
  contentClassName?: string
  panelRole?: "dialog" | "menu" | "region"
  className?: string
  style?: CSSProperties
  disabled?: boolean
}

/**
 * 一个小型原位展开卡片：
 * - 关闭：只显示触发按钮，宽度参与布局；
 * - 展开：卡片从按钮位置向右或向左长出，按钮留在卡片顶部，标题/内容依次揭示；
 * - 收回：卡片沿原路缩回按钮，结束后卸载。
 */
export function InlineExpandMenu({
  open,
  onOpenChange,
  trigger,
  triggerLabel,
  panelLabel,
  panelWidth,
  triggerHeight = 48,
  radius = 24,
  align = "auto",
  placement = "bottom",
  triggerClassName,
  expandedTriggerClassName,
  skinClassName = "border border-border/70 bg-card shadow-[0_22px_48px_-18px_oklch(0_0_0_/_85%)]",
  header,
  children,
  contentClassName,
  panelRole = "dialog",
  className,
  style,
  disabled,
}: InlineExpandMenuProps) {
  const { reduceMotion } = useMotionPreference()
  const [engaged, setEngaged] = useState(false)
  const [triggerWidth, setTriggerWidth] = useState(0)
  const [resolved, setResolved] = useState<{ align: Align; width: number }>({
    align: align === "end" ? "end" : "start",
    width: panelWidth,
  })

  // 首次展开时立即挂载卡片，避免先渲染按钮再补卡片导致跳帧
  if (open && !engaged) setEngaged(true)

  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const triggerWidthRef = useRef(0)
  const contentHeightRef = useRef(0)
  const resolvedRef = useRef({ align: resolved.align, width: resolved.width })
  const controlRef = useRef<ReturnType<typeof animate> | null>(null)
  const generationRef = useRef(0)

  const progress = useMotionValue(0)
  // 参与几何计算的 ref 变化后递增，迫使派生值重算
  const tick = useMotionValue(0)
  const bump = useCallback(() => tick.set(tick.get() + 1), [tick])

  const width = useTransform(() => {
    tick.get()
    const t = clamp01(progress.get())
    const from = triggerWidthRef.current
    const to = resolvedRef.current.width
    return from + (to - from) * t
  })
  const height = useTransform(() => {
    tick.get()
    const t = clamp01(progress.get())
    return triggerHeight + contentHeightRef.current * t
  })
  const headerOpacity = useTransform(progress, [0.12, 0.7], [0, 1])
  const contentOpacity = useTransform(progress, [0.18, 0.82], [0, 1])
  const contentY = useTransform(progress, [0, 1], placement === "top" ? [6, 0] : [-6, 0])

  // 关闭态跟踪触发按钮自然宽度（悬停展开、字体缩放都会重新同步）
  useLayoutEffect(() => {
    if (engaged) return
    const el = triggerRef.current
    if (!el) return
    const sync = () => {
      triggerWidthRef.current = el.offsetWidth
      setTriggerWidth(el.offsetWidth)
      bump()
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [engaged, bump])

  // 打开时按视口剩余空间决定展开方向与实际宽度
  const measure = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // 起点对齐时卡片左边贴按钮左边，可用宽度看按钮左侧到视口右侧；
    // 终点对齐时卡片右边贴按钮右边，可用宽度看按钮右侧到视口左侧。
    const spaceRight = Math.max(0, window.innerWidth - rect.left - VIEWPORT_MARGIN)
    const spaceLeft = Math.max(0, rect.right - VIEWPORT_MARGIN)
    let side: Align = align === "end" ? "end" : "start"
    if (align === "auto") side = spaceRight >= spaceLeft ? "start" : "end"
    const available = side === "start" ? spaceRight : spaceLeft
    const width = Math.max(160, Math.min(panelWidth, available || panelWidth))
    const next = { align: side, width: Math.round(width) }
    resolvedRef.current = next
    triggerWidthRef.current = el.offsetWidth
    setResolved(next)
    bump()
  }, [align, panelWidth, bump])

  // 宽度确定后测量内容高度；内容异步加载、窗口缩放导致换行时也跟着更新
  useLayoutEffect(() => {
    if (!engaged) return
    const el = contentRef.current
    if (!el) return
    const sync = () => {
      contentHeightRef.current = el.offsetHeight
      bump()
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [engaged, resolved.width, bump])

  // 开合动画
  useLayoutEffect(() => {
    if (!engaged) return
    const generation = ++generationRef.current
    controlRef.current?.stop()

    if (open) {
      const raf = requestAnimationFrame(() => {
        if (generationRef.current !== generation) return
        controlRef.current = animate(progress, 1, reduceMotion ? REDUCED : OPEN)
      })
      return () => cancelAnimationFrame(raf)
    }

    const collapse = animate(progress, 0, reduceMotion ? REDUCED : CLOSE)
    controlRef.current = collapse
    void collapse.then(() => {
      if (generationRef.current === generation) setEngaged(false)
    })
  }, [engaged, open, reduceMotion, progress])

  useEffect(
    () => () => {
      generationRef.current += 1
      controlRef.current?.stop()
    },
    [],
  )

  // 打开期间窗口尺寸变化时重新计算展开方向
  useEffect(() => {
    if (!open) return
    const onResize = () => measure()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [open, measure])

  // 点击卡片外部关闭；Esc 收起并把焦点交还按钮
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      onOpenChange(false)
      triggerRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("keydown", onKey, true)
    }
  }, [open, onOpenChange])

  const side = resolved.align

  return (
    <span
      ref={rootRef}
      className={cn("relative inline-flex shrink-0", engaged && "z-[70]", className)}
      style={{ ...style, width: engaged && triggerWidth ? `${triggerWidth}px` : undefined, height: triggerHeight }}
    >
      <motion.button
        ref={triggerRef}
        type="button"
        aria-haspopup={panelRole === "menu" ? "menu" : "dialog"}
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          if (!open) measure()
          onOpenChange(!open)
        }}
        className={cn(
          "relative z-10 flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          triggerClassName,
          open && expandedTriggerClassName,
        )}
        style={{ height: triggerHeight }}
      >
        {trigger}
      </motion.button>

      {engaged && (
        <motion.div
          role={panelRole}
          aria-label={panelLabel}
          aria-hidden={!open}
          inert={!open}
          className={cn(
            "absolute overflow-hidden",
            placement === "top" ? "bottom-0" : "top-0",
            side === "end" ? "right-0" : "left-0",
            skinClassName,
          )}
          style={{ width, height, borderRadius: radius }}
        >
          {header && (
            <motion.div
              className={cn("absolute inset-x-0 flex items-center", placement === "top" ? "bottom-0" : "top-0")}
              style={{
                height: triggerHeight,
                paddingLeft: side === "start" ? (triggerWidth || 0) + 8 : 12,
                paddingRight: side === "start" ? 12 : (triggerWidth || 0) + 8,
                opacity: headerOpacity,
              }}
            >
              {header}
            </motion.div>
          )}

          <motion.div
            ref={contentRef}
            className={cn("absolute left-0", contentClassName)}
            style={{
              ...(placement === "top" ? { bottom: triggerHeight } : { top: triggerHeight }),
              width: resolved.width,
              opacity: contentOpacity,
              y: contentY,
            }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </span>
  )
}
