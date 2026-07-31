"use client"

import type React from "react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export type SegmentedOption<T extends string> = {
  id: T
  label: string
  icon?: LucideIcon
  /** 可选的计数/角标，显示在文字右侧 */
  badge?: React.ReactNode
}

/**
 * 分段切换器：激活项由一个绝对定位的滑块指示器表示，
 * 切换时滑块平移过渡，避免背景直接闪烁的生硬感。
 *
 * 滑块位置/宽度通过实测每个按钮的真实布局得出，
 * 因此各分段宽度不同（如内容自适应）时也能精确对齐。
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  fill = false,
  variant = "default",
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (v: T) => void
  className?: string
  /** true 时子项等分容器宽度（占满一行），false 时按内容自适应 */
  fill?: boolean
  /** default：大号方角分段；pill：小号胶囊分段（带角标场景） */
  variant?: "default" | "pill"
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  })
  const [ready, setReady] = useState(false)

  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  )

  useLayoutEffect(() => {
    const container = containerRef.current
    const btn = btnRefs.current[activeIndex]
    if (!container || !btn) return
    const cRect = container.getBoundingClientRect()
    const bRect = btn.getBoundingClientRect()
    setIndicator({ left: bRect.left - cRect.left, width: bRect.width })
    // 首帧定位完成后再启用过渡，避免初始渲染时从 0 平移过来
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [activeIndex, options])

  // 容器尺寸变化时重新测量（响应式断点、窗口缩放等）
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => {
      const btn = btnRefs.current[activeIndex]
      if (!btn) return
      const cRect = container.getBoundingClientRect()
      const bRect = btn.getBoundingClientRect()
      setIndicator({ left: bRect.left - cRect.left, width: bRect.width })
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [activeIndex])

  const isPill = variant === "pill"

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex",
        isPill
          ? "items-center gap-1 rounded-full border border-border bg-surface/60 p-1"
          : "gap-2 rounded-2xl border border-border bg-surface/40 p-1.5",
        !isPill && (fill ? "w-full" : "w-full sm:w-fit"),
        className,
      )}
    >
      {/* 滑块指示器：用实测 left/width 定位并平移过渡 */}
      <div
        aria-hidden
        className={cn(
          "absolute bg-primary shadow-lg shadow-primary/25",
          isPill ? "inset-y-1 rounded-full" : "inset-y-1.5 rounded-xl",
          ready && "transition-all duration-300 ease-out",
        )}
        style={{ left: indicator.left, width: indicator.width }}
      />
      {options.map((o, i) => {
        const active = o.id === value
        return (
          <button
            key={o.id}
            ref={(el) => {
              btnRefs.current[i] = el
            }}
            type="button"
            onClick={() => onChange(o.id)}
            className={cn(
              "relative z-10 flex items-center justify-center font-medium transition-colors duration-200",
              isPill
                ? "h-8 gap-1.5 rounded-full px-3 text-xs"
                : "gap-2 rounded-xl px-5 py-2 text-sm",
              !isPill && (fill ? "flex-1" : "flex-1 sm:flex-none"),
              active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.icon && <o.icon className="h-4 w-4" />}
            {o.label}
            {o.badge != null && (
              <span
                className={cn(
                  "rounded-full px-1.5 font-mono text-[10px] transition-colors duration-200",
                  active ? "bg-primary-foreground/20" : "bg-muted",
                )}
              >
                {o.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
