export function canApplyNotificationSnapshot(requestEpoch: number, currentEpoch: number): boolean {
  return requestEpoch === currentEpoch
}

export function nextNotificationDayNine(from: number): number {
  const value = new Date(from)
  value.setDate(value.getDate() + 1)
  value.setHours(9, 0, 0, 0)
  return value.getTime()
}

export function notificationUnreadCount(items: Array<{ read: boolean; items?: Array<{ read: boolean }> }>): number {
  return items.reduce((sum, item) => sum + (item.items ? item.items.filter((child) => !child.read).length : item.read ? 0 : 1), 0)
}

export function notificationCopyText(item: { title: string; detail: string; code: string | null }): string {
  return `${item.title}\n${item.detail}${item.code ? `\nCode: ${item.code}` : ""}`
}
