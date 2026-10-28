"use client"

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react"

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"
/** 带回弹的弹性缓动：瞄准框锁定、伴星弹出用它制造过冲 */
const BOUNCE = "cubic-bezier(0.34, 1.56, 0.64, 1)"
/** 跃迁离场：先慢后极快的加速曲线，制造"冲出屏幕"的推进感 */
const WARP = "cubic-bezier(0.7, 0, 0.84, 0)"

const STAGES = ["idle", "ignite", "rings", "core", "lock", "reveal", "warp"] as const
type Stage = (typeof STAGES)[number]

/**
 * 各阶段起点（毫秒，相对挂载时刻）。组件在暗幕铺垫（dimming，约 900ms）开始时即挂载，
 * 点火扫描线与画面变暗的尾段重叠，既不在亮背景上抢跑，也不留黑屏空场。
 */
const TIMELINE = {
  ignite: 450,
  rings: 800,
  core: 1250,
  lock: 2300,
  reveal: 2450,
  warp: 3750,
} as const satisfies Record<Exclude<Stage, "idle">, number>
const DONE_AT = 4300

const WORD = "AI MODE".split("")
const SCRAMBLE = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=<>/\\"
/** 乱码字符刷新间隔 */
const SCRAMBLE_TICK = 50
/** 第 i 个字形解码完成的时刻：从左到右依次锁定 */
const resolveAt = (i: number) => TIMELINE.reveal + 300 + i * 85

/** 环形 HUD 的 SVG 中心（viewBox 0 0 320 320） */
const C = 160
const circ = (r: number) => 2 * Math.PI * r

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * AI Mode 载入开场：「反应堆点火」科幻序列。
 * 1. ignite：一道能量扫描线自中心横向展开（CRT 开机），随后 HUD 网格自中线上下张开。
 * 2. rings：四层 HUD 环由内向外交错旋入——刻度环、分段环、能量弧与内环描边，各自持续反向旋转。
 * 3. core：中心四芒星辉点火，光瓣展开并伴随两圈冲击波外扩；瞄准框从四角飞入，链路进度同步计数。
 * 4. lock / reveal：进度满格后瞄准框回弹锁定闪烁，"AI MODE" 由乱码逐字解码，落定瞬间带色差抖动。
 * 5. warp：整个装置放大冲出屏幕并模糊消散，伴随一次中心闪光，随后无缝交给工作台入场编排。
 *
 * 性能要点：除乱码与进度数字（rAF 直接写文本节点，不触发 React 重渲染）外，
 * 全程只跑 transform / opacity / filter / clip-path；持续旋转用 SVG 原生 animateTransform，保持矢量锐利。
 */
