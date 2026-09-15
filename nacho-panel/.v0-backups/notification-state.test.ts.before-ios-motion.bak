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

test("通知组以真实卡片纵深堆叠并展开为独立卡片", () => {
  assert.match(drawerSource, /data-notification-stack="collapsed"/)
  assert.match(drawerSource, /data-notification-stack="expanded"/)
  assert.match(drawerSource, /aria-expanded=\{stackCount \? expanded/)
  assert.match(drawerSource, /backCards\.map/)
  assert.match(drawerSource, /items\.map\(\(item, index\)/)
  assert.doesNotMatch(drawerSource, /展开的子条目列表/)
})

test("通知中心预置一组堆叠通知和两条独立通知", () => {
  assert.match(serverDataSource, /createMockNotifications/)
  assert.match(serverDataSource, /count: infrastructureItems\.length, items: infrastructureItems/)
  assert.match(serverDataSource, /mock-notice-task/)
  assert.match(serverDataSource, /mock-notice-recovered/)
})
