"use client"

import { useEffect, useId, useRef, useState, type CSSProperties } from "react"

/**
 * 时间轴（毫秒，相对挂载时刻）。组件在暗幕铺垫（dimming，约 900ms）开始时即挂载，
 * 粒子场在画面变暗的过程中浮现并开始汇聚，不留黑屏空场。
 */
const T = {
  fieldIn: 650,
  converge: 250,
  form: 1850,
  collapse: 2250,
  burst: 2470,
  end: 3250,
} as const
/** 爆发后稍候即交给工作台入场，拖尾与工作台浮现重叠 */
const DONE_AT = T.burst + 120
const STILL_DONE_AT = 1100

const TRAIL_MS = 55
const BURST_TRAIL_MS = 90
const BURST_FADE_MS = 760
const BURST_ACCEL = 0.0035
const COLLAPSE_TWIST = 0.7

/** 环绕星辉的吸积盘：圆盘压扁比例与倾角 */
const RING_FLAT = 0.3
const RING_TILT = -0.32
const COS_TILT = Math.cos(RING_TILT)
const SIN_TILT = Math.sin(RING_TILT)

const TAU = Math.PI * 2
const STAR = 0
const RING = 1

/** 粒子按「颜色 × 尺寸」分 6 桶，每桶一次 stroke，避免逐粒子切换画笔状态 */
const SIZE_WIDTH = [0.8, 1.3, 2] as const
const SIZE_ALPHA = [0.5, 0.75, 0.95] as const

/** 星辉图形（viewBox -1 0 44 44，主星中心 21,22）：竖瓣、横瓣、右上伴星 */
const STAR_VIEWBOX = 44
const STAR_CX = 21
const STAR_CY = 22
const STAR_PATHS = [
  "M21 3 C22.2 13.5 23.5 17.5 26 22 C23.5 26.5 22.2 30.5 21 41 C19.8 30.5 18.5 26.5 16 22 C18.5 17.5 19.8 13.5 21 3 Z",
  "M2 22 C12.5 20.8 16.5 19.5 21 17 C25.5 19.5 29.5 20.8 40 22 C29.5 23.2 25.5 24.5 21 27 C16.5 24.5 12.5 23.2 2 22 Z",
  "M36 5 C36.5 8 37.5 9 40 9.5 C37.5 10 36.5 11 36 14 C35.5 11 34.5 10 32 9.5 C34.5 9 35.5 8 36 5 Z",
] as const

const STAR_SIZE_CSS = "min(200px, max(120px, 26vmin))"
const starSizeFor = (w: number, h: number) => Math.round(Math.min(200, Math.max(120, Math.min(w, h) * 0.26)))

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)
const mod = (v: number, m: number) => ((v % m) + m) % m

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

type Field = {
  kind: Uint8Array
  a0: Float32Array
  r0: Float32Array
  tr: Float32Array
  sweep: Float32Array
  omega: Float32Array
  start: Float32Array
  dur: Float32Array
  phase: Float32Array
  burstAngle: Float32Array
  burstSpeed: Float32Array
  burstDelay: Float32Array
  buckets: number[][]
}

/** 在星辉图形内部均匀取点（拒绝采样），返回相对星心的像素偏移 */
function sampleStar(count: number, starSize: number) {
  const out = new Float32Array(count * 2)
  const ctx = document.createElement("canvas").getContext("2d")
  const paths = STAR_PATHS.map((d) => new Path2D(d))
  const scale = starSize / STAR_VIEWBOX
  for (let i = 0, guard = 0; i < count && guard < count * 60; guard++) {
    const vx = 2 + Math.random() * 38
    const vy = 3 + Math.random() * 38
    if (ctx && !paths.some((p) => ctx.isPointInPath(p, vx, vy))) continue
    out[i * 2] = (vx - STAR_CX) * scale
    out[i * 2 + 1] = (vy - STAR_CY) * scale
    i++
  }
  return out
}

/**
 * 粒子场：约一半粒子汇入星辉图形，其余落入倾斜的吸积盘并持续公转。
 * 运动在极坐标下插值（半径与角度用不同缓动），天然形成向内收紧的旋涡轨迹；
 * 吸积盘粒子在「盘面局部坐标」中插值后再投影，汇聚路径会被逐渐压进盘面。
 */
