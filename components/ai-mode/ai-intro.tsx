"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"
/** 带回弹的弹性缓动：字形落位和伴星弹出用它制造过冲 */
const BOUNCE = "cubic-bezier(0.34, 1.56, 0.64, 1)"

/** "I Mode" 逐字组排（A 与星辉由 SVG 单独绘制，字形 0 = 星辉+A 组合） */
const LETTERS = "I Mode".split("")

/** 星辉最终布局尺寸与开场展示尺寸（星辉始终按大尺寸栅格化，只缩小不放大，保证全程锐利） */
const MARK_SIZE = 88
const INTRO_SIZE = 200

/**
 * AI Mode 载入开场（与首次进入项目的 N 字开场同一动画语言）。
 * 1. 短暂空场后，居中的大号四芒星辉以 SVG 原生变换旋转入场，
 *    光瓣同时从中心向外展开，完成后右上角小伴星带过冲弹出。
 * 2. 星辉缩小并左移让位，"AI Mode" 逐字以 3D 翻转 + 回弹落位，
 *    落位瞬间带主色辉光，随后褪为正常字色，最后一道高光扫过全词。
 * 3. 完整展示约 1.4s 后，从最后一个字到星辉逐个上抛翻转渐隐（从右往左）。
 *
 * 丝滑要点：组固定最终布局，开场态只用 translateX 把星辉推到屏幕中心
 * （组不做 scale——放大会让浏览器按小尺寸栅格化图层导致发糊）；
 * 星辉本体始终按 200px 大尺寸渲染，settle 时缩小到 88px 布局盒。
 * 全程只跑 transform / opacity / filter，不动布局属性。
 */
