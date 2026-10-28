"use client"

import { useEffect, useRef } from "react"
import type { AIModeOrigin } from "./ai-mode-context"
import { easeOutCubic, veilCoverRadius } from "./veil"

/** 点阵格距（CSS px）：与 AI Mode 按钮里的像素星芒同规格——点击后，按钮里的像素涌出铺满全屏 */
const PITCH = 6
/** 窄屏格距：保证字标在小视口里仍有足够的点阵分辨率 */
const PITCH_COMPACT = 4
/** 像素边长占格距的比例（按钮星芒为 3 / 6） */
const DOT_RATIO = 0.5
/** 单帧逐格计算的上限：超大屏自动放宽格距，保持每帧计算在几毫秒内 */
const MAX_CELLS = 120_000

/* 时间轴（ms，自点击起算） */
/** 波前从发源点扩散到最远的视口角 */
const WAVE_MS = 1250
/** 字标开始燃尽，同时通知工作台浮现 */
const REVEAL_AT = 1150
/** 燃尽错峰范围与单个像素的燃尽时长 */
const BURN_SPREAD = 380
const BURN_MS = 260
const END_AT = Math.max(WAVE_MS, REVEAL_AT + BURN_SPREAD + BURN_MS) + 80

/* 波前光带形态（px） */
/** 前沿预亮宽度 */
const LEAD = 18
/** 白热区宽度：幕布的羽化边缘就藏在这一段之下 */
const HOT_BAND = 22
/** 余辉衰减长度 */
const TAIL = 120
/** 波前抖动：打散完美圆环的机械感，像素一颗颗被点亮 */
const JITTER = 16

const WORD = "AI Mode"

const smooth = (x: number) => x * x * (3 - 2 * x)

/** 把任意 CSS 颜色（含 oklch / color-mix）解析为 sRGB 字节，供逐像素着色 */
function resolveRGB(color: string): [number, number, number] {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return [110, 168, 255]
  ctx.fillStyle = "#6ea8ff"
  if (color) ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2]]
}

/**
 * 把 "AI Mode" 以界面字体栅格化到点阵：4×4 超采样求每格覆盖率，
 * 笔画内部满亮、边缘按覆盖率柔化，得到带抗锯齿的点阵字标。
 */
function rasterizeWordmark(cols: number, rows: number, cell: number, width: number, height: number) {
  const SS = 4
  const out = new Float32Array(cols * rows)
  const canvas = document.createElement("canvas")
  canvas.width = cols * SS
  canvas.height = rows * SS
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return out

  const family = getComputedStyle(document.body).fontFamily || "sans-serif"
  const unit = SS / cell
  ctx.font = `600 100px ${family}`
  const widthAt100 = ctx.measureText(WORD).width || 360
  const fontCss = (Math.min(width * 0.62, 780) / widthAt100) * 100
  ctx.font = `600 ${fontCss * unit}px ${family}`
  ctx.textAlign = "center"
  ctx.textBaseline = "alphabetic"
  const m = ctx.measureText(WORD)
  ctx.fillStyle = "#fff"
  // 视觉中心略高于几何中心
  ctx.fillText(WORD, (width / 2) * unit, height * 0.46 * unit + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2)

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const stride = canvas.width
  const norm = 1 / (SS * SS * 255)
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      let sum = 0
      for (let sy = 0; sy < SS; sy++) {
        let idx = ((gy * SS + sy) * stride + gx * SS) * 4 + 3
        for (let sx = 0; sx < SS; sx++, idx += 4) sum += data[idx]
      }
      const c = sum * norm
      out[gy * cols + gx] = c <= 0.16 ? 0 : c >= 0.6 ? 1 : smooth((c - 0.16) / 0.44)
    }
  }
  return out
}

