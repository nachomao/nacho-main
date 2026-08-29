import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const topbarSource = readFileSync(new URL("../components/topbar.tsx", import.meta.url), "utf8")
const serverDataSource = readFileSync(new URL("../components/server-data-context.tsx", import.meta.url), "utf8")
const globalCssSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")

test("服务端首次连接失败时也会展开通知灵动岛", () => {
  assert.match(topbarSource, /const expanded = Boolean\(error\)/)
  assert.doesNotMatch(topbarSource, /const expanded = Boolean\(overview && error\)/)
  assert.doesNotMatch(topbarSource, /尚无同步数据|每 10 秒重试/)
})

test("自动重试开始时不清空错误并误报服务恢复", () => {
  assert.match(topbarSource, /if \(wasDisconnected\.current && overview\)/)
  assert.doesNotMatch(
    serverDataSource,
    /if \(!connectedOnce\.current\) \{\s*setLoading\(true\)\s*setError\(null\)/,
  )
})

test("通知灵动岛保持等比例放大的尺寸", () => {
  assert.match(topbarSource, /h-13 flex-row-reverse/)
  assert.match(topbarSource, /min\(27rem, calc\(100vw - 8\.5rem\)\)/)
  assert.match(topbarSource, /"3\.25rem"/)
})

test("通知图标通过 animationend 推进可逆状态机", () => {
  assert.match(topbarSource, /type NoticeIconPhase/)
  assert.match(topbarSource, /onAnimationEnd=/)
  assert.match(topbarSource, /dataset\.sequenceEnd === "true"/)
  assert.match(topbarSource, /bell-erasing[\s\S]+warning-drawing/)
  assert.match(topbarSource, /warning-erasing[\s\S]+bell-drawing/)
  assert.match(topbarSource, /desiredWarning\.current/)
  assert.doesNotMatch(topbarSource, /bellReturnRef\.current\.animate|rotate\(17deg\)|animate-notice-retract/)
})

test("通知图标按指定笔顺绘制并严格倒序擦除", () => {
  assert.match(topbarSource, /notice-bell-body/)
  assert.match(topbarSource, /notice-bell-clapper/)
  assert.match(topbarSource, /notice-warning-triangle/)
  assert.match(topbarSource, /notice-warning-mark/)
  assert.match(topbarSource, /notice-warning-dot/)
  assert.match(topbarSource, /pathLength="1"/)

  // 断线：铃舌先擦除、主体后擦除；三角先绘制、感叹号后绘制。
  assert.match(globalCssSource, /notice-phase-bell-erasing \.notice-bell-clapper[\s\S]+160ms ease-in both/)
  assert.match(globalCssSource, /notice-phase-bell-erasing \.notice-bell-body[\s\S]+380ms[\s\S]+120ms both/)
  assert.match(globalCssSource, /notice-phase-warning-drawing \.notice-warning-triangle[\s\S]+460ms/)
  assert.match(globalCssSource, /notice-phase-warning-drawing \.notice-warning-mark[\s\S]+380ms both/)
  assert.match(globalCssSource, /notice-phase-warning-drawing \.notice-warning-dot[\s\S]+540ms both/)

  // 恢复：感叹号先擦除、三角后擦除；铃铛主体先绘制、铃舌后绘制。
  assert.match(globalCssSource, /notice-phase-warning-erasing \.notice-warning-dot[\s\S]+120ms ease-in both/)
  assert.match(globalCssSource, /notice-phase-warning-erasing \.notice-warning-triangle[\s\S]+200ms both/)
  assert.match(globalCssSource, /notice-phase-bell-drawing \.notice-bell-body[\s\S]+420ms/)
  assert.match(globalCssSource, /notice-phase-bell-drawing \.notice-bell-clapper[\s\S]+340ms both/)
  assert.match(globalCssSource, /stroke-dasharray: 1;/)
  assert.match(globalCssSource, /@keyframes notice-stroke-erase[\s\S]+stroke-dashoffset: -1;/)
  assert.match(globalCssSource, /prefers-reduced-motion: reduce/)
})
