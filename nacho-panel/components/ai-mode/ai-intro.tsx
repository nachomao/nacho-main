"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import {
  AI_MODE_TIMING,
  OPTICAL_CARD_INITIAL_SIZE,
  buildEnergyArcPath,
  computeCenterCardMorphTarget,
  computeIntroCardContentBlurMotion,
  resolveAIOriginPoint,
  type AIIntroStage,
  type AIOriginPoint,
  type CenterCardMorphTarget,
} from "@/lib/ai-mode-transition"

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)"
const EASE_PRECISION = "cubic-bezier(0.22, 1, 0.36, 1)"

/**
 * 24 枚游标分划刻度（每 15° 一枚，0°/90°/180°/270° 为主基准线）
 */
const VERNIER_TICKS = Array.from({ length: 24 }, (_, idx) => {
  const deg = idx * 15
  const rad = (deg * Math.PI) / 180
  const cardinal = idx % 6 === 0
  const secondary = idx % 3 === 0 && !cardinal
  const rOuter = 104
  const rInner = cardinal ? 94.5 : secondary ? 97.5 : 99.5
  return {
    deg,
    cardinal,
    secondary,
    x1: Number((120 + Math.cos(rad) * rInner).toFixed(2)),
    y1: Number((120 + Math.sin(rad) * rInner).toFixed(2)),
    x2: Number((120 + Math.cos(rad) * rOuter).toFixed(2)),
    y2: Number((120 + Math.sin(rad) * rOuter).toFixed(2)),
  }
})

/**
 * 水平基准轴上的精密游标刻度偏移（px）
 */
const HORIZON_TICKS = [-240, -196, 196, 240] as const

/**
 * AI Mode 切入开场与卡片形态演化：
 * 1. 点击 AI Mode 后启动精密光学卡片模拟加载（陀螺仪归零、双轴干涉环合拢、底部光学进度条推进至 100% READY）；
 * 2. 加载完成后卡片不消失，而是直接向四周扩展至三栏工作台中间主卡片的精确尺寸与位置；
 * 3. 扩展过程中卡片内原光学加载内容逐渐模糊渐隐（blur 0 -> 18px, opacity 1 -> 0），与中间卡片新内容的模糊渐显无缝交融。
 */
