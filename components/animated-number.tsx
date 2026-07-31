"use client"

import { useEffect, useRef, useState } from "react"

// iOS 风格缓动：起步快、尾部柔和收住
function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

interface AnimatedNumberProps {
  /** 目标数值 */
  value: number
  /** 起始数值，默认 0 */
  from?: number
  /** 动画时长（毫秒） */
  duration?: number
  /** 小数位数 */
  decimals?: number
  /** 启动延迟（毫秒），用于错落进场 */
  delay?: number
  /** 数值变化时是否从上一个数值滚动到新数值（iOS 风格） */
  animateFromPrevious?: boolean
  prefix?: string
  suffix?: string
  className?: string
}

export function AnimatedNumber({
  value,
  from = 0,
  duration = 1400,
  decimals = 0,
  delay = 0,
  animateFromPrevious = false,
  prefix = "",
  suffix = "",
  className,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(from)
  const [progress, setProgress] = useState(0) // 0 → 1
  const rafRef = useRef<number | null>(null)
  // 记录上一次的目标值，用于 iOS 风格的「从上一个数值滚动到新数值」
  const prevValueRef = useRef(from)

  useEffect(() => {
    // 起始值：可从上一次的目标值滚动，或从固定 from 进场
    const start = animateFromPrevious ? prevValueRef.current : from
    let startTime: number | null = null
    let timer: ReturnType<typeof setTimeout>

    const tick = (now: number) => {
      if (startTime === null) startTime = now
      const t = Math.min(1, (now - startTime) / duration)
      const eased = easeOutCubic(t)
      setDisplay(start + (value - start) * eased)
      setProgress(t)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    timer = setTimeout(() => {
      rafRef.current = requestAnimationFrame(tick)
    }, delay)

    prevValueRef.current = value

    return () => {
      clearTimeout(timer)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [value, from, duration, delay, animateFromPrevious])

  // 增大则从下方滚上来，减小则从上方滚下来
  const increasing = value >= (animateFromPrevious ? prevValueRef.current : from)
  const remaining = 1 - progress
  const blur = remaining * 6 // 进场模糊，逐渐清晰
  const translateY = (increasing ? 1 : -1) * remaining * 16 // 纵向滚动位移
  const opacity = 0.35 + 0.65 * progress

  // 外层不加 overflow:hidden：否则进场时内层的模糊光晕会被盒子边界硬裁成矩形。
  // 进场靠 translateY 上移就位 + 渐显 + 由模糊到清晰来呈现，无需裁剪遮罩。
  return (
    <span className={className} style={{ display: "inline-block", verticalAlign: "bottom" }}>
      <span
        style={{
          display: "inline-block",
          filter: `blur(${blur}px)`,
          transform: `translateY(${translateY}px)`,
          opacity,
          fontVariantNumeric: "tabular-nums",
          willChange: "transform, filter, opacity",
        }}
      >
        {prefix}
        {display.toFixed(decimals)}
        {suffix}
      </span>
    </span>
  )
}