export function AIIntro({ onDone }: { onDone: () => void }) {
  const [still] = useState(prefersReducedMotion)
  const [stage, setStage] = useState<Stage>(() => (still ? "reveal" : "idle"))
  const glyphRefs = useRef<(HTMLSpanElement | null)[]>([])
  const counterRef = useRef<HTMLSpanElement>(null)
  const barRef = useRef<HTMLSpanElement>(null)
  const uid = useId().replace(/:/g, "")

  useEffect(() => {
    const timers: number[] = []
    // 只改写 React 已创建的文本节点的值，不替换节点，避免与 React 的协调过程冲突
    const writeText = (el: HTMLElement | null, text: string) => {
      const node = el?.firstChild
      if (node && node.nodeValue !== text) node.nodeValue = text
    }

    if (still) {
      // 减少动态效果：直接呈现最终画面，短暂停留后离场
      WORD.forEach((_, i) => {
        const el = glyphRefs.current[i]
        if (el) el.dataset.resolved = "1"
      })
      writeText(counterRef.current, "100")
      if (barRef.current) barRef.current.style.transform = "scaleX(1)"
      timers.push(window.setTimeout(() => setStage("warp"), 1000))
      timers.push(window.setTimeout(onDone, 1200))
      return () => timers.forEach(clearTimeout)
    }

    for (const s of Object.keys(TIMELINE) as (keyof typeof TIMELINE)[]) {
      timers.push(window.setTimeout(() => setStage(s), TIMELINE[s]))
    }
    timers.push(window.setTimeout(onDone, DONE_AT))

    const start = performance.now()
    const lastResolve = resolveAt(WORD.length - 1)
    let raf = 0
    let lastTick = -1
    const frame = (now: number) => {
      const t = now - start

      const p = Math.min(1, Math.max(0, (t - TIMELINE.rings) / (TIMELINE.lock - TIMELINE.rings)))
      const eased = 1 - (1 - p) ** 3
      writeText(counterRef.current, String(Math.round(eased * 100)).padStart(3, "0"))
      if (barRef.current) barRef.current.style.transform = `scaleX(${eased})`

      // 略早于 reveal 开始写乱码，确保字形淡入的第一帧就是乱码而非真实字母
      const tick = Math.floor(t / SCRAMBLE_TICK)
      if (t >= TIMELINE.reveal - 100 && tick !== lastTick) {
        lastTick = tick
        WORD.forEach((ch, i) => {
          const el = glyphRefs.current[i]
          if (!el || ch === " ") return
          const resolved = t >= resolveAt(i)
          writeText(el, resolved ? ch : SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)])
          if (resolved) el.dataset.resolved = "1"
        })
      }

      if (t < lastResolve + SCRAMBLE_TICK) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      timers.forEach(clearTimeout)
      cancelAnimationFrame(raf)
    }
  }, [onDone, still])

  const stageIndex = STAGES.indexOf(stage)
  const at = (s: Stage) => stageIndex >= STAGES.indexOf(s)
  const ignited = at("ignite")
  const ringsOn = at("rings")
  const coreOn = at("core")
  const locked = at("lock")
  const revealed = at("reveal")
  const warp = at("warp")

  const gridLine = "color-mix(in oklab, var(--primary) 12%, transparent)"
  const gridMask = "radial-gradient(ellipse 60% 55% at 50% 50%, #000 10%, transparent 72%)"

  const glyphStyle = (i: number): CSSProperties => {
    if (warp) {
      // 跃迁：从中间向两侧依次放大、散开并模糊消失
      const fromCenter = Math.abs(i - (WORD.length - 1) / 2)
      const delay = `${Math.round(fromCenter * 30)}ms`
      return {
        opacity: 0,
        transform: `translateX(${(i - (WORD.length - 1) / 2) * 0.35}em) scale(1.7)`,
        filter: "blur(10px)",
        transition: `opacity 420ms ease-in ${delay}, transform 560ms ${WARP} ${delay}, filter 420ms ease-in ${delay}`,
      }
    }
    const delay = `${i * 45}ms`
    return {
      opacity: revealed ? 1 : 0,
      transform: revealed ? "translateY(0)" : "translateY(0.35em)",
      filter: revealed ? "blur(0px)" : "blur(8px)",
      transition: `opacity 320ms ease-out ${delay}, transform 520ms ${EASE} ${delay}, filter 380ms ease-out ${delay}`,
    }
  }

  return (
    <div role="status" className="aii-root relative flex h-full w-full items-center justify-center overflow-hidden">
      <span className="sr-only">AI Mode 正在载入</span>

      {/* HUD 网格：扫描线展开后自中线上下张开，跃迁时随镜头推进放大消散 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(to right, ${gridLine} 1px, transparent 1px), linear-gradient(to bottom, ${gridLine} 1px, transparent 1px)`,
          backgroundSize: "44px 44px",
          backgroundPosition: "center",
          maskImage: gridMask,
          WebkitMaskImage: gridMask,
          clipPath: ignited ? "inset(0% 0% 0% 0%)" : "inset(50% 0% 50% 0%)",
          opacity: warp ? 0 : ignited ? 1 : 0,
          transform: warp ? "scale(1.35)" : "scale(1)",
          transition: warp
            ? `opacity 500ms ease-in, transform 620ms ${WARP}`
            : `clip-path 1000ms ${EASE} 220ms, opacity 400ms ease-out 220ms`,
        }}
      />

      {/* 跃迁闪光 */}
      {warp && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 50% 45%, color-mix(in oklab, var(--primary) 40%, transparent), transparent 60%)",
            animation: "aii-flash 600ms ease-out both",
          }}
        />
      )}

      <div aria-hidden className="relative flex flex-col items-center gap-8 sm:gap-10">
        <div
          className="relative aspect-square"
          style={{
            width: "min(320px, 72vw, 42vh)",
            ...(warp
              ? {
                  transform: "scale(2.3)",
                  opacity: 0,
                  filter: "blur(10px)",
                  transition: `transform 620ms ${WARP}, opacity 480ms ease-in 80ms, filter 480ms ease-in`,
                }
              : { transform: "scale(1)", opacity: 1 }),
          }}
        >
          {/* 点火扫描线：自中心横向展开后上下收束淡出 */}
          {ignited && !still && (
            <span
              className="pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-screen rounded-full"
              style={{
                background:
                  "linear-gradient(to right, transparent, color-mix(in oklab, var(--primary) 85%, transparent) 30%, var(--foreground) 50%, color-mix(in oklab, var(--primary) 85%, transparent) 70%, transparent)",
                boxShadow: "0 0 18px 2px color-mix(in oklab, var(--primary) 55%, transparent)",
                animation: `aii-ignite 1000ms ${EASE} both`,
              }}
            />
          )}

          <ReactorRings on={ringsOn} coreOn={coreOn} still={still} glowId={`${uid}-glow`} />
          {coreOn && <ReactorCore still={still} petalId={`${uid}-petal`} />}
          <LockBrackets visible={ringsOn} locked={locked} warp={warp} />
        </div>

        {/* 字标：乱码逐字解码，等宽字体保证刷新时字宽不抖动 */}
        <div
          className="flex font-mono text-4xl font-semibold uppercase leading-none tracking-[0.3em] sm:text-6xl"
          style={{ paddingLeft: "0.3em" }}
        >
          {WORD.map((ch, i) => (
            <span
              key={i}
              ref={(el) => {
                glyphRefs.current[i] = el
              }}
              className="aii-glyph inline-block"
              style={glyphStyle(i)}
            >
              {ch === " " ? "\u00A0" : ch}
            </span>
          ))}
        </div>

        {/* 链路遥测：同步进度与状态 */}
        <div
          className="flex w-64 flex-col gap-2 font-mono text-sm"
          style={{
            opacity: warp ? 0 : ringsOn ? 1 : 0,
            transform: ringsOn ? "translateY(0)" : "translateY(8px)",
            transition: warp ? "opacity 300ms ease-in" : `opacity 500ms ease-out 200ms, transform 700ms ${EASE} 200ms`,
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className={locked ? "size-1.5 bg-primary" : "aii-blink size-1.5 bg-primary"} />
              <span style={{ color: locked ? "var(--foreground)" : undefined, transition: "color 300ms ease" }}>
                {locked ? "链路已建立" : "正在建立神经链路"}
              </span>
            </span>
            <span className="tabular-nums text-primary">
              <span ref={counterRef}>000</span>%
            </span>
          </div>
          <span
            className="relative block h-px w-full overflow-hidden bg-foreground/10"
            style={{
              boxShadow: locked ? "0 0 10px 0 color-mix(in oklab, var(--primary) 60%, transparent)" : "none",
              transition: "box-shadow 400ms ease",
            }}
          >
            <span
              ref={barRef}
              className="absolute inset-0 block origin-left bg-primary"
              style={{ transform: "scaleX(0)" }}
            />
          </span>
        </div>
      </div>

      <style>{INTRO_CSS}</style>
    </div>
  )
}