/**
 * AI Mode 切入动画「像素涌潮」。
 * 1. 点击处迸发一圈 LED 像素波前（与按钮悬浮时的像素星芒同一点阵），
 *    向全屏扩散；波前后方的 AI 幕布随之羽化展开，余辉在身后冷却成一片残影点阵。
 * 2. 波前扫过屏幕中央时，"AI Mode" 字标的像素被逐颗点亮锁存：
 *    落位瞬间白热，随后稳定为主题色微闪——像被浪潮「显影」出来。
 * 3. 停留片刻后字标像素随机错峰白闪燃尽，工作台各栏同时从中心向两侧展开浮现。
 *
 * 渲染要点：逐格亮度写入「一格一像素」的低分辨率画布（亦作为模糊辉光层直接显示），
 * 再以最近邻放大到全分辨率画布并用像素图案做 destination-in 遮罩得到锐利点阵；
 * 每帧只有一次 putImageData 与两次整屏 GPU 绘制，与亮起的像素数量无关。
 */
export function AIIntro({
  origin,
  onVeil,
  onReveal,
}: {
  origin: AIModeOrigin
  /** 每帧回报幕布半径（px），Infinity 表示已完全覆盖 */
  onVeil: (radius: number) => void
  /** 字标开始燃尽：工作台在此刻开始浮现 */
  onReveal: () => void
}) {
  const dotsRef = useRef<HTMLCanvasElement>(null)
  const glowRef = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ origin, onVeil, onReveal })
  useEffect(() => {
    latest.current = { origin, onVeil, onReveal }
  })

  useEffect(() => {
    const veil = (radius: number) => latest.current.onVeil(radius)
    const reveal = () => latest.current.onReveal()
    const skip = () => {
      veil(Infinity)
      reveal()
    }

    const dots = dotsRef.current
    const glow = glowRef.current
    const dctx = dots?.getContext("2d")
    const gctx = glow?.getContext("2d")
    // 减少动态效果或窗口不可见时跳过涌潮，直接铺满幕布并浮现工作台
    if (!dots || !glow || !dctx || !gctx || document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      skip()
      return
    }

    const o = latest.current.origin
    const W = window.innerWidth
    const H = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const pitchCss = Math.max(W < 640 ? PITCH_COMPACT : PITCH, Math.sqrt((W * H) / MAX_CELLS))
    // 设备像素格距取整，保证低分辨率格与像素图案严格对齐
    const pitch = Math.max(2, Math.round(pitchCss * dpr))
    const cell = pitch / dpr
    const dot = Math.max(1, Math.round(pitch * DOT_RATIO))

    dots.width = Math.round(W * dpr)
    dots.height = Math.round(H * dpr)
    dots.style.width = `${W}px`
    dots.style.height = `${H}px`
    const cols = Math.ceil(dots.width / pitch)
    const rows = Math.ceil(dots.height / pitch)
    glow.width = cols
    glow.height = rows
    glow.style.width = `${cols * cell}px`
    glow.style.height = `${rows * cell}px`

    // 像素图案：必须先画好单元再 createPattern——图案在创建时就拷贝了画布内容
    const tile = document.createElement("canvas")
    tile.width = tile.height = pitch
    const tctx = tile.getContext("2d")
    if (tctx) {
      const inset = Math.floor((pitch - dot) / 2)
      tctx.fillStyle = "#fff"
      tctx.fillRect(inset, inset, dot, dot)
    }
    const pattern = tctx && dctx.createPattern(tile, "repeat")
    if (!pattern) {
      skip()
      return
    }

    // 每格的波前到达距离（含抖动）、到达时刻、闪烁相位与燃尽次序
    const n = cols * rows
    const reach = veilCoverRadius(o, W, H) + TAIL
    const dist = new Float32Array(n)
    const hit = new Float32Array(n)
    const seed = new Float32Array(n)
    const burn = new Float32Array(n)
    for (let gy = 0, i = 0; gy < rows; gy++) {
      const y = (gy + 0.5) * cell - o.y
      for (let gx = 0; gx < cols; gx++, i++) {
        const x = (gx + 0.5) * cell - o.x
        const d = Math.max(0, Math.hypot(x, y) + (Math.random() * 2 - 1) * JITTER)
        dist[i] = d
        // easeOutCubic 的反函数：由半径比反推波前到达的时间比
        hit[i] = d >= reach ? Infinity : (1 - Math.cbrt(1 - d / reach)) * WAVE_MS
        seed[i] = Math.random() * Math.PI * 2
        burn[i] = Math.random()
      }
    }
    const mark = rasterizeWordmark(cols, rows, cell, W, H)
    const [pr, pg, pb] = resolveRGB(getComputedStyle(document.documentElement).getPropertyValue("--primary").trim())

    const image = gctx.createImageData(cols, rows)
    const px = image.data
    const fullW = cols * pitch
    const fullH = rows * pitch
    let start = -1
    let raf = 0
    let covered = false
    let revealed = false

    const frame = (now: number) => {
      if (start < 0) start = now
      const t = now - start
      const p = Math.min(1, t / WAVE_MS)
      const r = easeOutCubic(p) * reach
      // 能量随扩散衰减：越往外光带越淡
      const amp = 1 - 0.55 * p

      if (!covered) {
        if (p >= 1) {
          covered = true
          veil(Infinity)
        } else {
          veil(r - HOT_BAND / 2)
        }
      }
      if (!revealed && t >= REVEAL_AT) {
        revealed = true
        reveal()
      }

      for (let i = 0; i < n; i++) {
        const s = r - dist[i]
        let a = 0
        let hot = 0
        if (s >= 0) {
          a = amp * Math.exp(-s / TAIL)
          if (s < HOT_BAND) hot = 1 - s / HOT_BAND
          // 波前过后残留的淡淡点阵，缓慢冷却
          const residue = 0.1 * Math.exp(-(t - hit[i]) / 650)
          if (residue > a) a = residue
        } else if (s > -LEAD) {
          a = amp * 0.35 * (1 + s / LEAD)
        }
        if (a > 0.004) a *= 0.7 + 0.3 * Math.sin(t * 0.012 + seed[i])

        const m = mark[i]
        if (m > 0 && s >= 0) {
          const since = t - hit[i]
          let lv = m * Math.min(1, since / 80) * (0.88 + 0.12 * Math.sin(t * 0.006 + seed[i] * 1.7))
          // 锁存瞬间白热，随后稳定在略提亮的主题色
          let h = 0.2 + 0.8 * Math.exp(-since / 260)
          if (t > REVEAL_AT) {
            const k = (t - REVEAL_AT - burn[i] * BURN_SPREAD) / BURN_MS
            if (k >= 1) {
              lv = 0
            } else if (k > 0) {
              // 燃尽：先白闪再熄灭
              h = Math.max(h, 1 - k)
              lv *= 1 - k * k
            }
          }
          if (lv >= a) {
            a = lv
            if (h > hot) hot = h
          }
        }

        const q = i * 4
        if (a <= 0.004) {
          px[q + 3] = 0
          continue
        }
        const w = hot * 0.85
        px[q] = pr + (255 - pr) * w
        px[q + 1] = pg + (255 - pg) * w
        px[q + 2] = pb + (255 - pb) * w
        px[q + 3] = a >= 1 ? 255 : a * 255
      }

      gctx.putImageData(image, 0, 0)
      dctx.clearRect(0, 0, dots.width, dots.height)
      dctx.imageSmoothingEnabled = false
      dctx.drawImage(glow, 0, 0, fullW, fullH)
      dctx.globalCompositeOperation = "destination-in"
      dctx.fillStyle = pattern
      dctx.fillRect(0, 0, dots.width, dots.height)
      dctx.globalCompositeOperation = "source-over"

      if (t < END_AT) {
        raf = requestAnimationFrame(frame)
      } else {
        dctx.clearRect(0, 0, dots.width, dots.height)
        gctx.clearRect(0, 0, cols, rows)
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* 辉光层：一格一像素的低分辨率画布被拉伸 + 模糊，充当点阵的光晕并填补像素间隙 */}
      <canvas ref={glowRef} aria-hidden className="absolute left-0 top-0" style={{ filter: "blur(10px)", opacity: 0.7 }} />
      <canvas ref={dotsRef} aria-hidden className="absolute left-0 top-0" />
      <span role="status" className="sr-only">
        AI Mode 正在载入
      </span>
    </div>
  )
}
