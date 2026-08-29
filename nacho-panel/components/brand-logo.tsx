import { useId } from "react"

/**
 * 全局品牌 Logo：仅 N 字母（无圆框底板）。
 * 左竖 + 右竖为白色渐变，中间斜笔画为灰色平行四边形并沿水平中线拆成上下两块，
 * 保留 Windows Panel 分格感。
 *
 * 渐变 id 通过 useId 生成，确保同页多处渲染时 <defs> 不冲突。
 * 通过 className 控制尺寸/颜色（默认 h-11 w-11）。
 */
export function BrandLogo({
  className = "h-11 w-11",
  title = "NachoNeko Logo",
}: {
  className?: string
  title?: string
}) {
  const uid = useId().replace(/:/g, "")
  const blockG = `${uid}-blockG`
  const blockDim = `${uid}-blockDim`

  return (
    <svg viewBox="0 0 44 44" className={className} fill="none" role="img" aria-label={title}>
      <defs>
        <linearGradient id={blockG} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="oklch(1 0 0)" />
          <stop offset="100%" stopColor="oklch(0.85 0 0)" />
        </linearGradient>
        <linearGradient id={blockDim} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="oklch(0.7 0 0)" />
          <stop offset="100%" stopColor="oklch(0.5 0 0)" />
        </linearGradient>
      </defs>

      {/* 斜笔画上块 */}
      <polygon points="17,9 26,20.7 17,20.7" fill={`url(#${blockDim})`} />
      {/* 斜笔画下块 */}
      <polygon points="18,23.3 27,23.3 27,35" fill={`url(#${blockDim})`} />

      {/* 左竖（叠在上层，圆角） */}
      <rect x="8" y="7" width="8" height="30" rx="3" fill={`url(#${blockG})`} />
      {/* 右竖 */}
      <rect x="28" y="7" width="8" height="30" rx="3" fill={`url(#${blockG})`} />

      {/* 顶部高光线 */}
      <rect x="8" y="7" width="8" height="5" rx="3" fill="white" fillOpacity="0.15" />
      <rect x="28" y="7" width="8" height="5" rx="3" fill="white" fillOpacity="0.15" />
    </svg>
  )
}
