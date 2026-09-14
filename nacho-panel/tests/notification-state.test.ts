import assert from "node:assert/strict"
import { test } from "node:test"
import { canApplyNotificationSnapshot, nextNotificationDayNine, notificationCopyText, notificationUnreadCount } from "../lib/notification-state"

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