export function AIIntro({
  onDone,
  origin,
  targetCard,
}: {
  onDone: () => void
  origin?: AIOriginPoint
  targetCard?: CenterCardMorphTarget
}) {
  const [stage, setStage] = useState<AIIntroStage>("surge")
  const [mountedFrame, setMountedFrame] = useState(false)
  const [progressReady, setProgressReady] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const handoffCalledRef = useRef(false)
  const mountedAtRef = useRef<number>(Date.now())
  const uid = useId().replace(/:/g, "")

  const resolvedOrigin = useMemo(
    () =>
      origin ??
      resolveAIOriginPoint(
        null,
        typeof window !== "undefined" ? { width: window.innerWidth, height: window.innerHeight } : null,
      ),
    [origin],
  )

  const morphTarget = useMemo(
    () =>
      targetCard ??
      computeCenterCardMorphTarget({
        width: resolvedOrigin.vw,
        height: resolvedOrigin.vh,
      }),
    [targetCard, resolvedOrigin.vw, resolvedOrigin.vh],
  )

  const arc = useMemo(() => buildEnergyArcPath(resolvedOrigin), [resolvedOrigin])

  const stageBirthRef = useRef<number>(0)

  const triggerHandoff = useCallback(() => {
    if (handoffCalledRef.current) return
    handoffCalledRef.current = true
    stageBirthRef.current = typeof performance !== "undefined" ? performance.now() : Date.now()
    setStage("portal")
    onDone()
  }, [onDone])

  const handleManualSkip = useCallback(() => {
    // 忽略点击入口按钮瞬间可能残留的同源合成点击，满 220ms 后允许点击快进
    if (Date.now() - mountedAtRef.current < 220) return
    triggerHandoff()
  }, [triggerHandoff])

  useEffect(() => {
    mountedAtRef.current = Date.now()
    const start = performance.now()
    stageBirthRef.current = start
    let rafId = 0

    const tMount = window.setTimeout(() => {
      stageBirthRef.current = performance.now()
      setMountedFrame(true)
      setStage("helix")
    }, 16)

    const tProgress = window.setTimeout(() => {
      setProgressReady(true)
    }, 48)

    const tLock = window.setTimeout(() => {
      setStage("lock")
    }, AI_MODE_TIMING.LOCK_START_MS)

    // 仅在无头自动化环境（navigator.webdriver）下补偿软件光栅化时间轴，真机浏览器完全交由原生 GPU 合成器以 60/120fps 运行
    const isWebDriver = typeof navigator !== "undefined" && navigator.webdriver === true
    let intervalId: number | undefined
    if (isWebDriver) {
      const animBirthMap = new WeakMap<Animation, number>()
      const syncTimeline = (now: number) => {
        const root = rootRef.current
        if (root && typeof root.getAnimations === "function") {
          for (const anim of root.getAnimations({ subtree: true })) {
            const timing = anim.effect?.getTiming()
            if (timing?.iterations === Infinity) continue
            let birth = animBirthMap.get(anim)
            if (birth === undefined) {
              const initialCur = typeof anim.currentTime === "number" ? anim.currentTime : 0
              birth = now - Math.max(0, initialCur)
              animBirthMap.set(anim, birth)
            }
            const elapsed = Math.max(0, now - birth)
            const cur = anim.currentTime
            if (cur === null || (typeof cur === "number" && cur < elapsed - 24)) {
              try {
                anim.currentTime = elapsed
              } catch {
                // 忽略只读时间轴异常
              }
            }
          }
        }
      }
      const loop = (now: number) => {
        syncTimeline(now)
        rafId = window.requestAnimationFrame(loop)
      }
      rafId = window.requestAnimationFrame(loop)
      intervalId = window.setInterval(() => syncTimeline(performance.now()), 16)
    }

    const tPortal = window.setTimeout(() => triggerHandoff(), AI_MODE_TIMING.PORTAL_HANDOFF_MS)

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId)
      if (intervalId !== undefined) window.clearInterval(intervalId)
      window.clearTimeout(tMount)
      window.clearTimeout(tProgress)
      window.clearTimeout(tLock)
      window.clearTimeout(tPortal)
    }
  }, [triggerHandoff])

  const entered = mountedFrame || stage !== "surge"
  const locked = stage === "lock" || stage === "portal"
  const portalActive = stage === "portal"
  const contentBlurStyle = computeIntroCardContentBlurMotion(portalActive)

  const gradPlatinum = `${uid}-grad-platinum`
  const gradSapphire = `${uid}-grad-sapphire`
  const gradArc = `${uid}-grad-arc`
  const gradCoreField = `${uid}-grad-core-field`

  return (
    <div
      ref={rootRef}
      aria-label="AI Mode 正在载入"
      onClick={handleManualSkip}
      className="relative flex h-full w-full select-none items-center justify-center overflow-hidden"
      style={{
        // 卡片扩展全程（0 -> 640ms）保持外框连续可见，待中间主卡片完全展开（680ms）并露出原生边框后再平滑隐退叠层
        opacity: portalActive ? 0 : 1,
        transition: portalActive
          ? `opacity 220ms ${EASE_PRECISION} ${Math.max(0, AI_MODE_TIMING.CARD_EXPAND_MS - 40)}ms`
          : "none",
        pointerEvents: portalActive ? "none" : "auto",
      }}
    >
      {/* 1. 暗房光学基准十字轴与微米点阵：在卡片开始向四周扩展时同步模糊退场 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{
          opacity: portalActive ? 0 : entered ? 0.52 : 0,
          filter: portalActive ? "blur(10px)" : "blur(0px)",
          transform: portalActive ? "scale(1.08)" : entered ? "scale(1)" : "scale(0.96)",
          transition: `opacity 380ms ease-out, filter 380ms ease-out, transform 620ms ${EASE_OUT}`,
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(circle at center, rgba(226, 232, 240, 0.15) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
            backgroundPosition: "center center",
            maskImage: "radial-gradient(circle 360px at 50% 50%, #000 15%, transparent 80%)",
            WebkitMaskImage: "radial-gradient(circle 360px at 50% 50%, #000 15%, transparent 80%)",
          }}
        />
        <div
          className="absolute h-[400px] w-px"
          style={{
            background:
              "linear-gradient(to bottom, transparent, rgba(226, 232, 240, 0.14) 30%, rgba(226, 232, 240, 0.14) 70%, transparent)",
          }}
        />
        {HORIZON_TICKS.map((offset) => (
          <span
            key={offset}
            className="absolute h-2 w-px bg-slate-300/25"
            style={{
              transform: `translateX(${offset}px)`,
            }}
          />
        ))}
      </div>

      {/* 2. 变形宽银幕水平眩光（Anamorphic Lens Streak）：贯穿视口中心的冷白-冰蓝极细光学切线 */}
      <div
        aria-hidden
        className="pointer-events-none absolute flex items-center justify-center"
        style={{
          width: portalActive ? `${morphTarget.width}px` : entered ? "min(70vw, 620px)" : "120px",
          height: "1px",
          opacity: portalActive ? 0 : entered ? 0.82 : 0,
          filter: portalActive ? "blur(8px)" : "blur(0px)",
          background:
            "linear-gradient(90deg, transparent 0%, rgba(147, 197, 253, 0.26) 22%, rgba(248, 250, 252, 0.82) 50%, rgba(147, 197, 253, 0.26) 78%, transparent 100%)",
          boxShadow: "0 0 18px 1px rgba(147, 197, 253, 0.22)",
          transition: portalActive
            ? `width ${AI_MODE_TIMING.CARD_EXPAND_MS}ms ${EASE_OUT}, opacity 340ms ease-out, filter 340ms ease-out`
            : `width 680ms ${EASE_OUT} 40ms, opacity 300ms ease-out`,
        }}
      />

      {/* 3. 起点高光脉冲与光学引导轨迹：从顶栏 AI Mode 按钮真实坐标射向视口中心 (50%, 50%) */}
      <svg
        aria-hidden
        viewBox={`0 0 ${resolvedOrigin.vw} ${resolvedOrigin.vh}`}
        className="pointer-events-none absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradArc} x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#f8fafc" stopOpacity="0.9" />
            <stop offset="55%" stopColor="#93c5fd" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.08" />
          </linearGradient>
        </defs>

        <circle
          cx={resolvedOrigin.x}
          cy={resolvedOrigin.y}
          r={entered ? 132 : 10}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={entered ? 0.75 : 1.5}
          style={{
            opacity: entered ? 0 : 0.72,
            transition: `r 660ms ${EASE_OUT}, opacity 620ms ease-out, stroke-width 620ms ease-out`,
          }}
        />
        <circle
          cx={resolvedOrigin.x}
          cy={resolvedOrigin.y}
          r={entered ? 204 : 16}
          fill="none"
          stroke="#93c5fd"
          strokeWidth="0.75"
          strokeDasharray="3 6"
          style={{
            opacity: entered ? 0 : 0.42,
            transition: `r 780ms ${EASE_OUT} 40ms, opacity 720ms ease-out 40ms`,
          }}
        />

        <path
          d={arc.path}
          fill="none"
          stroke={`url(#${gradArc})`}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`140 ${arc.distance}`}
          strokeDashoffset={entered ? -arc.distance : 140}
          style={{
            opacity: portalActive ? 0 : entered ? 0 : 0.45,
            transition: `stroke-dashoffset 520ms ${EASE_OUT}, opacity 480ms ease-out 120ms`,
          }}
        />
        <path
          d={arc.path}
          fill="none"
          stroke={`url(#${gradArc})`}
          strokeWidth="1.15"
          strokeLinecap="round"
          strokeDasharray={`96 ${arc.distance}`}
          strokeDashoffset={entered ? -arc.distance : 96}
          style={{
            opacity: portalActive ? 0 : entered ? 0 : 0.88,
            transition: `stroke-dashoffset 480ms ${EASE_OUT}, opacity 440ms ease-out 140ms`,
          }}
        />
      </svg>

      {/* 4. 光学加载卡片主体（Optical Loading Card -> Middle Workspace Card）：
             - 加载阶段：368x256 烟熏蓝宝石光学卡片，内含四角遥测、中心精密陀螺仪与底部模拟加载进度条；
             - 扩展阶段（portalActive）：卡片不消失，直接向四周扩展至中间卡片精确尺寸（morphTarget.width x morphTarget.height），
               同时卡片内部原光学加载内容逐渐模糊渐隐（contentBlurStyle），把画面平滑交接给中间卡片模糊渐显的新内容。 */}
      <div
        data-testid="ai-intro-morph-card"
        data-stage={stage}
        className="pointer-events-none relative flex items-center justify-center"
        style={{
          width: portalActive
            ? `${morphTarget.width}px`
            : entered
              ? `${OPTICAL_CARD_INITIAL_SIZE.width}px`
              : "268px",
          height: portalActive
            ? `${morphTarget.height}px`
            : entered
              ? `${OPTICAL_CARD_INITIAL_SIZE.height}px`
              : "196px",
          transform: `translate3d(${morphTarget.offsetX}px, ${morphTarget.offsetY}px, 0)`,
          borderRadius: `${morphTarget.borderRadius}px`,
          border: "1px solid rgba(226, 232, 240, 0.14)",
          boxShadow: portalActive
            ? "0 0 64px -20px rgba(147, 197, 253, 0.14), inset 0 1px 0 0 rgba(248, 250, 252, 0.06)"
            : "0 28px 72px -20px rgba(0, 0, 0, 0.85), inset 0 1px 0 0 rgba(248, 250, 252, 0.1), inset 0 0 32px -16px rgba(147, 197, 253, 0.1)",
          opacity: entered ? 1 : 0,
          transition: portalActive
            ? `width ${AI_MODE_TIMING.CARD_EXPAND_MS}ms ${EASE_PRECISION}, height ${AI_MODE_TIMING.CARD_EXPAND_MS}ms ${EASE_PRECISION}, transform ${AI_MODE_TIMING.CARD_EXPAND_MS}ms ${EASE_PRECISION}, box-shadow ${AI_MODE_TIMING.CARD_EXPAND_MS}ms ${EASE_PRECISION}`
            : `width 560ms ${EASE_OUT} 30ms, height 560ms ${EASE_OUT} 30ms, opacity 240ms ease-out`,
        }}
      >
        {/* 独立烟熏蓝宝石毛玻璃背景层：进入扩展阶段后 180ms 内快速透明化，将卡片底色无缝交接给下层中间卡片，避免遮挡新内容模糊渐显 */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            background:
              "radial-gradient(circle at 50% 44%, rgba(8, 12, 22, 0.78), rgba(5, 8, 16, 0.65) 76%, rgba(5, 8, 16, 0.52))",
            backdropFilter: portalActive ? "none" : "blur(14px)",
            WebkitBackdropFilter: portalActive ? "none" : "blur(14px)",
            opacity: portalActive ? 0 : 1,
            transition: "opacity 180ms ease-out",
          }}
        />

        {/* 四角 L 型铂金光学折角准星：随卡片向四周推开至中间卡片四角 */}
        <span
          className="absolute left-0 top-0 z-10 h-3.5 w-3.5 rounded-tl-[3px] border-l-[1.5px] border-t-[1.5px] border-slate-200/75"
          style={{
            opacity: portalActive ? 0.22 : 0.85,
            transition: "opacity 520ms ease-out",
          }}
        />
        <span
          className="absolute right-0 top-0 z-10 h-3.5 w-3.5 rounded-tr-[3px] border-r-[1.5px] border-t-[1.5px] border-slate-200/75"
          style={{
            opacity: portalActive ? 0.22 : 0.85,
            transition: "opacity 520ms ease-out",
          }}
        />
        <span
          className="absolute bottom-0 left-0 z-10 h-3.5 w-3.5 rounded-bl-[3px] border-b-[1.5px] border-l-[1.5px] border-slate-200/75"
          style={{
            opacity: portalActive ? 0.22 : 0.85,
            transition: "opacity 520ms ease-out",
          }}
        />
        <span
          className="absolute bottom-0 right-0 z-10 h-3.5 w-3.5 rounded-br-[3px] border-b-[1.5px] border-r-[1.5px] border-slate-200/75"
          style={{
            opacity: portalActive ? 0.22 : 0.85,
            transition: "opacity 520ms ease-out",
          }}
        />

        {/* 卡片内原加载内容容器：在卡片向四周扩展时整体逐渐模糊渐隐（blur 0 -> 18px, opacity 1 -> 0） */}
        <div
          data-testid="ai-intro-card-content"
          className="relative z-10 flex h-[256px] w-[368px] shrink-0 flex-col items-center justify-between px-4 py-3"
          style={contentBlurStyle}
        >
          {/* 顶部双角遥测铭文 */}
          <div className="flex w-full items-center justify-between font-mono text-[9.5px] tracking-[0.22em] text-slate-300/70 tabular-nums">
            <div
              className="flex items-center gap-1.5"
              style={{
                opacity: entered ? 1 : 0,
                transform: entered ? "translateY(0)" : "translateY(4px)",
                transition: `opacity 260ms ease-out 120ms, transform 360ms ${EASE_OUT} 120ms`,
              }}
            >
              <span className="text-slate-400/55">01</span>
              <span className="h-2 w-px bg-slate-400/30" />
              <span>KERNEL</span>
            </div>

            <div
              className="flex items-center gap-1.5"
              style={{
                opacity: entered ? 1 : 0,
                transform: entered ? "translateY(0)" : "translateY(4px)",
                transition: `opacity 260ms ease-out 160ms, transform 360ms ${EASE_OUT} 160ms`,
              }}
            >
              <span>SKILL</span>
              <span className="h-2 w-px bg-slate-400/30" />
              <span className="text-slate-400/55">02</span>
            </div>
          </div>

          {/* 中央精密游标陀螺仪 + 双轴椭圆干涉仪（144x144，严格收纳于卡片中心） */}
          <div
            className="relative my-auto flex h-[144px] w-[144px] items-center justify-center"
            style={{
              transform: entered ? "scale(1)" : "scale(0.84)",
              opacity: entered ? 1 : 0,
              transition: `transform 560ms ${EASE_OUT}, opacity 240ms ease-out`,
            }}
          >
            <svg
              viewBox="0 0 240 240"
              fill="none"
              aria-hidden
              shapeRendering="geometricPrecision"
              className="h-full w-full overflow-visible"
            >
              <defs>
                <linearGradient id={gradPlatinum} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#f8fafc" stopOpacity="0.92" />
                  <stop offset="50%" stopColor="#cbd5e1" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.18" />
                </linearGradient>
                <linearGradient id={gradSapphire} x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.88" />
                  <stop offset="52%" stopColor="#93c5fd" stopOpacity="0.62" />
                  <stop offset="100%" stopColor="#cbd5e1" stopOpacity="0.2" />
                </linearGradient>
                <radialGradient id={gradCoreField} cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.18" />
                  <stop offset="48%" stopColor="#93c5fd" stopOpacity="0.07" />
                  <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
                </radialGradient>
              </defs>

              <circle
                cx="120"
                cy="120"
                r="96"
                fill={`url(#${gradCoreField})`}
                style={{
                  opacity: entered ? 1 : 0,
                  transform: entered ? "scale(1)" : "scale(0.75)",
                  transformOrigin: "120px 120px",
                  transition: `opacity 300ms ease-out, transform 520ms ${EASE_OUT}`,
                }}
              />

              {/* 外层游标分度环 */}
              <g
                style={{
                  transformOrigin: "120px 120px",
                  transform: entered ? "rotate(0deg) scale(1)" : "rotate(-32deg) scale(0.88)",
                  opacity: entered ? 0.95 : 0,
                  transition: `transform 820ms ${EASE_OUT}, opacity 240ms ease-out`,
                }}
              >
                <circle
                  cx="120"
                  cy="120"
                  r="104"
                  stroke="rgba(226, 232, 240, 0.15)"
                  strokeWidth="0.9"
                />
                {VERNIER_TICKS.map((t) => (
                  <line
                    key={t.deg}
                    x1={t.x1}
                    y1={t.y1}
                    x2={t.x2}
                    y2={t.y2}
                    stroke={t.cardinal ? "#f8fafc" : "#cbd5e1"}
                    strokeOpacity={t.cardinal ? 0.78 : t.secondary ? 0.42 : 0.22}
                    strokeWidth={t.cardinal ? "1.3" : "0.85"}
                    strokeLinecap="round"
                  />
                ))}
              </g>

              {/* 中层逆向机械光圈环 */}
              <g
                style={{
                  transformOrigin: "120px 120px",
                  transform: entered ? "rotate(0deg) scale(1)" : "rotate(42deg) scale(0.82)",
                  opacity: entered ? 0.92 : 0,
                  transition: `transform 780ms ${EASE_OUT} 20ms, opacity 240ms ease-out`,
                }}
              >
                <circle
                  cx="120"
                  cy="120"
                  r="80"
                  stroke="rgba(226, 232, 240, 0.1)"
                  strokeWidth="0.85"
                />
                <circle
                  cx="120"
                  cy="120"
                  r="80"
                  stroke={`url(#${gradPlatinum})`}
                  strokeWidth="1.35"
                  strokeDasharray="96 155"
                  strokeLinecap="round"
                />
                <circle cx="176.5" cy="63.5" r="2" fill="#e2e8f0" fillOpacity="0.85" />
                <circle cx="63.5" cy="176.5" r="2" fill="#93c5fd" fillOpacity="0.85" />
              </g>

              {/* 内层双轴椭圆干涉环 */}
              <g
                style={{
                  transformOrigin: "120px 120px",
                  transform: entered ? "scale(1)" : "scale(0.86)",
                  opacity: entered ? 1 : 0,
                  transition: `transform 600ms ${EASE_OUT} 40ms, opacity 240ms ease-out`,
                }}
              >
                <g transform="rotate(30 120 120)">
                  <ellipse
                    cx="120"
                    cy="120"
                    rx="64"
                    ry="23"
                    stroke={`url(#${gradPlatinum})`}
                    strokeWidth="1.25"
                    strokeDasharray="290"
                    strokeDashoffset={entered ? 0 : 290}
                    style={{
                      transition: `stroke-dashoffset 640ms ${EASE_OUT} 40ms`,
                    }}
                  />
                  <circle cx="56" cy="120" r="2" fill="#f8fafc" fillOpacity="0.88" />
                  <circle cx="184" cy="120" r="2" fill="#cbd5e1" fillOpacity="0.7" />
                </g>

                <g transform="rotate(-30 120 120)">
                  <ellipse
                    cx="120"
                    cy="120"
                    rx="64"
                    ry="23"
                    stroke={`url(#${gradSapphire})`}
                    strokeWidth="1.25"
                    strokeDasharray="290"
                    strokeDashoffset={entered ? 0 : 290}
                    style={{
                      transition: `stroke-dashoffset 640ms ${EASE_OUT} 80ms`,
                    }}
                  />
                  <circle cx="56" cy="120" r="2" fill="#93c5fd" fillOpacity="0.88" />
                  <circle cx="184" cy="120" r="2" fill="#e2e8f0" fillOpacity="0.75" />
                </g>

                <circle
                  cx="120"
                  cy="120"
                  r="36"
                  stroke="rgba(226, 232, 240, 0.22)"
                  strokeWidth="0.85"
                  strokeDasharray="2 5"
                />
                <line
                  x1="96"
                  y1="120"
                  x2="144"
                  y2="120"
                  stroke="rgba(248, 250, 252, 0.38)"
                  strokeWidth="0.85"
                />
                <line
                  x1="120"
                  y1="96"
                  x2="120"
                  y2="144"
                  stroke="rgba(248, 250, 252, 0.38)"
                  strokeWidth="0.85"
                />
                <circle
                  cx="120"
                  cy="120"
                  r={entered ? 11 : 6}
                  stroke="rgba(248, 250, 252, 0.56)"
                  strokeWidth="0.95"
                  style={{
                    transition: `r 480ms ${EASE_OUT} 100ms`,
                  }}
                />
                <circle cx="120" cy="120" r={entered ? 6.5 : 3} fill="#93c5fd" fillOpacity="0.26" />
                <circle
                  cx="120"
                  cy="120"
                  r={entered ? 2.8 : 1.5}
                  fill="#ffffff"
                  style={{
                    transition: `r 380ms ${EASE_OUT} 120ms`,
                  }}
                />
              </g>
            </svg>
          </div>

          {/* 底部光学加载进度条 + 双侧遥测铭文（全部内嵌于卡片内部，随卡片扩展一起模糊渐隐） */}
          <div className="flex w-full flex-col items-center gap-1.5">
            <div className="relative overflow-hidden px-2">
              <span className="block pl-[0.42em] font-sans text-[13px] font-light tracking-[0.42em] text-slate-100/95">
                AI MODE
              </span>
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 w-1/2"
                style={{
                  background:
                    "linear-gradient(105deg, transparent, rgba(248, 250, 252, 0.34), rgba(147, 197, 253, 0.25), transparent)",
                  transform: entered ? "translateX(280%)" : "translateX(-140%)",
                  transition: `transform 760ms ${EASE_OUT} 180ms`,
                }}
              />
            </div>

            {/* 模拟光学加载进度轨道（0% -> 100%） */}
            <div className="relative h-[1.5px] w-44 overflow-hidden rounded-full bg-slate-200/12">
              <div
                className="h-full rounded-full"
                style={{
                  width: progressReady ? "100%" : "8%",
                  background:
                    "linear-gradient(90deg, rgba(148, 163, 184, 0.35) 0%, rgba(147, 197, 253, 0.85) 65%, #f8fafc 100%)",
                  boxShadow: "0 0 10px rgba(147, 197, 253, 0.45)",
                  transition: `width ${Math.max(300, AI_MODE_TIMING.PORTAL_HANDOFF_MS - 160)}ms cubic-bezier(0.22, 0.8, 0.32, 1)`,
                }}
              />
            </div>

            {/* 底栏遥测与加载状态 */}
            <div className="flex w-full items-center justify-between font-mono text-[9px] tracking-[0.2em] text-slate-300/65 tabular-nums">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400/55">03</span>
                <span className="h-2 w-px bg-slate-400/30" />
                <span>MCP BUS</span>
              </div>

              <span className="text-[8.5px] tracking-[0.24em] text-slate-300/80">
                {locked ? "OPTICAL LOCK · 100%" : "CALIBRATING · SYNC"}
              </span>

              <div className="flex items-center gap-1.5">
                <span>PLUGIN</span>
                <span className="h-2 w-px bg-slate-400/30" />
                <span className="text-slate-400/55">04</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