/** SVG 原生持续旋转（不走 CSS transform，避免矢量层被栅格化） */
function Spin({
  dur,
  reverse = false,
  still,
  children,
}: {
  dur: number
  reverse?: boolean
  still: boolean
  children: ReactNode
}) {
  return (
    <g>
      {!still && (
        <animateTransform
          attributeName="transform"
          type="rotate"
          from={`0 ${C} ${C}`}
          to={`${reverse ? -360 : 360} ${C} ${C}`}
          dur={`${dur}s`}
          repeatCount="indefinite"
        />
      )}
      {children}
    </g>
  )
}

/** 四层 HUD 环：由内向外交错旋入，每层以不同速度/方向持续旋转 */
function ReactorRings({ on, coreOn, still, glowId }: { on: boolean; coreOn: boolean; still: boolean; glowId: string }) {
  const ringIn = (order: number): CSSProperties => ({
    transformBox: "view-box",
    transformOrigin: "50% 50%",
    opacity: on ? 1 : 0,
    transform: on ? "scale(1) rotate(0deg)" : `scale(0.5) rotate(${order % 2 ? 70 : -70}deg)`,
    transition: `opacity 600ms ease-out ${order * 90}ms, transform 1100ms ${EASE} ${order * 90}ms`,
  })

  const faint = "color-mix(in oklab, var(--foreground) 28%, transparent)"
  const primarySoft = "color-mix(in oklab, var(--primary) 55%, transparent)"
  const innerLen = circ(92)
  const arcLen = circ(112) / 6
  const segmentGap = circ(132) / 3 - 270
  const tickPitch = circ(150) / 120
  const majorPitch = circ(150) / 12

  return (
    <svg
      viewBox="0 0 320 320"
      fill="none"
      aria-hidden
      shapeRendering="geometricPrecision"
      className="absolute inset-0 size-full overflow-visible"
    >
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 核心辉光：点火后浮现并缓慢呼吸 */}
      <g style={{ opacity: coreOn ? 1 : 0, transition: "opacity 900ms ease-out" }}>
        <circle
          cx={C}
          cy={C}
          r={88}
          fill={`url(#${glowId})`}
          className={coreOn && !still ? "aii-breathe" : undefined}
        />
      </g>

      {/* 内环：描边绘制 + 四向准星刻度 + 环绕光点 */}
      <g style={ringIn(0)}>
        <circle
          cx={C}
          cy={C}
          r={92}
          strokeWidth={1}
          transform={`rotate(-90 ${C} ${C})`}
          style={{
            stroke: faint,
            strokeDasharray: `${innerLen}`,
            strokeDashoffset: on ? 0 : innerLen,
            transition: `stroke-dashoffset 1200ms ${EASE}`,
          }}
        />
        {[0, 90, 180, 270].map((deg) => (
          <line
            key={deg}
            x1={C}
            y1={C - 98}
            x2={C}
            y2={C - 106}
            strokeWidth={1.5}
            transform={`rotate(${deg} ${C} ${C})`}
            style={{ stroke: "var(--primary)" }}
          />
        ))}
        <Spin dur={2.8} still={still}>
          <circle cx={C} cy={C - 92} r={2.6} style={{ fill: "var(--primary)" }} />
        </Spin>
      </g>

      {/* 能量弧：三段 60° 主色弧带柔光，快速旋转 */}
      <g style={ringIn(1)}>
        <Spin dur={9} still={still}>
          <circle
            cx={C}
            cy={C}
            r={112}
            strokeWidth={10}
            style={{ stroke: "var(--primary)", opacity: 0.16, strokeDasharray: `${arcLen} ${arcLen}` }}
          />
          <circle
            cx={C}
            cy={C}
            r={112}
            strokeWidth={2.5}
            style={{ stroke: "var(--primary)", strokeDasharray: `${arcLen} ${arcLen}` }}
          />
        </Spin>
      </g>

      {/* 分段环：长短不一的数据段，反向慢转 */}
      <g style={ringIn(2)}>
        <Spin dur={26} reverse still={still}>
          <circle
            cx={C}
            cy={C}
            r={132}
            strokeWidth={1.25}
            style={{ stroke: primarySoft, strokeDasharray: `150 20 60 20 ${segmentGap} 20` }}
          />
        </Spin>
      </g>

      {/* 刻度环：120 细刻度 + 12 主刻度，极慢旋转 */}
      <g style={ringIn(3)}>
        <Spin dur={60} still={still}>
          <circle
            cx={C}
            cy={C}
            r={150}
            strokeWidth={5}
            style={{ stroke: faint, strokeDasharray: `0.8 ${tickPitch - 0.8}` }}
          />
          <circle
            cx={C}
            cy={C}
            r={150}
            strokeWidth={10}
            style={{ stroke: "var(--primary)", strokeDasharray: `1.8 ${majorPitch - 1.8}` }}
          />
        </Spin>
      </g>

      {/* 点火冲击波：两圈错峰外扩 */}
      {coreOn &&
        !still &&
        [0, 180].map((delay) => (
          <circle
            key={delay}
            cx={C}
            cy={C}
            r={40}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            style={{
              stroke: "var(--primary)",
              transformBox: "fill-box",
              transformOrigin: "center",
              animation: `aii-shock 1100ms ${EASE} ${delay}ms both`,
            }}
          />
        ))}
    </svg>
  )
}