function buildField(w: number, h: number, starSize: number): Field {
  const n = Math.round(Math.min(1500, Math.max(700, (w * h) / 1100)))
  const starCount = Math.round(n * 0.56)
  const targets = sampleStar(starCount, starSize)
  const f32 = () => new Float32Array(n)
  const field: Field = {
    kind: new Uint8Array(n),
    a0: f32(),
    r0: f32(),
    tr: f32(),
    sweep: f32(),
    omega: f32(),
    start: f32(),
    dur: f32(),
    phase: f32(),
    burstAngle: f32(),
    burstSpeed: f32(),
    burstDelay: f32(),
    buckets: Array.from({ length: 6 }, () => []),
  }

  const ringInner = starSize * 0.62
  const ringSpan = starSize * 0.6
  const starReach = starSize * 0.45
  // 爆发时最快的粒子在拖尾散尽前恰好飞出屏幕对角
  const burstMax = (0.82 * Math.hypot(w, h)) / (BURST_FADE_MS * (1 + 0.5 * BURST_ACCEL * BURST_FADE_MS))
  const cosInv = Math.cos(-RING_TILT)
  const sinInv = Math.sin(-RING_TILT)

  for (let i = 0; i < n; i++) {
    const sx = (Math.random() - 0.5) * w * 1.1
    const sy = (Math.random() - 0.5) * h * 1.1
    const onStar = i < starCount
    let ux = sx
    let uy = sy
    let tx: number
    let ty: number
    if (onStar) {
      tx = targets[i * 2]
      ty = targets[i * 2 + 1]
    } else {
      // 起点换算到盘面局部坐标：逆旋转后反压扁
      ux = sx * cosInv - sy * sinInv
      uy = (sx * sinInv + sy * cosInv) / RING_FLAT
      const angle = Math.random() * TAU
      const radius = ringInner + ringSpan * Math.random() ** 1.7
      tx = radius * Math.cos(angle)
      ty = radius * Math.sin(angle)
    }

    const a0 = Math.atan2(uy, ux)
    const ta = Math.atan2(ty, tx)
    const tr = Math.hypot(tx, ty)
    const sweep = mod(ta - a0, TAU) + Math.PI * 0.25
    const omega = onStar ? 0 : 0.0011 * (ringInner / tr) ** 1.5
    const start = T.converge + Math.random() * 350

    field.kind[i] = onStar ? STAR : RING
    field.a0[i] = a0
    field.r0[i] = Math.hypot(ux, uy)
    field.tr[i] = tr
    field.sweep[i] = sweep
    field.omega[i] = omega
    field.start[i] = start
    field.dur[i] = 1100 + Math.random() * 300
    field.phase[i] = Math.random() * TAU
    // 爆发方向沿用坍缩前所在的方位：星辉粒子炸成一颗放大的四芒星，盘面粒子炸成倾斜光环
    field.burstAngle[i] = a0 + sweep + omega * (T.burst - start) + COLLAPSE_TWIST + (Math.random() - 0.5) * 0.12
    field.burstSpeed[i] =
      burstMax *
      (onStar ? 0.3 + 0.7 * Math.min(1, tr / starReach) : 0.55 + 0.45 * ((tr - ringInner) / ringSpan)) *
      (0.85 + Math.random() * 0.3)
    field.burstDelay[i] = Math.random() * 70

    const r = Math.random()
    const size = r < 0.62 ? 0 : r < 0.9 ? 1 : 2
    const tinted = Math.random() < (onStar ? 0.6 : 0.3)
    field.buckets[(tinted ? 3 : 0) + size].push(i)
  }
  return field
}

/** 计算第 i 颗粒子在 t 时刻相对屏幕中心的位置 */
function locate(f: Field, i: number, t: number, pt: { x: number; y: number }) {
  let r: number
  let a: number
  let settle = 0
  if (t >= T.burst) {
    const tau = Math.max(0, t - T.burst - f.burstDelay[i])
    r = f.burstSpeed[i] * tau * (1 + 0.5 * BURST_ACCEL * tau)
    a = f.burstAngle[i]
  } else {
    const p = clamp01((t - f.start[i]) / f.dur[i])
    settle = p
    r = f.r0[i] + (f.tr[i] - f.r0[i]) * easeInOutCubic(p)
    // 角度缓动比半径更靠后：越接近目标转得越快，模拟角动量守恒的内旋
    a = f.a0[i] + f.sweep[i] * easeInOutCubic(p ** 1.3) + f.omega[i] * Math.max(0, t - f.start[i])
    if (t > T.collapse) {
      const c = (t - T.collapse) / (T.burst - T.collapse)
      r *= 1 - c * c * c
      a += COLLAPSE_TWIST * c * c
    }
  }

  let x = r * Math.cos(a)
  let y = r * Math.sin(a)
  if (f.kind[i] === RING) {
    y *= RING_FLAT
    const rx = x * COS_TILT - y * SIN_TILT
    y = x * SIN_TILT + y * COS_TILT
    x = rx
  } else if (settle > 0) {
    // 落定后的星辉粒子轻微游移，形成闪烁的能量质感
    const j = 0.6 * settle ** 8
    x += Math.sin(t * 0.0045 + f.phase[i]) * j
    y += Math.cos(t * 0.0038 + f.phase[i] * 1.7) * j
  }
  pt.x = x
  pt.y = y
}

