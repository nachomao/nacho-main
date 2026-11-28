"use strict"

/** 面板只提交四个方向标记，主进程统一校验后换算窗口边界。 */
const RESIZE_EDGES = ["top", "right", "bottom", "left"]

function normalizeResizeEdges(edges) {
  const list = Array.isArray(edges) ? edges : []
  return RESIZE_EDGES.filter((edge) => list.includes(edge))
}

/**
 * 按拖动位移换算新的窗口边界：左/上方向同时改变位置与尺寸，
 * 并始终保证不小于窗口最小尺寸。
 */
function resolveResizeBounds(session, dx, dy) {
  const { startBounds, minSize, edges } = session
  const offsetX = Math.round(Number(dx) || 0)
  const offsetY = Math.round(Number(dy) || 0)
  const [minWidth, minHeight] = minSize
  const next = { ...startBounds }
  if (edges.includes("left")) {
    next.x = startBounds.x + offsetX
    next.width = startBounds.width - offsetX
  }
  if (edges.includes("right")) next.width = startBounds.width + offsetX
  if (edges.includes("top")) {
    next.y = startBounds.y + offsetY
    next.height = startBounds.height - offsetY
  }
  if (edges.includes("bottom")) next.height = startBounds.height + offsetY
  if (next.width < minWidth) {
    if (edges.includes("left")) next.x = startBounds.x + startBounds.width - minWidth
    next.width = minWidth
  }
  if (next.height < minHeight) {
    if (edges.includes("top")) next.y = startBounds.y + startBounds.height - minHeight
    next.height = minHeight
  }
  return next
}

module.exports = { RESIZE_EDGES, normalizeResizeEdges, resolveResizeBounds }
