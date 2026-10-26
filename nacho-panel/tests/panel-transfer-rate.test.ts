import assert from "node:assert/strict"
import { test } from "node:test"
import {
  estimateRemainingSeconds, formatRemaining, formatTransferRate, smoothTransferRate,
} from "../lib/panel-install-progress"

const MIB = 1024 * 1024

test("速率平滑：首个采样直接采用，后续按权重混合，异常采样保留原值", () => {
  assert.equal(smoothTransferRate(null, 4 * MIB), 4 * MIB)
  assert.equal(smoothTransferRate(10, 20), 13)
  assert.equal(smoothTransferRate(10, Number.NaN), 10)
  assert.equal(smoothTransferRate(10, -5), 10)
  assert.equal(smoothTransferRate(null, Number.POSITIVE_INFINITY), null)
})

test("剩余时间来自真实剩余字节，缺少总量、速率或已完成时不估算", () => {
  assert.equal(estimateRemainingSeconds(28.9 * MIB, 123.7 * MIB, 4 * MIB), 24)
  assert.equal(estimateRemainingSeconds(0, null, 4 * MIB), null)
  assert.equal(estimateRemainingSeconds(10, 100, null), null)
  assert.equal(estimateRemainingSeconds(10, 100, 0), null)
  assert.equal(estimateRemainingSeconds(100, 100, 4), null)
})

test("速率与剩余时间的展示文案", () => {
  assert.equal(formatTransferRate(4.25 * MIB), "4.3 MiB/s")
  assert.equal(formatTransferRate(512 * 1024), "512 KiB/s")
  assert.equal(formatTransferRate(300), "300 B/s")
  assert.equal(formatRemaining(24), "剩余 24 秒")
  assert.equal(formatRemaining(61), "剩余约 2 分钟")
  assert.equal(formatRemaining(7200), "剩余超过 1 小时")
})
