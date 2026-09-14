import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { canApplyNotificationSnapshot, nextNotificationDayNine, notificationCopyText, notificationUnreadCount } from "../lib/notification-state"

const drawerSource = readFileSync(new URL("../components/topbar/notifications-drawer.tsx", import.meta.url), "utf8")
const serverDataSource = readFileSync(new URL("../components/server-data-context.tsx", import.meta.url), "utf8")

test("通知轮询快照仅在 mutation epoch 未变化时生效", () => {
  assert.equal(canApplyNotificationSnapshot(3, 3), true)
  assert.equal(canApplyNotificationSnapshot(3, 4), false)
})

test("通知未读数按组内条目统计", () => {
  assert.equal(notificationUnreadCount([{ read: false }, { read: false, items: [{ read: false }, { read: true }] }]), 2)
})

test("稍后提醒和复制详情生成稳定结果", () => {
  const from = new Date(2026, 8, 14, 22, 30).getTime()
  const next = new Date(nextNotificationDayNine(from))
  assert.equal(next.getDate(), 15)
  assert.equal(next.getHours(), 9)
  assert.equal(notificationCopyText({ title: "失败", detail: "详情", code: "E1" }), "失败\n详情\nCode: E1")
})

test("通知组以同一批卡片执行 iOS 式弹簧堆叠过渡", () => {
  assert.match(drawerSource, /data-notification-stack=\{expanded \? "expanded" : "collapsed"\}/)
  assert.match(drawerSource, /data-stack-card=\{item\.id\}/)
  assert.match(drawerSource, /layoutSnapshot/)
  assert.match(drawerSource, /card\.animate/)
  assert.match(drawerSource, /cubic-bezier\(0\.22, 1, 0\.36, 1\)/)
  assert.match(drawerSource, /items\.map\(\(item, index\)/)
})

test("单张通知依次展开完整内容和详细日志", () => {
  assert.match(drawerSource, /type CardStage = "compact" \| "full" \| "log"/)
  assert.match(drawerSource, /data-notification-stage=\{visibleStage\}/)
  assert.match(drawerSource, /setStage\("full"\)/)
  assert.match(drawerSource, /setStage\(stage === "full" \? "log" : "compact"\)/)
  assert.match(drawerSource, /事件详细日志/)
})

test("通知卡片使用独立高遮蔽玻璃层阻止后层文字透出", () => {
  assert.match(drawerSource, /bg-card\/\[0\.94\] backdrop-blur-\[36px\] backdrop-saturate-150/)
  assert.match(drawerSource, /relative z-10 flex w-full/)
  assert.doesNotMatch(drawerSource, /notice\.read && "opacity-75"/)
})

test("通知中心预置一组堆叠通知和两条独立通知", () => {
  assert.match(serverDataSource, /createMockNotifications/)
  assert.match(serverDataSource, /count: infrastructureItems\.length, items: infrastructureItems/)
  assert.match(serverDataSource, /mock-notice-task/)
  assert.match(serverDataSource, /mock-notice-recovered/)
})
