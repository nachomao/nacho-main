import test from "node:test"
import assert from "node:assert/strict"
import { formatMetricPercent } from "../components/clients/client-data"

test("formats client percentages without long floating point tails", () => {
  assert.equal(formatMetricPercent(96.9075958075156), "96.91")
  assert.equal(formatMetricPercent(8.968850698174007), "8.97")
  assert.equal(formatMetricPercent(76.74718097974676), "76.75")
})

test("clamps invalid client percentages to a compact display value", () => {
  assert.equal(formatMetricPercent(120), "100")
  assert.equal(formatMetricPercent(-1), "0")
  assert.equal(formatMetricPercent(Number.NaN), "0")
  assert.equal(formatMetricPercent(null), "0")
})
