import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { createNotificationPreview, notificationPreviewReducer } from "../lib/notification-preview"
import { notificationUnreadCount } from "../lib/notification-state"

test("虚拟通知包含 3 张独立卡片和两组堆叠，共 10 条", () => {
  const notices = createNotificationPreview()
  assert.equal(notices.length, 5)
  assert.equal(notices.filter((item) => item.count === 1).length, 3)
  assert.deepEqual(notices.filter((item) => item.items).map((item) => item.count), [4, 3])
  assert.equal(notices.reduce((sum, item) => sum + item.count, 0), 10)
  assert.equal(notificationUnreadCount(notices), 8)
  const ids = notices.flatMap((item) => [item.id, ...(item.items?.map((child) => child.id) ?? [])])
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.every((id) => id.startsWith("demo-")))
  assert.ok(notices.every((item) => item.source === "虚拟演示"))
})

test("独立通知、子通知和整组已读只更新演示副本", () => {
  const original = createNotificationPreview()
  let notices = notificationPreviewReducer(original, { type: "read", id: "demo-single-offline" })
  assert.equal(notificationUnreadCount(notices), 7)
  notices = notificationPreviewReducer(notices, { type: "read", id: "demo-health-1" })
  assert.equal(notificationUnreadCount(notices), 6)
  assert.equal(notices[1].read, false)
  notices = notificationPreviewReducer(notices, { type: "readGroup", groupKey: "demo-health-group" })
  assert.equal(notificationUnreadCount(notices), 4)
  assert.equal(notices[1].read, true)
  assert.equal(notices[1].id, original[1].id)
  assert.equal(notificationUnreadCount(original), 8)
  assert.equal(notificationUnreadCount(notificationPreviewReducer(notices, { type: "readAll" })), 0)
})

test("演示清空、稍后提醒与重置无需真实服务", () => {
  const original = createNotificationPreview()
  const until = Date.now() + 3600000
  const hidden = notificationPreviewReducer(original, { type: "snooze", id: "demo-single-offline", until })
  assert.equal(hidden.length, 4)
  const groupHidden = notificationPreviewReducer(hidden, { type: "snoozeGroup", groupKey: "demo-health-group", until })
  assert.equal(groupHidden.length, 3)
  assert.deepEqual(notificationPreviewReducer(groupHidden, { type: "clear" }), [])
  assert.deepEqual(notificationPreviewReducer([], { type: "reset" }), original)
  assert.equal(notificationPreviewReducer(original, { type: "snooze", id: original[0].id, until: NaN }), original)
  assert.equal(notificationPreviewReducer(original, { type: "snooze", id: original[0].id, until: 0 }), original)
})

test("原入口完整备份，可覆盖恢复且不撤销动画修复", () => {
  const backup = readFileSync(new URL("../../backups/notification-preview/nacho-panel/app/layout.tsx.bak", import.meta.url))
  assert.equal(createHash("sha256").update(backup).digest("hex"), "c09250466647fbd10587d12f6c2de6b315fd24ecb8b6b971b9f58c4d5ae0857b")
  assert.doesNotMatch(backup.toString(), /NotificationPreview/)
  const preview = readFileSync(new URL("../components/topbar/notification-preview.tsx", import.meta.url), "utf8")
  const data = readFileSync(new URL("../lib/notification-preview.ts", import.meta.url), "utf8")
  assert.doesNotMatch(`${preview}\n${data}`, /useServerData|apiRequest|fetch\(|localStorage|sessionStorage/)
})
