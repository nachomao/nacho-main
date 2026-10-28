import type { AIModeOrigin } from "./ai-mode-context"

/** 幕布边缘羽化宽度（px）：软边藏在像素浪潮的光带之下，展开与收拢都没有硬边 */
export const VEIL_FEATHER = 72

/**
 * 幕布遮罩：以 --veil-x / --veil-y 为圆心、--veil-r 为半径的羽化圆。
 * 变量由入场浪潮与退场收拢逐帧写入（不经 React 状态），未写入时半径为 0，幕布不可见。
 */
export const VEIL_MASK = `radial-gradient(circle at var(--veil-x, 50%) var(--veil-y, 0px), #000 calc(var(--veil-r, 0px) - ${VEIL_FEATHER}px), transparent var(--veil-r, 0px))`

/** 从发源点出发、恰好覆盖整个视口所需的半径（含羽化余量） */
export function veilCoverRadius(origin: AIModeOrigin, width = window.innerWidth, height = window.innerHeight) {
  return Math.hypot(Math.max(origin.x, width - origin.x), Math.max(origin.y, height - origin.y)) + VEIL_FEATHER
}

/** 写入幕布圆心与半径；半径为 Infinity 表示常驻全覆盖（窗口缩放后仍然铺满） */
export function paintVeil(el: HTMLElement | null, origin: AIModeOrigin, radius: number) {
  if (!el) return
  el.style.setProperty("--veil-x", `${origin.x}px`)
  el.style.setProperty("--veil-y", `${origin.y}px`)
  el.style.setProperty("--veil-r", Number.isFinite(radius) ? `${Math.max(0, radius)}px` : "200vmax")
}

export const easeOutCubic = (p: number) => 1 - (1 - p) ** 3
export const easeInCubic = (p: number) => p * p * p