export function AIIntro({ onDone }: { onDone: () => void }) {
  // idle: 空场等待 → draw: 星辉生长 → settle: 归位 + 文字组排 → exit: 逐字离场
  const [stage, setStage] = useState<"idle" | "draw" | "settle" | "exit">("idle")
  const groupRef = useRef<HTMLDivElement>(null)
  const markRef = useRef<HTMLSpanElement>(null)
  const [introTf, setIntroTf] = useState("")
  const [ready, setReady] = useState(false)
  const uid = useId().replace(/:/g, "")
  const petalG = `${uid}-petalG`
  const glowG = `${uid}-glowG`

  // 挂载后测量：算出让星辉水平居中的纯平移组变换（此刻尚未画出、不可见，无闪烁）
  useLayoutEffect(() => {
    const g = groupRef.current
    const n = markRef.current
    if (!g || !n) return
    const gb = g.getBoundingClientRect()
    const nb = n.getBoundingClientRect()
    const markCenterX = nb.left - gb.left + nb.width / 2
    const dx = gb.width / 2 - markCenterX
    setIntroTf(`translateX(${dx}px)`)
    setReady(true)
  }, [])

  useEffect(() => {
    // 组件在暗幕铺垫（dimming，约 900ms）开始时即挂载：
    // 星辉在暗幕收尾段（约 700ms）淡入登场，与变暗的尾巴轻微重叠——
    // 既不会在亮背景上抢跑，也不留"黑屏空场"，衔接更丝滑
    const START = 700
    const timers: number[] = []
    timers.push(window.setTimeout(() => setStage("draw"), START))
    // 旋转（1.2s）收尾段极缓，组排在尾段就启动，星辉不再单独干等
    const DRAW_MS = 1100
    timers.push(window.setTimeout(() => setStage("settle"), START + DRAW_MS))
    // 组排 + 高光扫过后停留片刻再离场
    timers.push(window.setTimeout(() => setStage("exit"), START + DRAW_MS + 1650))
    // 离场：7 个字形（含星辉）反向错峰 × 60ms + 单字 600ms
    timers.push(window.setTimeout(onDone, START + DRAW_MS + 1650 + (LETTERS.length + 1) * 60 + 650))
    return () => timers.forEach(clearTimeout)
  }, [onDone])

  const drawn = stage === "draw" || stage === "settle" || stage === "exit"
  const settled = stage === "settle" || stage === "exit"
  const exiting = stage === "exit"

  /** 单个字形的入场/离场样式（0 = 星辉，离场从右往左反向错峰） */
  const glyphStyle = (glyphIndex: number): React.CSSProperties => {
    const total = LETTERS.length + 1
    if (exiting) {
      // 离场：上抛 + 反向翻转 + 模糊，右往左错峰
      return {
        opacity: 0,
        transform: "translateY(-26px) rotateX(-70deg) scale(0.7)",
        filter: "blur(12px)",
        transition: `opacity 600ms ease-in, transform 600ms ${EASE}, filter 600ms ease-in`,
        transitionDelay: `${(total - 1 - glyphIndex) * 60}ms`,
      }
    }
    // 入场：从下方带 3D 翻转 + 缩小状态弹性落位，落位瞬间带主色辉光再褪色
    return {
      opacity: settled ? 1 : 0,
      transform: settled ? "translateY(0) rotateX(0deg) scale(1)" : "translateY(30px) rotateX(78deg) scale(0.55)",
      filter: settled ? "blur(0px)" : "blur(14px)",
      color: settled ? undefined : "var(--primary)",
      textShadow: settled ? "0 0 0 transparent" : "0 0 24px color-mix(in oklab, var(--primary) 80%, transparent)",
      transition: `opacity 520ms ease-out, transform 720ms ${BOUNCE}, filter 520ms ease-out, color 900ms ease-out, text-shadow 900ms ease-out`,
      transitionDelay: settled ? `${180 + glyphIndex * 72}ms` : "0ms",
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center" aria-label="AI Mode 正在载入">
      <div
        ref={groupRef}
        className="flex items-center will-change-transform"
        style={{
          transform: settled ? "none" : introTf,
          transition: settled ? `transform 980ms ${EASE}` : "none",
          visibility: ready ? "visible" : "hidden",
        }}
      >
        {/* 星辉 + A：主星以 SVG 原生变换旋转，光瓣从中心向外展开，伴星随后弹出。
            抗糊关键：SVG 始终以 200px 原生尺寸栅格化，开场原尺寸展示（scale 1），
            settle 时缩小到 88px 布局盒（scale 0.44）——只缩小不放大，全程锐利 */}
        <span
          ref={markRef}
          style={{
            width: MARK_SIZE,
            height: MARK_SIZE,
            ...(exiting
              ? glyphStyle(0)
              : { opacity: stage === "idle" ? 0 : 1, transition: "opacity 350ms ease-out" }),
          }}
          className="relative inline-flex"
        >
          {/* 200px 渲染层：以 88px 布局盒中心为锚点，开场满尺寸、settle 缩回 */}
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 inline-flex shrink-0"
            style={{
              width: INTRO_SIZE,
              height: INTRO_SIZE,
              marginLeft: -INTRO_SIZE / 2,
              marginTop: -INTRO_SIZE / 2,
              transform: settled ? `scale(${MARK_SIZE / INTRO_SIZE})` : "scale(1)",
              transition: settled ? `transform 980ms ${EASE}` : "none",
            }}
          >
          {/* SVG 和主星路径均不做 CSS transform，避免 Chromium 在动画首帧
              把矢量层栅格化。旋转使用 SVG animateTransform，光瓣通过
              clip-path 展开，全程保持矢量边缘。 */}
          <svg
            viewBox="0 0 44 44"
            fill="none"
            aria-hidden
            shapeRendering="geometricPrecision"
            style={{ width: INTRO_SIZE, height: INTRO_SIZE, display: "block" }}
          >
            <defs>
              <linearGradient id={petalG} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--primary)" />
                <stop offset="100%" stopColor="color-mix(in oklab, var(--primary) 55%, oklch(0.85 0 0))" />
              </linearGradient>
              <radialGradient id={glowG}>
                <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* 背后柔光：生长时缓缓浮现 */}
            <circle
              cx="21"
              cy="22"
              r="20"
              fill={`url(#${glowG})`}
              style={{
                opacity: drawn ? 1 : 0,
                transition: "opacity 1100ms ease-out",
                transitionDelay: drawn ? "300ms" : "0ms",
              }}
            />

            {/* drawn 切换时重建分组，使 SVG 原生旋转从第一帧重新开始。 */}
            <g key={drawn ? "drawn" : "idle"}>
            {drawn && (
              /* 旋转量 1.5 圈、1.2s 收尾：光瓣展开完成（约 700ms）时
                 仍有明显旋转余量，避免"转完了才看见星"的观感 */
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="-540 21 22"
                to="0 21 22"
                dur="1.2s"
                calcMode="spline"
                keyTimes="0;1"
                keySplines="0.3 0.55 0.35 1"
                fill="freeze"
              />
            )}
            {/* 竖向光瓣：用裁剪区域自中心向上下展开。 */}
            <path
              d="M21 3 C22.2 13.5 23.5 17.5 26 22 C23.5 26.5 22.2 30.5 21 41 C19.8 30.5 18.5 26.5 16 22 C18.5 17.5 19.8 13.5 21 3 Z"
              fill={`url(#${petalG})`}
              style={{
                clipPath: drawn ? "inset(0% 0% 0% 0%)" : "inset(50% 0% 50% 0%)",
                transition: `clip-path 700ms ${EASE}`,
              }}
            />
            {/* 横向光瓣：稍晚自中心向左右展开。 */}
            <path
              d="M2 22 C12.5 20.8 16.5 19.5 21 17 C25.5 19.5 29.5 20.8 40 22 C29.5 23.2 25.5 24.5 21 27 C16.5 24.5 12.5 23.2 2 22 Z"
              fill={`url(#${petalG})`}
              style={{
                clipPath: drawn ? "inset(0% 0% 0% 0%)" : "inset(0% 50% 0% 50%)",
                transition: `clip-path 700ms ${EASE}`,
                transitionDelay: drawn ? "120ms" : "0ms",
              }}
            />
            </g>
            {/* 小伴星：星辉转定后带过冲弹出（scale 0→1.45→1 + 自旋半圈），不随主星旋转 */}
            <path
              d="M36 5 C36.5 8 37.5 9 40 9.5 C37.5 10 36.5 11 36 14 C35.5 11 34.5 10 32 9.5 C34.5 9 35.5 8 36 5 Z"
              fill="oklch(0.92 0 0)"
              style={{
                transformBox: "fill-box",
                transformOrigin: "center",
                transform: drawn ? "scale(1) rotate(0deg)" : "scale(0) rotate(-180deg)",
                transition: `transform 280ms ${BOUNCE}`,
                transitionDelay: drawn ? "980ms" : "0ms",
              }}
            />
          </svg>
          </span>
        </span>

        {/* "A" 紧贴星辉（视觉上星辉即 AI 的图形化 A 之后的第一个字母组）：
            这里文字部分为 "I Mode"，前面补一个 A 与星辉同组渐显。
            perspective 让字形的 rotateX 翻转带纵深感 */}
        <span
          className="relative -ml-2 inline-flex whitespace-pre text-5xl font-semibold tracking-tight text-foreground sm:text-6xl"
          style={{ perspective: "600px" }}
        >
          <span className="inline-block" style={glyphStyle(0)}>
            {"AI"[0]}
          </span>
          {LETTERS.map((ch, i) => (
            <span key={i} className="inline-block" style={glyphStyle(i + 1)}>
              {ch === " " ? "\u00A0" : ch}
            </span>
          ))}

          {/* 所有字落位后，一道斜向高光从左到右扫过全词 */}
          {settled && !exiting && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden"
              style={{ borderRadius: 8 }}
            >
              <span
                className="absolute inset-y-0 w-1/3"
                style={{
                  background:
                    "linear-gradient(105deg, transparent, color-mix(in oklab, var(--primary) 30%, oklch(1 0 0 / 0.5)), transparent)",
                  animation: `${uid}-sweep 800ms ${EASE} 720ms 1 both`,
                }}
              />
            </span>
          )}
          <style>{`@keyframes ${uid}-sweep { from { transform: translateX(-160%); } to { transform: translateX(420%); } }`}</style>
        </span>
      </div>
    </div>
  )
}
