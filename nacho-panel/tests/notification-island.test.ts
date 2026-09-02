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
  // 铃铛拆成三笔：一步画完的帽罩、铃身底边、铃舌。
  assert.match(topbarSource, /notice-bell-hood/)
  assert.match(topbarSource, /notice-bell-body/)
  assert.match(topbarSource, /notice-bell-clapper/)
  assert.match(topbarSource, /notice-warning-triangle/)
  assert.match(topbarSource, /notice-warning-mark/)
  assert.match(topbarSource, /notice-warning-dot/)
  assert.match(topbarSource, /pathLength="1"/)

  // 断线：铃舌 → 铃身 → 帽罩反向擦除，随后三角 → 竖线 → 圆点正绘。
  assert.match(globalCssSource, /notice-phase-bell-erasing \.notice-bell-clapper \{\s*animation: notice-stroke-erase 140ms/)
  assert.match(globalCssSource, /notice-phase-bell-erasing \.notice-bell-body \{\s*animation: notice-stroke-erase 300ms[^;]*110ms both/)
  assert.match(globalCssSource, /notice-phase-bell-erasing \.notice-bell-hood \{\s*animation: notice-stroke-erase 220ms[^;]*380ms both/)
  assert.match(globalCssSource, /notice-phase-warning-drawing \.notice-warning-triangle \{\s*animation: notice-stroke-draw 520ms/)
  assert.match(globalCssSource, /notice-phase-warning-drawing \.notice-warning-mark \{\s*animation: notice-stroke-draw 200ms[^;]*480ms both/)
  assert.match(globalCssSource, /notice-phase-warning-drawing \.notice-warning-dot \{\s*animation: notice-stroke-draw 130ms[^;]*660ms both/)

  // 恢复：圆点 → 竖线 → 三角反向擦除，随后帽罩 → 铃身 → 铃舌正绘。
  assert.match(globalCssSource, /notice-phase-warning-erasing \.notice-warning-dot \{\s*animation: notice-stroke-erase 110ms/)
  assert.match(globalCssSource, /notice-phase-warning-erasing \.notice-warning-mark \{\s*animation: notice-stroke-erase 170ms[^;]*80ms both/)
  assert.match(globalCssSource, /notice-phase-warning-erasing \.notice-warning-triangle \{\s*animation: notice-stroke-erase 420ms[^;]*220ms both/)
  assert.match(globalCssSource, /notice-phase-bell-drawing \.notice-bell-hood \{\s*animation: notice-stroke-draw 300ms/)
  assert.match(globalCssSource, /notice-phase-bell-drawing \.notice-bell-body \{\s*animation: notice-stroke-draw 420ms[^;]*270ms both/)
  assert.match(globalCssSource, /notice-phase-bell-drawing \.notice-bell-clapper \{\s*animation: notice-stroke-draw 170ms[^;]*660ms both/)

  // 归一化虚线不得叠加 non-scaling-stroke，否则描边动画几乎不可见。
  assert.match(globalCssSource, /stroke-dasharray: 1 1;/)
  assert.doesNotMatch(globalCssSource, /\.notice-stroke \{[^}]*non-scaling-stroke/)
  // 擦除必须让笔尾先消失（dashoffset 0 → 1），取 -1 会从起笔处开始吃线。
  assert.match(globalCssSource, /@keyframes notice-stroke-erase \{\s*from \{ stroke-dashoffset: 0; \}\s*to \{ stroke-dashoffset: 1; \}/)
  assert.match(globalCssSource, /prefers-reduced-motion: reduce/)
})

test("图标配色跟随笔画身份，避免红铃铛与绿警告", () => {
  assert.match(topbarSource, /const iconWarning = iconPhase\.startsWith\("warning"\)/)
  assert.match(topbarSource, /iconWarning \? "text-negative" : recovered \? "text-positive" : "text-foreground"/)
  assert.match(topbarSource, /expanded && iconWarning && <span/)
  assert.doesNotMatch(topbarSource, /expanded \? "text-negative"/)
})
