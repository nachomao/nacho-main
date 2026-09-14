"use client"

import { useEffect, useRef, useState } from "react"
import { RollingNumber } from "@/components/rolling-number"

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
  /** @deprecated 数值更新现在始终从上一个值滚动，以保持统一的 iOS 风格。 */
  animateFromPrevious?: boolean
  prefix?: string
  suffix?: string
  className?: string
}

export function AnimatedNumber({
  value,
  from = 0,
  duration = 650,
  decimals = 0,
  delay = 0,
  prefix = "",
  suffix = "",
  className,
}: AnimatedNumberProps) {
  const [entered, setEntered] = useState(false)
  const [rollingValue, setRollingValue] = useState(from)
  const initializedRef = useRef(false)

  // 整块数值的上移、渐显和去模糊只在组件首次挂载时执行一次。
  // 后续服务端轮询只会更新 RollingNumber，不会重新触发进场效果。
  useEffect(() => {
    const timer = window.setTimeout(() => setEntered(true), delay)
    return () => {
      window.clearTimeout(timer)
    }
  }, [delay])

  // 首帧保留 from，挂载后再交给逐位滚动组件前往真实值。
  // value 此后发生任何增减，都只更新目标值而不重置外层进场状态。
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      const timer = window.setTimeout(() => setRollingValue(value), delay)
      return () => window.clearTimeout(timer)
    }
    setRollingValue(value)
  }, [delay, value])

  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", verticalAlign: "middle" }}
    >
      <span
        data-number-entered={entered}
        style={{
          display: "inline-flex",
          alignItems: "center",
          lineHeight: "inherit",
          filter: entered ? "blur(0)" : "blur(6px)",
          transform: entered ? "translateY(0)" : "translateY(16px)",
          opacity: entered ? 1 : 0.35,
          fontVariantNumeric: "tabular-nums",
          transition: `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1), filter ${duration}ms ease-out, opacity ${Math.min(duration, 450)}ms ease-out`,
          willChange: "transform, filter, opacity",
        }}
      >
        <RollingNumber
          value={rollingValue}
          decimals={decimals}
          duration={duration}
          prefix={prefix}
          suffix={suffix}
        />
      </span>
    </span>
  )
}
