/* 形变弹层的纯几何：位置进度驱动中心点、尺寸进度驱动宽高。
 * 尺寸进度越过 1 时沿同一斜率外推，卡片就会“完全展开后再多撑开一点”，随后被弹簧拉回。 */

export type MorphRect = { left: number; top: number; width: number; height: number }
export type MorphSize = { width: number; height: number }
export type MorphViewport = MorphSize
export type MorphPoint = { left: number; top: number }

export function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

/** from → to 的中间帧：position 只移动中心点，size 只改变宽高，两者可由不同弹簧驱动。 */
export function morphFrame(from: MorphRect, to: MorphRect, position: number, size: number): MorphRect {
  const fromX = from.left + from.width / 2
  const fromY = from.top + from.height / 2
  const toX = to.left + to.width / 2
  const toY = to.top + to.height / 2
  const width = Math.max(1, from.width + (to.width - from.width) * size)
  const height = Math.max(1, from.height + (to.height - from.height) * size)
  const centerX = fromX + (toX - fromX) * position
  const centerY = fromY + (toY - fromY) * position
  return { left: centerX - width / 2, top: centerY - height / 2, width, height }
}

/** 内容随卡片宽度等比缩放；与基准宽度相差不到半像素时吸附为 1，静止态文字不经过缩放渲染。 */
export function morphContentScale(cardWidth: number, contentWidth: number) {
  if (contentWidth <= 0) return 1
  return Math.abs(cardWidth - contentWidth) < 0.5 ? 1 : cardWidth / contentWidth
}

export function centerInViewport(size: MorphSize, viewport: MorphViewport): MorphPoint {
  return { left: (viewport.width - size.width) / 2, top: (viewport.height - size.height) / 2 }
}

/**
 * 贴着右侧栏左缘弹出：卡片右边与侧栏留出 gap，顶部与锚点对齐并夹在视口内；
 * 侧栏左侧放不下时退回视口内，与锚点重叠显示。
 */
export function besideRailPlacement(
  size: MorphSize,
  anchor: MorphRect,
  viewport: MorphViewport,
  railLeft: number,
  { gap = 12, gutter = 12 }: { gap?: number; gutter?: number } = {},
): MorphPoint {
  let left = railLeft - gap - size.width
  if (left < gutter) left = Math.min(Math.max(gutter, anchor.left), viewport.width - size.width - gutter)
  const maxTop = Math.max(gutter, viewport.height - size.height - gutter)
  const top = Math.min(Math.max(gutter, anchor.top - 8), maxTop)
  return { left, top }
}
