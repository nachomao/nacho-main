import assert from "node:assert/strict"
import test from "node:test"
import {
  besideRailPlacement,
  centerInViewport,
  clamp01,
  morphContentScale,
  morphFrame,
  type MorphRect,
} from "../lib/morph-geometry"

const capsule: MorphRect = { left: 24, top: 700, width: 208, height: 36 }
const card: MorphRect = { left: 420, top: 170, width: 602, height: 562 }

function approx(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`)
}

test("形变起止帧分别与触发胶囊和目标卡片重合", () => {
  assert.deepEqual(morphFrame(capsule, card, 0, 0), capsule)
  assert.deepEqual(morphFrame(capsule, card, 1, 1), card)
})

test("尺寸进度越过 1 时卡片比目标更大，且中心仍停在目标中心", () => {
  const overshoot = morphFrame(capsule, card, 1, 1.05)
  assert.ok(overshoot.width > card.width)
  assert.ok(overshoot.height > card.height)
  approx(overshoot.left + overshoot.width / 2, card.left + card.width / 2)
  approx(overshoot.top + overshoot.height / 2, card.top + card.height / 2)
})

test("位置与尺寸进度相互独立", () => {
  const moved = morphFrame(capsule, card, 1, 0)
  assert.equal(moved.width, capsule.width)
  assert.equal(moved.height, capsule.height)
  approx(moved.left + moved.width / 2, card.left + card.width / 2)
  const grown = morphFrame(capsule, card, 0, 1)
  assert.equal(grown.width, card.width)
  approx(grown.left + grown.width / 2, capsule.left + capsule.width / 2)
})

test("尺寸不会被外推成非正数", () => {
  const collapsed = morphFrame(capsule, card, 0, -2)
  assert.ok(collapsed.width >= 1)
  assert.ok(collapsed.height >= 1)
})

test("内容缩放在静止宽度附近吸附为 1", () => {
  assert.equal(morphContentScale(600.3, 600), 1)
  assert.equal(morphContentScale(300, 600), 0.5)
  assert.equal(morphContentScale(120, 0), 1)
  assert.equal(clamp01(-0.2), 0)
  assert.equal(clamp01(1.4), 1)
})

test("居中放置与贴栏放置都落在视口内", () => {
  assert.deepEqual(centerInViewport({ width: 600, height: 500 }, { width: 1440, height: 900 }), { left: 420, top: 200 })

  const viewport = { width: 1440, height: 900 }
  const anchor: MorphRect = { left: 1220, top: 420, width: 190, height: 60 }
  const beside = besideRailPlacement({ width: 300, height: 260 }, anchor, viewport, 1180)
  assert.equal(beside.left, 1180 - 12 - 300)
  assert.equal(beside.top, 412)

  const nearBottom = besideRailPlacement({ width: 300, height: 260 }, { ...anchor, top: 860 }, viewport, 1180)
  assert.equal(nearBottom.top, 900 - 260 - 12)

  const cramped = besideRailPlacement({ width: 300, height: 260 }, { ...anchor, left: 40 }, { width: 400, height: 900 }, 200)
  assert.ok(cramped.left >= 12)
  assert.ok(cramped.left + 300 <= 400 - 12 + 0.001)
})
