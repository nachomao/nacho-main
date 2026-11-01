"use client"

/* 灵动形变弹层：从触发元素原位展开成悬浮卡片，关闭时沿原路收回成触发元素的形状。
 * 展开只用无回弹的平滑弹簧，直接停在目标尺寸。收回参考 iOS 26 液态玻璃菜单收回按钮：位置略快且几乎不过冲，
 * 先把卡片送回原位；尺寸用欠阻尼弹簧（ζ = 0.7），带着收缩的惯性越过锚点尺寸一点再弹回，只回弹一次。
 * 越过锚点的那一段换成整体等比缩小，触发元素的形状不会被压扁。
 * 内容按固定基准宽度排版，随卡片宽度等比缩放并在展开后段淡入，整个过程不会逐帧重排文字。 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { animate, motion, useMotionValue, useTransform } from "motion/react"
import { cn } from "@/lib/utils"
import { useMotionPreference } from "@/lib/motion-preference"
import {
  clamp01,
  morphContentScale,
  morphFrame,
  morphLandingScale,
  type MorphPoint,
  type MorphRect,
  type MorphSize,
  type MorphViewport,
} from "@/lib/morph-geometry"

export type MorphPlacement = (size: MorphSize, anchor: MorphRect, viewport: MorphViewport) => MorphPoint

type Controls = ReturnType<typeof animate>

const OPEN_POSITION = { type: "spring", visualDuration: 0.42, bounce: 0 } as const
const OPEN_SIZE = { type: "spring", visualDuration: 0.46, bounce: 0 } as const
const CLOSE_POSITION = { type: "spring", visualDuration: 0.34, bounce: 0.1 } as const
/** 约 280ms 回到锚点尺寸、370ms 越界最深（尺寸进度 -0.046），二次过冲仅 0.002，720ms 静止；越界最深时位置已落位 */
const CLOSE_SIZE = { type: "spring", visualDuration: 0.44, bounce: 0.3 } as const
const REFIT = { type: "spring", visualDuration: 0.32, bounce: 0 } as const
const REDUCED = { duration: 0.16, ease: "easeOut" } as const
/** 越界尺寸进度换算成整体缩放的倍率：-0.046 × 1.1 ≈ 缩小 5% */
const LANDING_GAIN = 1.1
/** 卡片固定 1px 描边：目标尺寸 = 内容尺寸 + 两侧描边 */
const BORDER = 1
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

type MorphPopoverProps = {
  open: boolean
  /** 形变的起点与终点元素；收回时锚点已卸载则沿用上一次测得的位置 */
  getAnchor: () => HTMLElement | null
  onRequestClose: () => void
  /** 收回动画结束、卡片卸载之后调用，用来让真实触发元素重新显形 */
  onClosed?: () => void
  /** 内容基准宽度，视口不足时自动收窄 */
  width: number
  maxHeight?: number
  gutter?: number
  place: MorphPlacement
  fromRadius: number
  toRadius: number
  /** 叠在卡片左上角、与锚点同尺寸的触发元素外观，起止形态时可见 */
  face?: ReactNode
  /** blur：模糊压暗背景并拦截点击；clear：透明拦截层，点击外部即关闭 */
  backdrop?: "blur" | "clear"
  modal?: boolean
  closeLabel: string
  label?: string
  labelledBy?: string
  className?: string
  fromSkinClassName?: string
  toSkinClassName?: string
  children: ReactNode
}

function readViewport(): MorphViewport {
  return { width: window.innerWidth, height: window.innerHeight }
}

