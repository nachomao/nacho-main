"use client"

import { useEffect, useRef } from "react"

/**
 * 像素星芒特效 v2（LED 点阵风格）。
 * 灵感来自 Claude 的 Ultracode 滑杆星光，加入了几点自己的设计：
 * 1. 进场冲击波：悬浮瞬间从指针位置扩散一圈点亮波，像素被「唤醒」。
 * 2. 彗星拖尾：光斑中心用弹簧插值追踪指针，快速划过时留下一条渐暗的星尘尾迹。
 * 3. 热度分层：光斑核心的像素混白灼亮，中圈是主题色，外圈幽暗——像真实光源。
 * 4. 流光扫掠：一道斜向微光周期性缓慢掠过整片点阵。
 * 颜色取自 currentColor（挂 text-primary 即用主题主色），非硬编码。
 */
export function PixelStardust({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeRef = useRef(active)
  const mouseRef = useRef<{ x: number; y: number } | null>(null)
  // 进场冲击波的起点与开始时间
  const burstRef = useRef<{ x: number; y: number; t: number } | null>(null)

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const parent = canvas.parentElement
    if (!parent) return

    const colorStr = getComputedStyle(canvas).color
    // 预混好分层颜色，避免每帧解析 color-mix
    const hot = `color-mix(in oklab, ${colorStr} 22%, white)` // 核心灼亮
    const warm = `color-mix(in oklab, ${colorStr} 62%, white)` // 内圈偏亮

    const PITCH = 6 // 更细密的点阵
    const SIZE = 3

    let raf = 0
    let master = 0
    let cols = 0
    let rows = 0
    let seeds: Float32Array = new Float32Array(0)
    let heat: Float32Array = new Float32Array(0) // 每格余热：指针扫过后缓慢冷却的尾迹
    // 弹簧插值的光斑中心（带速度，产生自然的追赶/回弹）
    let sx = 0
    let sy = 0
    let vx = 0
    let vy = 0
    let springInit = false

    const resize = () => {
      const r = parent.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(r.width * dpr)
      canvas.height = Math.round(r.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cols = Math.ceil(r.width / PITCH)
      rows = Math.ceil(r.height / PITCH)
      seeds = new Float32Array(cols * rows)
      heat = new Float32Array(cols * rows)
      for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random() * Math.PI * 2
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(parent)

    const onMove = (e: MouseEvent) => {
      const r = parent.getBoundingClientRect()
      mouseRef.current = { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onEnter = (e: MouseEvent) => {
      const r = parent.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      mouseRef.current = { x, y }
      burstRef.current = { x, y, t: performance.now() }
      // 弹簧从进入点起步，避免从旧位置飞过来
      sx = x
      sy = y
      vx = 0
      vy = 0
      springInit = true
    }
    parent.addEventListener("mousemove", onMove)
    parent.addEventListener("mouseenter", onEnter)

    const draw = (now: number) => {
      const t = now / 1000
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.width / dpr
      const h = canvas.height / dpr

      // 进场更快、退场稍缓，都保持平滑
      const target = activeRef.current ? 1 : 0
      master += (target - master) * (activeRef.current ? 0.16 : 0.08)
      if (master < 0.01 && !activeRef.current) {
        ctx.clearRect(0, 0, w, h)
        heat.fill(0)
        raf = 0
        return
      }

      ctx.clearRect(0, 0, w, h)

      // —— 弹簧追踪指针：产生顺滑的追赶感 ——
      const mx = mouseRef.current?.x ?? w * (0.5 + 0.35 * Math.sin(t * 0.6))
      const my = mouseRef.current?.y ?? h * 0.5
      if (!springInit) {
        sx = mx
        sy = my
        springInit = true
      }
      const K = 0.14 // 弹簧刚度
      const D = 0.72 // 阻尼
      vx = (vx + (mx - sx) * K) * D
      vy = (vy + (my - sy) * K) * D
      sx += vx
      sy += vy
      const speed = Math.sqrt(vx * vx + vy * vy)

      // 光斑半径随速度轻微膨胀（快速划过时光晕拉大）
      const radius = Math.max(w, h) * (0.5 + Math.min(speed * 0.012, 0.22))

      // —— 进场冲击波参数 ——
      const burst = burstRef.current
      let burstR = -1
      let burstAge = 0
      if (burst) {
        burstAge = (now - burst.t) / 1000
        if (burstAge < 0.7) {
          // 波前半径：0.7s 内扩散到整个按钮之外
          burstR = burstAge * (Math.max(w, h) * 2.4)
        } else {
          burstRef.current = null
        }
      }

      // 流光扫掠：斜向行波（周期约 2.6s）
      const sweepPhase = t * 2.4

      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const i = gy * cols + gx
          const px = gx * PITCH + PITCH / 2
          const py = gy * PITCH + PITCH / 2

          const dx = px - sx
          const dy = py - sy
          const dist = Math.sqrt(dx * dx + dy * dy)
          const falloff = Math.max(0, 1 - dist / radius)

          // —— 余热尾迹：光斑核心持续加热，随后指数冷却 ——
          if (falloff > 0.55) {
            heat[i] = Math.max(heat[i], (falloff - 0.55) * 2.2)
          }
          heat[i] *= 0.94

          // —— 冲击波：波前经过的像素瞬间点亮 ——
          let burstGlow = 0
          if (burstR > 0) {
            const bd = Math.abs(Math.hypot(px - burst!.x, py - burst!.y) - burstR)
            if (bd < 14) burstGlow = (1 - bd / 14) * (1 - burstAge / 0.7)
          }

          const base = Math.max(falloff * falloff, heat[i] * 0.7)
          if (base <= 0.02 && burstGlow <= 0.02) continue

          // 每颗像素独立相位闪烁（速度越快闪烁越急促）
          const twinkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * (2.6 + (seeds[i] % 1.6) + speed * 0.08) + seeds[i] * 3))

          // 流光：沿对角线的行波亮带
          const sweep = 0.5 + 0.5 * Math.sin(sweepPhase - (px + py) * 0.045)
          const sweepBoost = sweep > 0.92 ? (sweep - 0.92) * 5 : 0

          const a = master * Math.min(1, base * twinkle + burstGlow * 0.6 + sweepBoost * falloff * 0.5)
          if (a <= 0.015) continue

          // 热度分层：核心灼亮 → 内圈暖亮 → 外圈主题色（冲击波经过时也只是温和提亮）
          ctx.globalAlpha = a
          ctx.fillStyle = falloff > 0.82 ? hot : falloff > 0.6 ? warm : colorStr
          ctx.fillRect(px - SIZE / 2, py - SIZE / 2, SIZE, SIZE)
        }
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }

    const ensureRunning = () => {
      if (!raf) raf = requestAnimationFrame(draw)
    }
    ensureRunning()
    const observer = new MutationObserver(ensureRunning)
    observer.observe(canvas, { attributes: true, attributeFilter: ["data-active"] })

    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      observer.disconnect()
      parent.removeEventListener("mousemove", onMove)
      parent.removeEventListener("mouseenter", onEnter)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      data-active={active ? "1" : "0"}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full text-primary"
    />
  )
}
