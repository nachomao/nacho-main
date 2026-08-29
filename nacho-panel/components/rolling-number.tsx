"use client"

interface RollingNumberProps {
  /** 目标数值 */
  value: number
  /** 小数位数 */
  decimals?: number
  /** 单个数字滚动时长（毫秒） */
  duration?: number
  prefix?: string
  suffix?: string
  className?: string
}

/**
 * iOS 风格的逐位数字滚动（里程表 / odometer 效果）。
 * 每一位数字都是一列 0~9 的纵向条带，仅发生变化的那一位会滚动，
 * 未变化的数字保持静止，从而呈现灵动、自然的过渡，而非整体模糊。
 */
function Digit({ digit, delay, duration }: { digit: number; delay: number; duration: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        height: "1em",
        lineHeight: "1em",
        overflow: "hidden",
        verticalAlign: "bottom",
      }}
    >
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          transform: `translateY(${-digit}em)`,
          // 带轻微回弹的缓动，模拟 iOS 的弹性滚动手感
          transition: `transform ${duration}ms cubic-bezier(0.34, 1.3, 0.4, 1)`,
          transitionDelay: `${delay}ms`,
          willChange: "transform",
        }}
      >
        {Array.from({ length: 10 }).map((_, i) => (
          <span key={i} style={{ height: "1em", lineHeight: "1em" }}>
            {i}
          </span>
        ))}
      </span>
    </span>
  )
}

export function RollingNumber({
  value,
  decimals = 0,
  duration = 650,
  prefix = "",
  suffix = "",
  className,
}: RollingNumberProps) {
  const text = value.toFixed(decimals)
  const chars = text.split("")
  // 统计数字位的序号，越靠右越先启动，形成自然的级联滚动
  const digitCount = chars.filter((c) => /\d/.test(c)).length
  let digitIndex = -1

  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "flex-end", fontVariantNumeric: "tabular-nums" }}
    >
      {prefix}
      {chars.map((c, i) => {
        if (/\d/.test(c)) {
          digitIndex += 1
          // 右侧数字先动、左侧稍后，制造级联
          const delay = (digitCount - 1 - digitIndex) * 55
          return <Digit key={i} digit={Number(c)} delay={delay} duration={duration} />
        }
        return (
          <span key={i} style={{ display: "inline-block" }}>
            {c}
          </span>
        )
      })}
      {suffix}
    </span>
  )
}
