"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { holdForegroundMotion } from "@/lib/foreground-motion"

/** 弹层入场 460ms / 退场 420ms，取较长者作为前台动效优先期 */
const overlayTransitionMs = 460

/**
 * 高度动画容器：用 ResizeObserver 监听内容自然高度，
 * 内容增减（如终端输出、会话重置）时外层高度平滑过渡而非瞬间跳变。
 * 首次测量不做动画，避免入场时从 0 展开。
 */
function AnimatedHeight({ maxHeight, children }: { maxHeight: string; children: React.ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  const readyRef = useRef(false)

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    // 首次同步测量：直接定高，不触发过渡
    setHeight(el.offsetHeight)
    const raf = requestAnimationFrame(() => {
      readyRef.current = true
    })
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return (
    <div
      className="w-full overflow-hidden"
      style={{
        height: height ?? "auto",
        transition: readyRef.current ? "height 420ms cubic-bezier(0.22,1,0.36,1)" : "none",
      }}
    >
      {/* 内层按内容自然定高（受同样的 max-height 约束），内部滚动逻辑不受影响 */}
      <div ref={innerRef} className="flex w-full flex-col" style={{ maxHeight }}>
        {children}
      </div>
    </div>
  )
}

/**
 * 弹层挂载/退场过渡钩子：open 关闭时先播放渐隐，过渡结束后再卸载。
 * mounted 控制 DOM 挂载，shown 驱动模糊缩放渐显/渐隐（与安装弹窗动效一致）。
 */
export function useOverlayTransition(open: boolean, onClose?: () => void) {
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      if (!onClose) return
      const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
      window.addEventListener("keydown", onKey)
      return () => window.removeEventListener("keydown", onKey)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), 460)
    return () => clearTimeout(t)
  }, [open, onClose])

  useEffect(() => {
    if (!mounted || !open) return
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setShown(true))
    })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
    }
  }, [mounted, open])

  // 入场（shown 变 true）与退场（shown 变 false）各持有一段前台动效优先期，覆盖 460ms 过渡
  useEffect(() => {
    if (!mounted) return
    const release = holdForegroundMotion(overlayTransitionMs + 40)
    const timer = setTimeout(release, overlayTransitionMs + 40)
    return () => {
      clearTimeout(timer)
      release()
    }
  }, [mounted, shown])

  return { mounted, shown }
}

/** 居中模态外壳：Portal 到 body，含遮罩与模糊缩放入退场动效 */
export function ModalShell({
  open,
  onClose,
  label,
  maxWidth = "max-w-2xl",
  align = "center",
  children,
}: {
  open: boolean
  onClose: () => void
  label: string
  maxWidth?: string
  /** center: 垂直居中；top: 靠上（命令面板样式） */
  align?: "center" | "top"
  children: React.ReactNode
}) {
  const { mounted, shown } = useOverlayTransition(open, onClose)
  if (!mounted || typeof document === "undefined") return null

  return createPortal(
    <div
      className={
        align === "top"
          ? "fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh] sm:p-6 sm:pt-[14vh]"
          : "fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      }
    >
      <button
        aria-label="关闭"
        onClick={onClose}
        className="fixed inset-0 bg-background/70 backdrop-blur-sm"
        style={{
          opacity: shown ? 1 : 0,
          transition: shown ? "opacity 360ms ease-out" : "opacity 420ms cubic-bezier(0.55,0,0.68,0.4)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`card-glow relative z-10 w-full ${maxWidth} overflow-hidden rounded-3xl bg-card`}
        style={{
          transform: shown ? "translateY(0) scale(1)" : "translateY(12px) scale(0.97)",
          opacity: shown ? 1 : 0,
          filter: shown ? "blur(0px)" : "blur(8px)",
          transition: shown
            ? "transform 460ms cubic-bezier(0.22,1,0.36,1), opacity 460ms ease-out, filter 460ms ease-out"
            : "transform 420ms cubic-bezier(0.55,0,0.68,0.4), opacity 420ms cubic-bezier(0.55,0,0.68,0.4), filter 420ms cubic-bezier(0.55,0,0.68,0.4)",
        }}
      >
        <AnimatedHeight maxHeight="calc(100dvh - 2rem)">{children}</AnimatedHeight>
      </div>
    </div>,
    document.body,
  )
}

/** 右侧抽屉外壳：Portal 到 body，自右向左滑入（通知中心样式） */
export function DrawerShell({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean
  onClose: () => void
  label: string
  children: React.ReactNode
}) {
  const { mounted, shown } = useOverlayTransition(open, onClose)
  if (!mounted || typeof document === "undefined") return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        aria-label="关闭"
        onClick={onClose}
        className="fixed inset-0 bg-background/60 backdrop-blur-sm"
        style={{
          opacity: shown ? 1 : 0,
          transition: shown ? "opacity 360ms ease-out" : "opacity 420ms cubic-bezier(0.55,0,0.68,0.4)",
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="card-glow relative z-10 m-3 flex w-full max-w-md flex-col overflow-hidden rounded-3xl bg-card sm:m-4"
        style={{
          transform: shown ? "translateX(0)" : "translateX(28px)",
          opacity: shown ? 1 : 0,
          filter: shown ? "blur(0px)" : "blur(8px)",
          transition: shown
            ? "transform 460ms cubic-bezier(0.22,1,0.36,1), opacity 460ms ease-out, filter 460ms ease-out"
            : "transform 420ms cubic-bezier(0.55,0,0.68,0.4), opacity 420ms cubic-bezier(0.55,0,0.68,0.4), filter 420ms cubic-bezier(0.55,0,0.68,0.4)",
        }}
      >
        {children}
      </aside>
    </div>,
    document.body,
  )
}

/** 弹层通用头部：图标 + 标题 + 描述 + 关闭键 */
export function OverlayHeader({
  icon,
  title,
  desc,
  onClose,
  extra,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  onClose: () => void
  extra?: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-5 sm:p-6">
      <div className="flex items-start gap-3">
        {/* 头部图标统一为无底色描边样式 */}
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border text-foreground">
          {icon}
        </span>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {extra}
        <button
          aria-label="关闭"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
