import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { alignRollingText, getRollingDirection } from "../lib/number-animation"

test("数值增加向上滚动，减少向下滚动，相同值保持静止", () => {
  assert.equal(getRollingDirection(24, 31), "up")
  assert.equal(getRollingDirection(31, 24), "down")
  assert.equal(getRollingDirection(24, 24), "none")
})

test("位数变化时从右侧对齐，保证个位保持在同一列", () => {
  assert.deepEqual(alignRollingText("9", "10"), { previous: " 9", next: "10" })
  assert.deepEqual(alignRollingText("100", "99"), { previous: "100", next: " 99" })
  assert.deepEqual(alignRollingText("9.5", "10.2"), { previous: " 9.5", next: "10.2" })
})

test("数值容器继承父级行高，不产生 inline-block 基线留白", () => {
  const animatedNumberSource = readFileSync(new URL("../components/animated-number.tsx", import.meta.url), "utf8")
  const rollingNumberSource = readFileSync(new URL("../components/rolling-number.tsx", import.meta.url), "utf8")

  assert.match(animatedNumberSource, /display: "inline-flex", alignItems: "center", verticalAlign: "middle"/)
  assert.match(rollingNumberSource, /height: "1lh"/)
  assert.doesNotMatch(animatedNumberSource, /display: "inline-block", verticalAlign: "bottom"/)
})
