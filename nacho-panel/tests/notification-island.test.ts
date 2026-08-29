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
  assert.match(topbarSource, /!disconnected && overview/)
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

test("错误图标返回铃铛时先绘制再甩动两次", () => {
  assert.match(topbarSource, /bellReturning \? "bell-return"/)
  assert.match(topbarSource, /bellReturnRef\.current\.animate/)
  assert.match(topbarSource, /duration: 700, delay: 560/)
  assert.match(topbarSource, /rotate\(17deg\)[\s\S]+rotate\(-12deg\)[\s\S]+rotate\(7deg\)[\s\S]+rotate\(-3deg\)/)
  assert.match(topbarSource, /iconVariant === "warning"/)
  assert.match(topbarSource, /setIconVariant\("warning"\)/)
  assert.match(topbarSource, /animate-notice-retract/)
  assert.match(topbarSource, /pathLength=\{1\}/)
  assert.match(topbarSource, /setRetracting\(true\)/)
  assert.doesNotMatch(topbarSource, /iconVariant === "check"|<Check /)
  assert.match(topbarSource, /expanded \? "error" : bellReturning \? "bell-return"/)
})

test("通知图标按落笔顺序分段绘制并反向擦除", () => {
  assert.match(topbarSource, /notice-icon-\$\{iconVariant\}/)
  // 铃铛主体（第二条 path）先于下方小锤完成；警告三角形先于感叹号。
  assert.match(globalCssSource, /notice-icon-bell:not\(\.animate-notice-retract\) path:nth-child\(2\)[\s\S]+animation-delay: 40ms/)
  assert.match(globalCssSource, /notice-icon-bell\.animate-notice-retract path:nth-child\(1\)[\s\S]+animation-delay: 0ms/)
  assert.match(globalCssSource, /notice-icon-bell\.animate-notice-retract path:nth-child\(2\)[\s\S]+animation-delay: 180ms/)
  assert.match(globalCssSource, /notice-icon-warning:not\(\.animate-notice-retract\) path:nth-child\(1\)[\s\S]+animation-delay: 0ms/)
  assert.match(globalCssSource, /notice-icon-warning:not\(\.animate-notice-retract\) path:nth-child\(2\)[\s\S]+animation-delay: 360ms/)
  assert.match(globalCssSource, /notice-icon-warning\.animate-notice-retract path:nth-child\(3\)[\s\S]+animation-delay: 0ms/)
  assert.match(globalCssSource, /stroke-dasharray: 200;\s*stroke-dashoffset: 0;[\s\S]+notice-stroke-retract/)
  assert.match(globalCssSource, /@keyframes notice-stroke-retract[\s\S]+stroke-dashoffset: 200;/)
  assert.match(globalCssSource, /\.animate-notice-icon path,[\s\S]+stroke-dasharray: 200;\s*stroke-dashoffset: 200;/)
})