/**
 * 中心星辉：点火瞬间亮度爆闪后回落为柔和辉光，主星 SVG 原生旋转入场，光瓣以 clip-path 自中心展开。
 * 单独的 SVG 在 core 阶段才挂载，使 animateTransform 的时间轴从挂载那一刻开始。
 */
function ReactorCore({ still, petalId }: { still: boolean; petalId: string }) {
  return (
    <div
      aria-hidden
      className="absolute"
      style={{ left: "32%", top: "32%", width: "36%", height: "36%", animation: "aii-core-flash 1200ms ease-out both" }}
    >
      <svg viewBox="-1 0 44 44" fill="none" shapeRendering="geometricPrecision" className="block size-full">
        <defs>
          <linearGradient id={petalId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="color-mix(in oklab, var(--primary) 55%, var(--foreground))" />
          </linearGradient>
        </defs>
        <g>
          {!still && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="-360 21 22"
              to="0 21 22"
              dur="1.1s"
              calcMode="spline"
              keyTimes="0;1"
              keySplines="0.3 0.55 0.35 1"
              fill="freeze"
            />
          )}
          <path
            d="M21 3 C22.2 13.5 23.5 17.5 26 22 C23.5 26.5 22.2 30.5 21 41 C19.8 30.5 18.5 26.5 16 22 C18.5 17.5 19.8 13.5 21 3 Z"
            fill={`url(#${petalId})`}
            style={{ animation: `aii-petal-v 700ms ${EASE} both` }}
          />
          <path
            d="M2 22 C12.5 20.8 16.5 19.5 21 17 C25.5 19.5 29.5 20.8 40 22 C29.5 23.2 25.5 24.5 21 27 C16.5 24.5 12.5 23.2 2 22 Z"
            fill={`url(#${petalId})`}
            style={{ animation: `aii-petal-h 700ms ${EASE} 120ms both` }}
          />
        </g>
        <path
          d="M36 5 C36.5 8 37.5 9 40 9.5 C37.5 10 36.5 11 36 14 C35.5 11 34.5 10 32 9.5 C34.5 9 35.5 8 36 5 Z"
          style={{
            fill: "var(--foreground)",
            transformBox: "fill-box",
            transformOrigin: "center",
            animation: `aii-pop 460ms ${BOUNCE} 850ms both`,
          }}
        />
      </svg>
    </div>
  )
}

