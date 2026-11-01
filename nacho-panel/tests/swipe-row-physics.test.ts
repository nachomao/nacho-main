import assert from "node:assert/strict"
import test from "node:test"
import {
  SWIPE_FLICK,
  canSwipeCommit,
  releaseVelocity,
  rubberBand,
  swipeCommitPoint,
  swipeExposure,
  swipeRaw,
  swipeReleaseTarget,
  unrubberBand,
  type SwipeGeometry,
} from "../lib/swipe-row-physics"

const row: SwipeGeometry = { width: 230, actionWidth: 72, resistance: 0.55, commitAt: 0.6 }

function approx(actual: number, expected: number, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`)
}

test("橡皮筋阻尼有界且可逆", () => {
  for (const offset of [-400, -60, -1, 0, 1, 60, 400]) {
    const damped = rubberBand(offset, 230, 0.55)
    assert.ok(Math.abs(damped) < 230)
    assert.ok(Math.abs(damped) <= Math.abs(offset))
    approx(unrubberBand(damped, 230, 0.55), offset)
  }
})

test("露出宽度与手指位移互为反函数，且在各分段边界连续", () => {
  for (let raw = -150; raw <= 600; raw += 7.5) {
    approx(swipeRaw(swipeExposure(raw, row), row), raw, 1e-6)
  }
  approx(swipeExposure(row.actionWidth, row), row.actionWidth)
  approx(swipeExposure(row.actionWidth + 1e-9, row), row.actionWidth)
  const commit = swipeCommitPoint(row)
  const knee = row.actionWidth + (commit - row.actionWidth) / row.resistance
  approx(swipeExposure(knee, row), commit)
  approx(swipeExposure(knee + 1e-9, row), commit)
})

test("行太窄放不下提交点时只露出操作键，不会整行提交", () => {
  const narrow: SwipeGeometry = { ...row, width: 90 }
  assert.equal(canSwipeCommit(narrow), false)
  const far = swipeExposure(400, narrow)
  assert.ok(far > narrow.actionWidth)
  assert.ok(far < narrow.actionWidth + narrow.width)
  approx(swipeRaw(far, narrow), 400)
  assert.equal(canSwipeCommit(row), true)
  assert.equal(swipeCommitPoint(row), 138)
})

test("松手落点：甩动看方向，慢放看惯性是否过半", () => {
  assert.equal(swipeReleaseTarget(10, SWIPE_FLICK, 72), 72)
  assert.equal(swipeReleaseTarget(70, -SWIPE_FLICK, 72), 0)
  assert.equal(swipeReleaseTarget(40, 0, 72), 72)
  assert.equal(swipeReleaseTarget(30, 0, 72), 0)
  assert.equal(swipeReleaseTarget(30, 20, 72), 72)
})

test("松手速度取首尾采样的斜率", () => {
  assert.equal(releaseVelocity([]), 0)
  assert.equal(releaseVelocity([[0, 10]]), 0)
  assert.equal(releaseVelocity([[0, 10], [8, 14], [16, 30]]), 1250)
  assert.equal(releaseVelocity([[5, 30], [5, 10]]), -20_000)
})