export function MorphPopover({
  open,
  getAnchor,
  onRequestClose,
  onClosed,
  width,
  maxHeight,
  gutter = 16,
  place,
  fromRadius,
  toRadius,
  face,
  backdrop = "blur",
  modal = false,
  closeLabel,
  label,
  labelledBy,
  className,
  fromSkinClassName,
  toSkinClassName,
  children,
}: MorphPopoverProps) {
  const { reduceMotion } = useMotionPreference()
  const [mounted, setMounted] = useState(false)
  const [contentWidth, setContentWidth] = useState(width)
  const [faceSize, setFaceSize] = useState<MorphSize | null>(null)
  if (open && !mounted) {
    setMounted(true)
    setContentWidth(Math.max(1, Math.min(width, window.innerWidth - gutter * 2 - BORDER * 2)))
  }

  const cardRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const fromRef = useRef<MorphRect>({ left: 0, top: 0, width: 1, height: 1 })
  const viewportRef = useRef<MorphViewport>({ width: 1, height: 1 })
  const widthRef = useRef(contentWidth)
  const extentTargetRef = useRef(1)
  const controlsRef = useRef<Controls[]>([])
  const generationRef = useRef(0)
  const latest = useRef({ getAnchor, onRequestClose, onClosed, place, fromRadius, toRadius, maxHeight, gutter, width, open, reduceMotion })
  latest.current = { getAnchor, onRequestClose, onClosed, place, fromRadius, toRadius, maxHeight, gutter, width, open, reduceMotion }

  const position = useMotionValue(0)
  const size = useMotionValue(0)
  const extent = useMotionValue(1)
  // 参与几何计算的普通 ref（锚点、视口、内容宽度）变化后递增，迫使派生值重算
  const tick = useMotionValue(0)

  const frame = () => {
    const p = position.get()
    const s = size.get()
    const contentHeight = extent.get()
    tick.get()
    const target = { width: widthRef.current + BORDER * 2, height: contentHeight + BORDER * 2 }
    const point = latest.current.place(target, fromRef.current, viewportRef.current)
    return morphFrame(fromRef.current, { ...point, ...target }, p, s)
  }
  const x = useTransform(() => frame().left)
  const y = useTransform(() => frame().top)
  const cardWidth = useTransform(() => frame().width)
  const cardHeight = useTransform(() => frame().height)
  const contentScale = useTransform(() => {
    tick.get()
    return morphContentScale(cardWidth.get() - BORDER * 2, widthRef.current)
  })
  const radius = useTransform(() => {
    const t = clamp01(size.get())
    const { fromRadius: start, toRadius: end } = latest.current
    return start + (end - start) * t
  })
  const landing = useTransform(size, (value: number) => morphLandingScale(value, LANDING_GAIN))
  const faceOpacity = useTransform(size, [0, 0.22], [1, 0])
  const skinOpacity = useTransform(size, [0, 0.2], [0, 1])
  const contentOpacity = useTransform(size, [0.38, 0.82], [0, 1])
  const veilOpacity = useTransform(position, [0, 1], [0, 1])
  const shadow = useTransform(size, (value: number) => {
    const t = clamp01(value)
    return `0 32px 96px -32px rgba(0, 0, 0, ${(0.85 * t).toFixed(3)}), 0 12px 36px -18px rgba(0, 0, 0, ${(0.5 * t).toFixed(3)})`
  })

  const bump = () => tick.set(tick.get() + 1)

  const naturalExtent = () => {
    const natural = innerRef.current?.offsetHeight ?? 0
    const { maxHeight: max, gutter: margin } = latest.current
    const limit = Math.min(max ?? Number.POSITIVE_INFINITY, viewportRef.current.height - margin * 2 - BORDER * 2)
    return Math.max(1, Math.min(natural, limit))
  }

  /** 读取锚点位置；锚点已不存在时保留上一次的位置（首次打开退回视口中心）。 */
  const captureAnchor = (fresh: boolean) => {
    viewportRef.current = readViewport()
    const anchor = latest.current.getAnchor()
    if (anchor) {
      const rect = anchor.getBoundingClientRect()
      fromRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    } else if (fresh) {
      fromRef.current = { left: viewportRef.current.width / 2, top: viewportRef.current.height / 2, width: 1, height: 1 }
    }
    setFaceSize({ width: fromRef.current.width, height: fromRef.current.height })
  }

  const stopAll = () => {
    for (const control of controlsRef.current) control.stop()
    controlsRef.current = []
  }

  useLayoutEffect(() => {
    widthRef.current = contentWidth
    bump()
    // bump 只读写 motion value，依赖仅为内容宽度
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentWidth])

  useLayoutEffect(() => {
    if (!mounted) return
    const generation = ++generationRef.current
    const reduced = latest.current.reduceMotion
    const fresh = position.get() === 0 && size.get() === 0
    stopAll()
    captureAnchor(fresh)

    if (open) {
      const next = naturalExtent()
      extentTargetRef.current = next
      extent.jump(next)
      bump()
      cardRef.current?.removeAttribute("inert")
      cardRef.current?.focus({ preventScroll: true })
      controlsRef.current = [
        animate(position, 1, reduced ? REDUCED : OPEN_POSITION),
        animate(size, 1, reduced ? REDUCED : OPEN_SIZE),
      ]
      return
    }

    bump()
    if (cardRef.current?.contains(document.activeElement)) latest.current.getAnchor()?.focus({ preventScroll: true })
    // 回弹尾段里卡片仍在画面上，但已不再是对话框：交还焦点之后再设 inert，Tab 与辅助技术都不再进入
    cardRef.current?.setAttribute("inert", "")
    const finish = () => {
      if (generationRef.current !== generation) return
      setMounted(false)
      latest.current.onClosed?.()
    }
    // 落位回弹由尺寸弹簧自己越过 0 产生（见 landing），不再另起一段轻压；两条弹簧都静止后再卸载
    const collapse = [
      animate(position, 0, reduced ? REDUCED : CLOSE_POSITION),
      animate(size, 0, reduced ? REDUCED : CLOSE_SIZE),
    ]
    controlsRef.current = collapse
    void Promise.all(collapse).then(finish)
    // 只响应开合与挂载；其余输入都经 latest ref 读取最新值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted])

  useEffect(
    () => () => {
      generationRef.current += 1
      stopAll()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // 内容增减时卡片高度弹性跟随；窗口尺寸变化时重新测量并保持居中 / 贴边
  useEffect(() => {
    if (!mounted) return
    const inner = innerRef.current
    let frameId = 0
    const refit = () => {
      frameId = 0
      if (!latest.current.open) return
      const next = naturalExtent()
      if (Math.abs(next - extentTargetRef.current) < 1) return
      extentTargetRef.current = next
      if (latest.current.reduceMotion) extent.jump(next)
      else animate(extent, next, REFIT)
    }
    const observer = new ResizeObserver(() => {
      if (!frameId) frameId = window.requestAnimationFrame(refit)
    })
    if (inner) observer.observe(inner)
    const onResize = () => {
      const { width: base, gutter: margin } = latest.current
      viewportRef.current = readViewport()
      setContentWidth(Math.max(1, Math.min(base, viewportRef.current.width - margin * 2 - BORDER * 2)))
      if (latest.current.open) {
        const anchor = latest.current.getAnchor()
        if (anchor) {
          const rect = anchor.getBoundingClientRect()
          fromRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        }
        const next = naturalExtent()
        extentTargetRef.current = next
        extent.jump(next)
      }
      bump()
    }
    window.addEventListener("resize", onResize)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frameId)
      window.removeEventListener("resize", onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted])

  // Esc 只关闭弹层：捕获阶段拦下，不让 AI Mode 的 Esc（停止 / 退出）收到
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      latest.current.onRequestClose()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open])

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!modal || event.key !== "Tab") return
    const card = cardRef.current
    if (!card) return
    const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => !item.closest("[inert]"))
    if (items.length === 0) {
      event.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const current = document.activeElement
    if (event.shiftKey && (current === first || current === card)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && current === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!mounted) return null

  return createPortal(
    <>
      <motion.button
        type="button"
        tabIndex={-1}
        aria-label={closeLabel}
        onClick={() => latest.current.onRequestClose()}
        className={cn(
          "fixed inset-0 z-[80] cursor-default",
          backdrop === "blur" && "bg-background/45 backdrop-blur-md",
        )}
        style={{ opacity: backdrop === "blur" ? veilOpacity : 0, pointerEvents: open ? "auto" : "none" }}
      />
      <motion.div
        ref={cardRef}
        role="dialog"
        aria-modal={modal && open ? true : undefined}
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={trapFocus}
        className={cn("fixed left-0 top-0 z-[81] overflow-hidden outline-none", className)}
        style={{
          x,
          y,
          width: cardWidth,
          height: cardHeight,
          borderRadius: radius,
          scale: landing,
          boxShadow: shadow,
          pointerEvents: open ? "auto" : "none",
        }}
      >
        <span aria-hidden className={cn("pointer-events-none absolute inset-0", fromSkinClassName)} />
        <motion.span
          aria-hidden
          className={cn("pointer-events-none absolute inset-0", toSkinClassName)}
          style={{ opacity: skinOpacity }}
        />
        <motion.div
          className="absolute left-1/2 top-0 origin-top overflow-y-auto overscroll-contain"
          style={{
            width: contentWidth,
            marginLeft: -contentWidth / 2,
            height: extent,
            scale: contentScale,
            opacity: contentOpacity,
          }}
        >
          <div ref={innerRef}>{children}</div>
        </motion.div>
        {face && faceSize ? (
          <motion.div
            aria-hidden
            inert
            className="pointer-events-none absolute -left-px -top-px"
            style={{ width: faceSize.width, height: faceSize.height, opacity: faceOpacity }}
          >
            {face}
          </motion.div>
        ) : null}
      </motion.div>
    </>,
    document.body,
  )
}