const CORNERS = [
  { className: "left-0 top-0 border-l-2 border-t-2", dx: -1, dy: -1 },
  { className: "right-0 top-0 border-r-2 border-t-2", dx: 1, dy: -1 },
  { className: "bottom-0 left-0 border-b-2 border-l-2", dx: -1, dy: 1 },
  { className: "bottom-0 right-0 border-b-2 border-r-2", dx: 1, dy: 1 },
] as const

/** 瞄准框：四角飞入收拢，进度满格时回弹锁定并闪烁，跃迁时向外飞散 */
function LockBrackets({ visible, locked, warp }: { visible: boolean; locked: boolean; warp: boolean }) {
  const cornerStyle = (dx: number, dy: number): CSSProperties => {
    if (warp) {
      return {
        opacity: 0,
        transform: `translate(${dx * 96}px, ${dy * 96}px)`,
        transition: `transform 560ms ${WARP}, opacity 380ms ease-in`,
      }
    }
    if (locked) {
      return {
        opacity: 1,
        transform: `translate(${-dx * 6}px, ${-dy * 6}px)`,
        transition: `transform 420ms ${BOUNCE}`,
        animation: "aii-lock-blink 520ms steps(1, end) both",
      }
    }
    return {
      opacity: visible ? 0.85 : 0,
      transform: visible ? "translate(0, 0)" : `translate(${dx * 32}px, ${dy * 32}px)`,
      transition: `opacity 500ms ease-out 260ms, transform 900ms ${EASE} 260ms`,
    }
  }

  return (
    <div aria-hidden className="pointer-events-none absolute -inset-6">
      {CORNERS.map((c) => (
        <span key={c.className} className={`absolute size-5 border-primary ${c.className}`} style={cornerStyle(c.dx, c.dy)} />
      ))}
    </div>
  )
}

