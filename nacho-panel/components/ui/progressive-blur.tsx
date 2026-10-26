import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"

/** 逐层加倍的模糊半径；各层遮罩错位叠加，越靠近强模糊一侧叠加的层越多、模糊越重。 */
const BLUR_LAYERS = [1, 2, 4, 8]

const LAYER_CLASS = "absolute inset-0 transition-opacity duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"

type Edge = "top" | "bottom"

function blurStyle(radius: number, mask: Pick<CSSProperties, "maskImage" | "maskComposite">): CSSProperties {
  return { backdropFilter: `blur(${radius}px)`, WebkitBackdropFilter: `blur(${radius}px)`, ...mask }
}

/**
 * 单侧渐进式背景模糊带（类似 iOS 状态栏下方内容逐渐虚化），用于滚动容器内部边缘。
 * 透明度直接作用在带 backdrop-filter 的图层上：若放在父级，父级会成为 Backdrop Root，模糊将采样不到下层文字。
 */
export function ProgressiveBlur({ strongEdge, visible, tint, className }: {
  strongEdge: Edge
  visible: boolean
  /** 叠加在模糊之上的色调（CSS 颜色或变量），在强模糊一侧逐渐加深 */
  tint?: string
  className?: string
}) {
  const layerClass = cn(LAYER_CLASS, visible ? "opacity-100" : "opacity-0")
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-x-0", className)}>
      {BLUR_LAYERS.map((radius, index) => {
        const from = (index / BLUR_LAYERS.length) * 100
        const to = ((index + 1) / BLUR_LAYERS.length) * 100
        const maskImage = `linear-gradient(to ${strongEdge}, transparent ${from}%, black ${to}%)`
        return <div key={radius} className={layerClass} style={blurStyle(radius, { maskImage })} />
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

/** 在 [start, end] 比例区间内从透明过渡到不透明的四边羽化遮罩；横纵两条渐变取交集，四角自然收成柔和弧形。 */
function featheredFrame(spreadX: number, spreadY: number, start: number, end: number): Pick<CSSProperties, "maskImage" | "maskComposite"> {
  const frame = (direction: "bottom" | "right", spread: number) => {
    const from = spread * start
    const to = spread * end
    return `linear-gradient(to ${direction}, transparent ${from}px, black ${to}px, black calc(100% - ${to}px), transparent calc(100% - ${from}px))`
  }
  return { maskImage: `${frame("bottom", spreadY)}, ${frame("right", spreadX)}`, maskComposite: "intersect" }
}

/**
 * 环绕式渐进模糊光晕：铺满所包裹元素（含其圆角外的缺口），并向四周外扩 spreadX / spreadY，
 * 越贴近元素边缘模糊越重、越向外越清晰，四边与四角均无硬边。需放在被包裹元素之前，由其覆盖中心区域。
 */
export function ProgressiveBlurHalo({ visible, spreadX, spreadY, tint, className }: {
  visible: boolean
  spreadX: number
  spreadY: number
  /** 叠加在模糊之上的色调（CSS 颜色或变量），越贴近元素越浓 */
  tint?: string
  className?: string
}) {
  const layerClass = cn(LAYER_CLASS, visible ? "opacity-100" : "opacity-0")
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute", className)}
      style={{ inset: `-${spreadY}px -${spreadX}px` }}
    >
      {BLUR_LAYERS.map((radius, index) => (
        <div
          key={radius}
          className={layerClass}
          style={blurStyle(radius, featheredFrame(spreadX, spreadY, index / BLUR_LAYERS.length, (index + 1) / BLUR_LAYERS.length))}
        />
      ))}
      {tint && (
        <div
          className={layerClass}
          style={{ background: `color-mix(in oklch, ${tint} 60%, transparent)`, ...featheredFrame(spreadX, spreadY, 0, 1) }}
        />
      )}
    </div>
  )
}
