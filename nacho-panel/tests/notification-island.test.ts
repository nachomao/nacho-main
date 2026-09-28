import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const topbarSource = readFileSync(new URL("../components/topbar.tsx", import.meta.url), "utf8")
const serverDataSource = readFileSync(new URL("../components/server-data-context.tsx", import.meta.url), "utf8")
const notificationIslandSource = topbarSource.slice(
  topbarSource.indexOf("function NotificationIsland"),
  topbarSource.indexOf("/** 按当前时段返回问候语"),
)

test("服务端首次连接失败时也会展开通知入口", () => {
  assert.match(notificationIslandSource, /const expanded = Boolean\(error\)/)
  assert.doesNotMatch(notificationIslandSource, /const expanded = Boolean\(overview && error\)/)
  assert.doesNotMatch(notificationIslandSource, /尚无同步数据|每 10 秒重试/)
})

test("自动重试开始时不清空错误并误报服务恢复", () => {
  assert.doesNotMatch(
    serverDataSource,
    /if \(!connectedOnce\.current\) \{\s*setLoading\(true\)\s*setError\(null\)/,
  )
})

test("通知入口使用完整的单一铃铛图标", () => {
  assert.match(topbarSource, /Bell,?[\s\S]+from "lucide-react"/)
  assert.match(notificationIslandSource, /<Bell className="size-5" strokeWidth=\{2\} aria-hidden="true" \/>/)
  assert.doesNotMatch(notificationIslandSource, /unread|criticalAttention|NoticeStrokeIcon|notice-warning|notice-phase/)
})

test("通知入口不再渲染会被裁切的数字角标", () => {
  assert.match(notificationIslandSource, /h-13 flex-row-reverse/)
  assert.match(notificationIslandSource, /min\(27rem, calc\(100vw - 8\.5rem\)\)/)
  assert.match(notificationIslandSource, /"3\.25rem"/)
  assert.doesNotMatch(notificationIslandSource, /bg-negative.*rounded-full|absolute -right|9\+|badge/)
})
