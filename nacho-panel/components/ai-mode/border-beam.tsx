"use client"

/**
 * BorderBeam：一束渐变光沿元素边框环绕流动。
 * 实现方式：外层用双 mask 只保留 1px 边框环，内层光斑沿
 * offset-path: rect(...) 环绕一周，形成「流光边框」效果。
 * 父元素需要 position: relative + rounded-*。
 */
export function BorderBeam({
  size = 96,
  duration = 7,
  delay = 0,
  colorFrom = "#3b82f6",
  colorTo = "#a855f7",
  opacity = 1,
  reverse = false,
  glow = false,
}: {
  /** 光斑尺寸（px），越大光束越长 */
  size?: number
  /** 环绕一周耗时（秒） */
  duration?: number
  /** 起始延迟（秒），多条光束错峰 */
  delay?: number
  colorFrom?: string
  colorTo?: string
  opacity?: number
  reverse?: boolean
  /** 弥散光晕模式：只渲染重模糊的柔光雾沿边框流动，不渲染细流光线条 */
  glow?: boolean
}) {
  const sharedAnim = {
    animationDuration: `${duration}s`,
    animationDelay: `${delay}s`,
    animationDirection: reverse ? "reverse" : "normal",
  } as const

  /* 颜色通过 @property 注册的 CSS 变量传入渐变，变量本身可插值，
     实现风险色（safe→warn→danger）的平滑渐变过渡 */
  const colorVars = {
    "--beam-from": colorFrom,
    "--beam-to": colorTo,
    background: "linear-gradient(to left, var(--beam-from), var(--beam-to), transparent)",
    transition: "--beam-from 1500ms ease, --beam-to 1500ms ease",
  } as React.CSSProperties

  if (glow) {
    return (
      <div aria-hidden className="border-beam-glow-track">
        <div
          className="border-beam-glow-spot"
          style={{
            width: size * 3,
            opacity: opacity * 0.85,
            offsetPath: `rect(0 auto auto 0 round ${size}px)`,
            ...colorVars,
            ...sharedAnim,
          }}
        />
      </div>
    )
  }

  return (
    <div aria-hidden className="border-beam-track">
      <div
        className="border-beam-spot"
        style={{
          width: size,
          opacity,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          ...colorVars,
          ...sharedAnim,
        }}
      />
    </div>
  )
}
