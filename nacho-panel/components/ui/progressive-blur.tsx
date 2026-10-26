import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"

/** 逐层加倍的模糊半径；各层遮罩错位叠加，越靠近 strongEdge 叠加的层越多、模糊越重。 */
const BLUR_LAYERS = [1, 2, 4, 8]

type Edge = "top" | "bottom"

/**
 * 渐进式背景模糊带（类似 iOS 状态栏下方内容逐渐虚化）。
 * 透明度直接作用在带 backdrop-filter 的图层上：若放在父级，父级会成为 Backdrop Root，模糊将采样不到下层文字。
 */
export function ProgressiveBlur({ strongEdge, visible, tint, className }: {
  strongEdge: Edge
  visible: boolean
  /** 叠加在模糊之上的色调（CSS 颜色或变量），在强模糊一侧逐渐加深 */
  tint?: string
  className?: string
}) {
  const layerClass = cn(
    "absolute inset-0 transition-opacity duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
    visible ? "opacity-100" : "opacity-0",
  )
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-x-0", className)}>
      {BLUR_LAYERS.map((radius, index) => {
        const from = (index / BLUR_LAYERS.length) * 100
        const to = ((index + 1) / BLUR_LAYERS.length) * 100
        const mask = `linear-gradient(to ${strongEdge}, transparent ${from}%, black ${to}%)`
        const style: CSSProperties = {
          backdropFilter: `blur(${radius}px)`,
          WebkitBackdropFilter: `blur(${radius}px)`,
          maskImage: mask,
          WebkitMaskImage: mask,
        }
        return <div key={radius} className={layerClass} style={style} />
      })}
      {tint && (
        <div
          className={layerClass}
          style={{ background: `linear-gradient(to ${strongEdge}, transparent, color-mix(in oklch, ${tint} 72%, transparent))` }}
        />
      )}
    </div>
  )
}