/** 把 CSS 变量解析为 canvas 可用的颜色；解析失败时保留兜底色 */
function resolveColor(ctx: CanvasRenderingContext2D, el: Element, name: string, fallback: string) {
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  ctx.strokeStyle = fallback
  if (value) ctx.strokeStyle = value
  return typeof ctx.strokeStyle === "string" ? ctx.strokeStyle : fallback
}

/**
 * AI Mode 载入开场：「奇点」。
 * 1. 星尘浮现：画面变暗的同时，满屏细碎星尘淡入。
 * 2. 汇聚：星尘以旋涡轨迹被吸向中心，一半凝成四芒星辉，一半落入倾斜的吸积盘绕行。
 * 3. 坍缩：星辉与星尘同时扭转着收缩成一个奇点。
 * 4. 爆发：奇点闪光，粒子沿原方位化作超光速拖尾向外飞散——放大的四芒星与光环冲出屏幕，
 *    工作台在拖尾中浮现。
 *
 * 粒子用 canvas 绘制（叠加混合，按桶批量 stroke），位置由时间解析计算、与帧率无关；
 * 星辉实体、辉光与闪光用 CSS 关键帧，时间轴与粒子共用 T 常量。
 */
export function AIIntro({ onDone }: { onDone: () => void }) {
  const [still] = useState(prefersReducedMotion)
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gradientId = `${useId().replace(/:/g, "")}-star`

  useEffect(() => {
    const timers: number[] = []
    const root = rootRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")

    if (still || !root || !canvas || !ctx) {
      timers.push(window.setTimeout(onDone, still ? STILL_DONE_AT : DONE_AT))
      return () => timers.forEach(clearTimeout)
    }

    let w = 0
    let h = 0
    const resize = () => {
      const rect = root.getBoundingClientRect()
      w = rect.width
      h = rect.height
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const starSize = starSizeFor(w, h)
    root.style.setProperty("--aii-star", `${starSize}px`)
    const field = buildField(w, h, starSize)
    const colors = [
      resolveColor(ctx, root, "--foreground", "#f4f6fb"),
      resolveColor(ctx, root, "--primary", "#7cc4ff"),
    ]

    const head = { x: 0, y: 0 }
    const tail = { x: 0, y: 0 }
    const t0 = performance.now()
    let raf = 0

    const frame = (now: number) => {
      const t = now - t0
      ctx.clearRect(0, 0, w, h)
      if (t >= T.end) return

      const fadeIn = clamp01(t / T.fieldIn)
      let alpha = fadeIn * fadeIn * (3 - 2 * fadeIn)
      let trail = TRAIL_MS
      if (t >= T.burst) {
        alpha *= (1 - clamp01((t - T.burst) / BURST_FADE_MS)) ** 1.4
        trail = BURST_TRAIL_MS
      }

      const cx = w / 2
      const cy = h / 2
      ctx.globalCompositeOperation = "lighter"
      ctx.lineCap = "round"
      for (let b = 0; b < 6; b++) {
        const size = b % 3
        ctx.globalAlpha = alpha * SIZE_ALPHA[size]
        ctx.lineWidth = SIZE_WIDTH[size]
        ctx.strokeStyle = colors[b < 3 ? 0 : 1]
        ctx.beginPath()
        for (const i of field.buckets[b]) {
          locate(field, i, t, head)
          locate(field, i, t - trail, tail)
          const hx = cx + head.x
          const hy = cy + head.y
          let tx = cx + tail.x
          const ty = cy + tail.y
          // 静止时拖尾长度为零，补一点长度让圆头笔触画出光点
          if (Math.abs(hx - tx) + Math.abs(hy - ty) < 0.3) tx -= 0.3
          ctx.moveTo(tx, ty)
          ctx.lineTo(hx, hy)
        }
        ctx.stroke()
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    window.addEventListener("resize", resize)
    timers.push(window.setTimeout(onDone, DONE_AT))

    return () => {
      timers.forEach(clearTimeout)
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
    }
  }, [onDone, still])

  return (
    <div
      ref={rootRef}
      role="status"
      data-still={still ? "" : undefined}
      className="aii-root relative h-full w-full overflow-hidden"
      style={{ "--aii-star": STAR_SIZE_CSS } as CSSProperties}
    >
      <span className="sr-only">AI Mode 正在载入</span>

      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span
          className="aii-glow block shrink-0 rounded-full"
          style={{
            width: "calc(var(--aii-star) * 2.2)",
            height: "calc(var(--aii-star) * 2.2)",
            background:
              "radial-gradient(closest-side, color-mix(in oklab, var(--primary) 30%, transparent) 0%, color-mix(in oklab, var(--primary) 12%, transparent) 34%, color-mix(in oklab, var(--primary) 3%, transparent) 62%, transparent 82%)",
          }}
        />
      </div>

      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="aii-star block shrink-0" style={{ width: "var(--aii-star)", height: "var(--aii-star)" }}>
          <svg
            viewBox="-1 0 44 44"
            fill="none"
            shapeRendering="geometricPrecision"
            className="block size-full"
            style={{ filter: "drop-shadow(0 0 14px color-mix(in oklab, var(--primary) 65%, transparent))" }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: "var(--primary)" }} />
                <stop offset="100%" style={{ stopColor: "color-mix(in oklab, var(--primary) 55%, var(--foreground))" }} />
              </linearGradient>
            </defs>
            {STAR_PATHS.map((d, i) => (
              <path key={d} d={d} style={{ fill: i === 2 ? "var(--foreground)" : `url(#${gradientId})` }} />
            ))}
          </svg>
        </span>
      </div>

      {!still && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            className="aii-flash block shrink-0 rounded-full"
            style={{
              width: "calc(var(--aii-star) * 2.4)",
              height: "calc(var(--aii-star) * 2.4)",
              background:
                "radial-gradient(circle, var(--foreground) 0%, color-mix(in oklab, var(--primary) 65%, transparent) 14%, transparent 55%)",
            }}
          />
        </div>
      )}

      {!still && <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" />}

      <style>{INTRO_CSS}</style>
    </div>
  )
}

const at = (ms: number, total: number) => `${((ms / total) * 100).toFixed(2)}%`
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)"
const EASE_IN = "cubic-bezier(0.55, 0, 1, 0.45)"

const INTRO_CSS = `
@keyframes aii-star {
  0%, ${at(T.form - 150, T.burst)} { opacity: 0; transform: scale(0.84); filter: blur(6px); animation-timing-function: ${EASE_OUT}; }
  ${at(T.form + 250, T.burst)} { opacity: 0.88; transform: scale(1); filter: blur(0px) brightness(1); }
  ${at(T.collapse, T.burst)} { opacity: 0.9; transform: scale(1.03) rotate(0deg); filter: blur(0px) brightness(1); animation-timing-function: ${EASE_IN}; }
  100% { opacity: 1; transform: scale(0) rotate(90deg); filter: blur(0px) brightness(1.8); }
}
@keyframes aii-glow {
  0%, ${at(T.form - 300, T.end)} { opacity: 0; transform: scale(0.6); animation-timing-function: ${EASE_OUT}; }
  ${at(T.form + 300, T.end)} { opacity: 0.8; transform: scale(1); }
  ${at(T.collapse, T.end)} { opacity: 0.85; transform: scale(1.05); animation-timing-function: ${EASE_IN}; }
  ${at(T.burst, T.end)} { opacity: 1; transform: scale(0.45); animation-timing-function: ${EASE_OUT}; }
  ${at(T.burst + 420, T.end)}, 100% { opacity: 0; transform: scale(2.4); }
}
@keyframes aii-flash {
  0% { opacity: 0; transform: scale(0.15); }
  16% { opacity: 1; }
  100% { opacity: 0; transform: scale(1.5); }
}
@keyframes aii-still-in {
  from { opacity: 0; }
}
.aii-star { opacity: 0; animation: aii-star ${T.burst}ms linear both; }
.aii-glow { opacity: 0; animation: aii-glow ${T.end}ms linear both; }
.aii-flash { opacity: 0; animation: aii-flash 560ms ${EASE_OUT} ${T.burst - 30}ms both; }
.aii-root[data-still] .aii-star { opacity: 0.9; animation: aii-still-in 400ms ease-out both; }
.aii-root[data-still] .aii-glow { opacity: 0.8; animation: aii-still-in 400ms ease-out both; }
`
