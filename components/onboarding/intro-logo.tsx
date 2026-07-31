"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"

/** "acho Panel" 逐字组排（N 由 SVG 单独绘制） */
const LETTERS = "acho Panel".split("")

/** 开场时 N 相对最终尺寸的放大倍数（最终 88px，开场约 210px） */
const INTRO_SCALE = 210 / 88

/**
 * 第一部分：品牌开场。
 * 1. 延迟 0.75s 后，居中的大号 N（沿用全局品牌 Logo 的字形：左竖 + 右竖 + 灰色斜笔画）
 *    分部生长画出：左竖自底部升起、右竖自顶部降下，随后斜笔画上下两块淡入。
 * 2. 画完后 N 缩小并左移让位，"acho Panel" 逐字从下方带模糊渐显与 N 组排。
 * 3. 完整展示 2s 后，从最后一个字到 N 逐个下移模糊渐隐（从右往左）。
 *
 * 丝滑要点：整组 N + 文字固定在"最终布局"，开场态用「以 N 中心为原点的 translateX + scale」
 * 变换模拟"N 放大居中"，settle 时变换回归 identity。全程只跑 transform / opacity，
 * 不animate width/height，避免逐帧重排导致的卡顿。
 */
export function IntroLogo({ onDone }: { onDone: () => void }) {
  // idle: 空场等待 → draw: N 生长画出 → settle: N 归位 + 文字组排 → exit: 逐字离场
  const [stage, setStage] = useState<"idle" | "draw" | "settle" | "exit">("idle")
  const groupRef = useRef<HTMLDivElement>(null)
  const nRef = useRef<HTMLSpanElement>(null)
  // 开场态的组变换（以 N 中心为原点放大并平移到视觉中心）
  const [introTf, setIntroTf] = useState("")
  const [origin, setOrigin] = useState("center")
  // 计测完成前保持不可见，避免第 1 帧以"最终左对齐布局"出现而产生移动痕迹
  const [ready, setReady] = useState(false)
  // 渐变 id 唯一化，避免 <defs> 冲突
  const uid = useId().replace(/:/g, "")
  const blockG = `${uid}-blockG`
  const blockDim = `${uid}-blockDim`

  // 挂载后测量：算出让 N 居中并放大的组变换（此刻 N 尚未画出、不可见，无闪烁）
  useLayoutEffect(() => {
    const g = groupRef.current
    const n = nRef.current
    if (!g || !n) return
    const gb = g.getBoundingClientRect()
    const nb = n.getBoundingClientRect()
    const originX = nb.left - gb.left + nb.width / 2
    const originY = nb.top - gb.top + nb.height / 2
    // 组居中 → 组中心即视觉中心；把 N 中心平移到组中心
    const dx = gb.width / 2 - (originX)
    setOrigin(`${originX}px ${originY}px`)
    setIntroTf(`translateX(${dx}px) scale(${INTRO_SCALE})`)
    setReady(true)
  }, [])

  useEffect(() => {
    const timers: number[] = []
    // 0.8s 延迟后开始生长
    timers.push(window.setTimeout(() => setStage("draw"), 800))
    // 生长完成后进入组排（N 归位 + 文字入场）——生长时长放慢至 1650ms
    timers.push(window.setTimeout(() => setStage("settle"), 800 + 1650))
    // 组排完成后停留 2s 离场
    timers.push(window.setTimeout(() => setStage("exit"), 800 + 1650 + 2000))
    // 离场：11 个字形（含 N）反向错峰 × 80ms + 单字 800ms
    timers.push(window.setTimeout(onDone, 800 + 1650 + 2000 + LETTERS.length * 80 + 850))
    return () => timers.forEach(clearTimeout)
  }, [onDone])

  const drawn = stage === "draw" || stage === "settle" || stage === "exit"
  const settled = stage === "settle" || stage === "exit"
  const exiting = stage === "exit"

  /** 单个字形的入场/离场样式。glyphIndex 含 N（N 为 0），离场从右往左反向错峰 */
  const glyphStyle = (glyphIndex: number): React.CSSProperties => {
    const total = LETTERS.length + 1 // 含 N
    if (exiting) {
      return {
        opacity: 0,
        transform: "translateY(22px)",
        filter: "blur(10px)",
        transition: `opacity 800ms ease-in, transform 800ms ${EASE}, filter 800ms ease-in`,
        transitionDelay: `${(total - 1 - glyphIndex) * 80}ms`,
      }
    }
    return {
      opacity: settled ? 1 : 0,
      transform: settled ? "translateY(0)" : "translateY(18px)",
      filter: settled ? "blur(0px)" : "blur(10px)",
      transition: `opacity 680ms ease-out, transform 680ms ${EASE}, filter 680ms ease-out`,
      transitionDelay: settled ? `${170 + glyphIndex * 88}ms` : "0ms",
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center" aria-label="Nacho Panel">
      {/* 组：固定最终布局；开场态整体放大居中，settle 时变换回归 identity（纯 transform 过渡） */}
      <div
        ref={groupRef}
        className="flex items-center will-change-transform"
        style={{
          transform: settled ? "none" : introTf,
          transformOrigin: origin,
          // 关键：仅在 settle 归位时才过渡。idle/draw 阶段无过渡，开场态瞬间居中，
          // 避免挂载时从 none → introTf 产生"从左滑入中间"的错觉。
          transition: settled ? `transform 1050ms ${EASE}` : "none",
          // 计测完成前不可见（visibility 不影响布局，仍可测量），彻底消除第 1 帧的左对齐痕迹
          visibility: ready ? "visible" : "hidden",
        }}
      >
        {/* N：BrandLogo 字形，两竖分别自底/顶生长，斜笔画随后淡入。
            idle 阶段整体不可见，避免 clip-path 折叠态残留的圆角碎片；draw 起同时显形并开始描出 */}
        <span
          ref={nRef}
          style={exiting ? glyphStyle(0) : { opacity: stage === "idle" ? 0 : 1 }}
          className="inline-flex"
        >
          <svg viewBox="0 0 44 44" fill="none" aria-hidden style={{ width: 88, height: 88 }}>
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

            {/* 斜笔画上块：两竖擦出后淡入 + 轻微上浮 */}
            <polygon
              points="17,9 26,20.7 17,20.7"
              fill={`url(#${blockDim})`}
              style={{
                opacity: drawn ? 1 : 0,
                transformBox: "fill-box",
                transformOrigin: "center",
                transform: drawn ? "translateY(0)" : "translateY(3px)",
                transition: `opacity 660ms ease-out, transform 660ms ${EASE}`,
                transitionDelay: drawn ? "640ms" : "0ms",
              }}
            />
            {/* 斜笔画下块 */}
            <polygon
              points="18,23.3 27,23.3 27,35"
              fill={`url(#${blockDim})`}
              style={{
                opacity: drawn ? 1 : 0,
                transformBox: "fill-box",
                transformOrigin: "center",
                transform: drawn ? "translateY(0)" : "translateY(3px)",
                transition: `opacity 660ms ease-out, transform 660ms ${EASE}`,
                transitionDelay: drawn ? "740ms" : "0ms",
              }}
            />

            {/* 左竖：clip-path 自底部向上擦出（圆角不变形） */}
            <rect
              x="8"
              y="7"
              width="8"
              height="30"
              rx="3"
              fill={`url(#${blockG})`}
              style={{
                // 不加 round：矩形自身 rx=3 已提供圆角，clip 用纯矩形擦除，
                // 折叠态才能完全清空、不残留圆角碎片（即之前中间的两个灰点）
                clipPath: drawn ? "inset(0 0 0 0)" : "inset(100% 0 0 0)",
                transition: `clip-path 920ms ${EASE}`,
              }}
            />
            {/* 右竖：clip-path 自顶部向下擦出 */}
            <rect
              x="28"
              y="7"
              width="8"
              height="30"
              rx="3"
              fill={`url(#${blockG})`}
              style={{
                clipPath: drawn ? "inset(0 0 0 0)" : "inset(0 0 100% 0)",
                transition: `clip-path 920ms ${EASE}`,
                transitionDelay: drawn ? "140ms" : "0ms",
              }}
            />

            {/* 顶部高光线 */}
            <rect x="8" y="7" width="8" height="5" rx="3" fill="white" fillOpacity="0.15" />
            <rect x="28" y="7" width="8" height="5" rx="3" fill="white" fillOpacity="0.15" />
          </svg>
        </span>

        {/* 剩余文字：始终在流中占位（不 animate 宽度），逐字带模糊错峰渐显 */}
        <span className="-ml-3 inline-flex whitespace-pre text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
          {LETTERS.map((ch, i) => (
            <span key={i} className="inline-block" style={glyphStyle(i + 1)}>
              {ch === " " ? "\u00A0" : ch}
            </span>
          ))}
        </span>
      </div>
    </div>
  )
}