const INTRO_CSS = `
@keyframes aii-ignite {
  0% { transform: translate(-50%, -50%) scale(0, 1); opacity: 0; }
  12% { opacity: 1; }
  45% { transform: translate(-50%, -50%) scale(1, 1); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1, 0.3); opacity: 0; }
}
@keyframes aii-shock {
  0% { transform: scale(0.5); opacity: 0.95; }
  100% { transform: scale(4); opacity: 0; }
}
@keyframes aii-core-flash {
  0% { filter: brightness(2.4) drop-shadow(0 0 22px var(--primary)); }
  100% { filter: brightness(1) drop-shadow(0 0 8px color-mix(in oklab, var(--primary) 45%, transparent)); }
}
@keyframes aii-petal-v {
  from { clip-path: inset(50% 0% 50% 0%); }
  to { clip-path: inset(0% 0% 0% 0%); }
}
@keyframes aii-petal-h {
  from { clip-path: inset(0% 50% 0% 50%); }
  to { clip-path: inset(0% 0% 0% 0%); }
}
@keyframes aii-pop {
  0% { transform: scale(0) rotate(-180deg); }
  70% { transform: scale(1.3) rotate(10deg); }
  100% { transform: scale(1) rotate(0deg); }
}
@keyframes aii-breathe {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
@keyframes aii-flash {
  0% { opacity: 0; }
  22% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes aii-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.15; }
}
@keyframes aii-lock-blink {
  0% { opacity: 1; }
  20% { opacity: 0.2; }
  40% { opacity: 1; }
  60% { opacity: 0.3; }
  80%, 100% { opacity: 1; }
}
@keyframes aii-resolve {
  0% {
    text-shadow: -0.08em 0 0 var(--primary), 0.08em 0 0 color-mix(in oklab, var(--foreground) 55%, transparent), 0 0 28px var(--primary);
  }
  35% {
    text-shadow: 0.04em 0 0 var(--primary), -0.04em 0 0 color-mix(in oklab, var(--foreground) 45%, transparent), 0 0 18px color-mix(in oklab, var(--primary) 60%, transparent);
  }
  100% {
    text-shadow: 0 0 0 transparent, 0 0 0 transparent, 0 0 0 transparent;
  }
}
.aii-breathe { animation: aii-breathe 2.6s ease-in-out infinite; }
.aii-blink { animation: aii-blink 700ms steps(1, end) infinite; }
.aii-glyph {
  color: var(--primary);
  text-shadow: 0 0 18px color-mix(in oklab, var(--primary) 70%, transparent);
}
.aii-glyph[data-resolved="1"] {
  color: var(--foreground);
  text-shadow: none;
  animation: aii-resolve 700ms ease-out both;
}
@media (prefers-reduced-motion: reduce) {
  .aii-root,
  .aii-root * {
    animation-duration: 1ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    transition-delay: 0ms !important;
  }
}
`
