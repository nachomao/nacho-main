"use client"

/* 胶囊原位展开菜单：胶囊本身向上、向右长成菜单面板，不另起浮层。
 * 胶囊所在槽位的真实布局宽度随展开进度增长，同一行右侧的胶囊会被平滑推开，收回时再跟着回位。
 * 展开用无回弹的平滑弹簧；收回参考 iOS 关闭 App：尺寸弹簧欠阻尼，越过胶囊尺寸一点后弹回，
 * 越界的那一段换成整体等比缩小，胶囊形状不会被压扁，也不会让相邻胶囊来回抖动。 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { animate, motion, useMotionValue, useTransform } from "motion/react"
import { cn } from "@/lib/utils"
import { useMotionPreference } from "@/lib/motion-preference"

const PILL_HEIGHT = 32
const OPEN = { type: "spring", visualDuration: 0.42, bounce: 0 } as const
const CLOSE = { type: "spring", visualDuration: 0.4, bounce: 0.32 } as const
const REDUCED = { duration: 0.16, ease: "easeOut" } as const
/** 越界进度换算成整体缩放：约 -0.05 × 1.2 ≈ 缩小 6% 后弹回 */
const LANDING_GAIN = 1.2

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

type CapsuleMenuProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 胶囊内的文字 / 图标；面板展开时仍停在底部作为标题行 */
  trigger: ReactNode
  /** 面板理想宽度；同一行空间不足时自动收窄 */
  panelWidth: number
  disabled?: boolean
  triggerClassName?: string
  children: ReactNode
}

export function CapsuleMenu({
  open,
  onOpenChange,
  trigger,
  panelWidth,
  disabled,
  triggerClassName,
  children,
}: CapsuleMenuProps) {
  const { reduceMotion } = useMotionPreference()
  const [engaged, setEngaged] = useState(open)
  if (open && !engaged) setEngaged(true)

  const slotRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const pillWidthRef = useRef(0)
  const targetRef = useRef({ width: panelWidth, height: PILL_HEIGHT })
  const controlRef = useRef<ReturnType<typeof animate> | null>(null)
  const generationRef = useRef(0)
  const latest = useRef({ onOpenChange, panelWidth, reduceMotion })
  latest.current = { onOpenChange, panelWidth, reduceMotion }

  const progress = useMotionValue(0)
  // 参与几何计算的普通 ref 变化后递增，迫使派生值重算
  const tick = useMotionValue(0)
  const bump = () => tick.set(tick.get() + 1)

  const width = useTransform(() => {
    tick.get()
    const t = clamp01(progress.get())
    const from = pillWidthRef.current
    return from + (targetRef.current.width - from) * t
  })
  const height = useTransform(() => {
    tick.get()
    const t = clamp01(progress.get())
    return PILL_HEIGHT + (targetRef.current.height - PILL_HEIGHT) * t
  })
  const contentWidth = useTransform(() => {
    tick.get()
    return targetRef.current.width
  })
  const scale = useTransform(progress, (value: number) => (value < 0 ? Math.max(0.85, 1 + value * LANDING_GAIN) : 1))
  const skinOpacity = useTransform(progress, [0, 0.3], [0, 1])
  const contentOpacity = useTransform(progress, [0.35, 0.9], [0, 1])
  const contentY = useTransform(progress, [0, 1], [10, 0])
  const shadow = useTransform(progress, (value: number) => {
    const t = clamp01(value)
    return `0 24px 64px -24px rgba(0, 0, 0, ${(0.8 * t).toFixed(3)}), 0 10px 28px -16px rgba(0, 0, 0, ${(0.5 * t).toFixed(3)})`
  })

  // 胶囊自然宽度（随标签变化）实时同步给槽位，未展开时槽位即胶囊本身的宽度
  useLayoutEffect(() => {
    const triggerEl = triggerRef.current
    if (!triggerEl) return
    const sync = () => {
      pillWidthRef.current = triggerEl.offsetWidth
      bump()
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(triggerEl)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 目标尺寸：理想宽度与同一行剩余空间取小，高度 = 胶囊 + 选项列表 */
  const measureTarget = () => {
    const slot = slotRef.current
    const pillWidth = triggerRef.current?.offsetWidth ?? pillWidthRef.current
    pillWidthRef.current = pillWidth
    let available = latest.current.panelWidth
    const row = slot?.parentElement
    if (slot && row) {
      const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0
      let occupied = 0
      let count = 0
      for (const child of Array.from(row.children)) {
        if (child === slot || !(child instanceof HTMLElement) || child.offsetParent === null) continue
        occupied += child.offsetWidth
        count += 1
      }
      available = row.clientWidth - occupied - gap * count
    }
    targetRef.current = {
      width: Math.max(pillWidth, Math.min(latest.current.panelWidth, available)),
      height: PILL_HEIGHT + (panelRef.current?.offsetHeight ?? 0),
    }
    bump()
  }

  useLayoutEffect(() => {
    if (!engaged) return
    const generation = ++generationRef.current
    const reduced = latest.current.reduceMotion
    controlRef.current?.stop()
    measureTarget()

    if (open) {
      controlRef.current = animate(progress, 1, reduced ? REDUCED : OPEN)
      return
    }

    if (panelRef.current?.contains(document.activeElement)) triggerRef.current?.focus({ preventScroll: true })
    const collapse = animate(progress, 0, reduced ? REDUCED : CLOSE)
    controlRef.current = collapse
    void collapse.then(() => {
      if (generationRef.current === generation) setEngaged(false)
    })
    // 只响应开合与挂载；其余输入经 latest ref 读取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, engaged])

  useEffect(
    () => () => {
      generationRef.current += 1
      controlRef.current?.stop()
    },
    [],
  )

  // 点击胶囊外部关闭；Esc 只收起菜单，捕获阶段拦下不让 AI Mode 的 Esc（停止 / 退出）收到
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!slotRef.current?.contains(event.target as Node)) latest.current.onOpenChange(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      latest.current.onOpenChange(false)
      triggerRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("keydown", onKey, true)
    }
  }, [open])

  return (
    <motion.div
      ref={slotRef}
      className={cn("group/capsule relative flex h-8 shrink-0", engaged && "z-[70]", disabled && "opacity-40")}
      style={{ width, scale, transformOrigin: "50% 100%" }}
    >
      <motion.div
        className="absolute bottom-0 left-0 w-full overflow-hidden rounded-2xl"
        style={{ height, boxShadow: shadow }}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-[inherit] border bg-foreground/[0.03] transition-colors",
            open ? "border-primary/40" : "border-border/70 group-hover/capsule:border-border",
          )}
        />
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] border border-border bg-card"
          style={{ opacity: skinOpacity }}
        />
        {engaged ? (
          <motion.div
            ref={panelRef}
            inert={!open}
            className="absolute left-0"
            style={{ bottom: PILL_HEIGHT, width: contentWidth, opacity: contentOpacity, y: contentY }}
          >
            {children}
          </motion.div>
        ) : null}
      </motion.div>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        className={cn(
          "relative flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed",
          open ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          triggerClassName,
        )}
      >
        {trigger}
      </button>
    </motion.div>
  )
}
