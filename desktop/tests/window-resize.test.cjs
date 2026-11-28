const assert = require("node:assert/strict")
const test = require("node:test")
const { normalizeResizeEdges, resolveResizeBounds } = require("../src/window-resize.cjs")

const session = {
  startBounds: { x: 100, y: 200, width: 1440, height: 900 },
  minSize: [960, 640],
  edges: ["right", "bottom"],
}

test("只接受四个合法方向，其余忽略", () => {
  assert.deepEqual(normalizeResizeEdges(["right", "diagonal", "top"]), ["top", "right"])
  assert.deepEqual(normalizeResizeEdges(undefined), [])
  assert.deepEqual(normalizeResizeEdges("left"), [])
})

test("右下方向只改变尺寸，位置不变", () => {
  const next = resolveResizeBounds(session, 120, 80)
  assert.deepEqual(next, { x: 100, y: 200, width: 1560, height: 980 })
})

test("左上方向位置与尺寸同步变化", () => {
  const next = resolveResizeBounds({ ...session, edges: ["left", "top"] }, -60, -40)
  assert.deepEqual(next, { x: 40, y: 160, width: 1500, height: 940 })
})

test("缩到最小尺寸时左上坐标随之停住，不会越界", () => {
  const next = resolveResizeBounds({ ...session, edges: ["left", "top"] }, 4000, 4000)
  assert.deepEqual(next, { x: 580, y: 460, width: 960, height: 640 })
})

test("非法位移按 0 处理，不产生 NaN", () => {
  const next = resolveResizeBounds(session, Number.NaN, "abc")
  assert.deepEqual(next, { x: 100, y: 200, width: 1440, height: 900 })
})

test("未包含的方向不受位移影响", () => {
  const next = resolveResizeBounds({ ...session, edges: ["right"] }, -30, 999)
  assert.deepEqual(next, { x: 100, y: 200, width: 1410, height: 900 })
})
