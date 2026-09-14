"use client"

import { useEffect, useMemo, useState } from "react"
import { Bell, Check, ChevronDown, ChevronUp, CircleAlert, Clock3, Copy, MoreHorizontal, Trash2, TriangleAlert, WifiOff } from "lucide-react"
import { DrawerShell, OverlayHeader } from "./overlay"
import { cn } from "@/lib/utils"
import { nextNotificationDayNine, notificationCopyText } from "@/lib/notification-state"

type NoticeItem = {
  id: string
  type: "offline" | "health" | "task"
  severity: "warning" | "error" | "critical"
  title: string
  desc: string
  detail: string
  code: string | null
  source: string
  deviceId: string | null
  time: string
  ts: number
  read: boolean
  snoozedUntil: number | null
  groupKey: string
}

type Notice = NoticeItem & {
  count: number
  items?: NoticeItem[]
}

export type NoticePending =
  | { action: "read" | "snooze"; id: string }
  | { action: "readAll" | "clear" }
  | { action: "readGroup" | "snoozeGroup"; groupKey: string }
  | null

type NoticeActionsProps = {
  notice: NoticeItem
  menuId: string
  openMenu: string | null
  pending: NoticePending
  groupUnread?: number
  onOpenMenu: (id: string | null) => void
  onRead: (id: string) => void
  onReadGroup?: (groupKey: string) => void
  onSnooze: (id: string, until: number) => void
  onSnoozeGroup?: (groupKey: string, until: number) => void
}

const severityTone = {
  critical: "text-negative bg-negative/10",
  error: "text-negative bg-negative/10",
  warning: "text-warning bg-warning/10",
} as const

const severityBorder = {
  critical: "border-negative/25",
  error: "border-negative/20",
  warning: "border-warning/20",
} as const

function NoticeGlyph({ notice }: { notice: NoticeItem }) {
  const Icon = notice.type === "offline" ? WifiOff : notice.type === "task" ? CircleAlert : TriangleAlert
  return (
    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", severityTone[notice.severity])}>
      <Icon className="h-5 w-5" />
    </span>
  )
}

function NoticeActions({
  notice,
  menuId,
  openMenu,
  pending,
  groupUnread,
  onOpenMenu,
  onRead,
  onReadGroup,
  onSnooze,
  onSnoozeGroup,
}: NoticeActionsProps) {
  const isGroup = groupUnread !== undefined
  const actionPending = isGroup
    ? pending?.action === "readGroup" && pending.groupKey === notice.groupKey
    : pending?.action === "read" && pending.id === notice.id
  const snoozePending = isGroup
    ? pending?.action === "snoozeGroup" && pending.groupKey === notice.groupKey
    : pending?.action === "snooze" && pending.id === notice.id

  const read = () => {
    onOpenMenu(null)
    if (isGroup) onReadGroup?.(notice.groupKey)
    else onRead(notice.id)
  }
  const snooze = (until: number) => {
    onOpenMenu(null)
    if (isGroup) onSnoozeGroup?.(notice.groupKey, until)
    else onSnooze(notice.id, until)
  }

  return (
    <div className="relative border-t border-border/70 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{notice.source}</span>
        <div className="flex items-center gap-1">
          {(!isGroup ? !notice.read : Boolean(groupUnread)) && (
            <button
              type="button"
              onClick={read}
              disabled={Boolean(pending)}
              className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              {actionPending ? "处理中" : isGroup ? "全部已读" : "标为已读"}
            </button>
          )}
          {!isGroup && (
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(notificationCopyText(notice))}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={`复制“${notice.title}”详情`}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenMenu(openMenu === menuId ? null : menuId)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={`打开“${notice.title}”稍后提醒菜单`}
            aria-expanded={openMenu === menuId}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
      {openMenu === menuId && (
        <div className="absolute right-3 top-10 z-50 flex min-w-40 flex-col rounded-xl border border-border bg-popover p-1 text-xs text-popover-foreground shadow-xl">
          <button type="button" onClick={() => snooze(Date.now() + 3600000)} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted">
            <Clock3 className="h-3.5 w-3.5" />{snoozePending ? "处理中" : "1 小时后提醒"}
          </button>
          <button type="button" onClick={() => snooze(nextNotificationDayNine(Date.now()))} className="rounded-lg px-2.5 py-2 text-left hover:bg-muted">明天 09:00</button>
          <button
            type="button"
            onClick={() => {
              const raw = window.prompt("输入提醒时间（ISO）")
              const value = raw ? Date.parse(raw) : Number.NaN
              if (Number.isFinite(value)) snooze(value)
            }}
            className="rounded-lg px-2.5 py-2 text-left hover:bg-muted"
          >
            自定义时间
          </button>
        </div>
      )}
    </div>
  )
}

function NotificationCard({
  notice,
  pending,
  openMenu,
  menuId,
  stackCount,
  groupUnread,
  expanded,
  onActivate,
  onOpenMenu,
  onRead,
  onReadGroup,
  onSnooze,
  onSnoozeGroup,
}: NoticeActionsProps & {
  stackCount?: number
  expanded?: boolean
  onActivate: () => void
}) {
  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border bg-card shadow-lg shadow-background/20 transition-[opacity,border-color,transform] duration-300",
        severityBorder[notice.severity],
        notice.read && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        disabled={Boolean(pending)}
        aria-expanded={stackCount ? expanded : undefined}
        aria-label={stackCount ? `${expanded ? "收起" : "展开"}${stackCount}条通知` : notice.read ? `${notice.title}，已读` : `将“${notice.title}”标为已读`}
        className="flex w-full items-start gap-3 p-3 text-left disabled:pointer-events-none"
      >
        <NoticeGlyph notice={notice} />
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{notice.title}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{notice.desc}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {stackCount && (
                <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background">{stackCount}</span>
              )}
              {stackCount ? <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-300", expanded && "rotate-180")} /> : !notice.read ? <span className="mt-1 h-2 w-2 rounded-full bg-foreground" /> : null}
            </span>
          </span>
          <span className="mt-2 block border-t border-border/60 pt-2 text-xs leading-5 text-muted-foreground">{notice.detail}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground">
            <span>{notice.time}</span>
            {notice.code && <span>{notice.code}</span>}
            {groupUnread !== undefined && <span>{groupUnread} 条未读</span>}
          </span>
        </span>
      </button>
      <NoticeActions
        notice={notice}
        menuId={menuId}
        openMenu={openMenu}
        pending={pending}
        groupUnread={groupUnread}
        onOpenMenu={onOpenMenu}
        onRead={onRead}
        onReadGroup={onReadGroup}
        onSnooze={onSnooze}
        onSnoozeGroup={onSnoozeGroup}
      />
    </article>
  )
}

export function NotificationsDrawer({
  open,
  onClose,
  notices,
  pending,
  error,
  onRead,
  onReadAll,
  onClear,
  onSnooze,
  onSnoozeGroup,
  onReadGroup,
}: {
  open: boolean
  onClose: () => void
  notices: Notice[]
  pending: NoticePending
  error: string | null
  onRead: (id: string) => void
  onReadAll: () => void
  onClear: () => void
  onSnooze: (id: string, until: number) => void
  onSnoozeGroup: (groupKey: string, until: number) => void
  onReadGroup: (groupKey: string) => void
}) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setExpandedGroup(null)
      setOpenMenu(null)
    }
  }, [open])

  const { total, unread } = useMemo(() => notices.reduce(
    (summary, notice) => {
      const items = notice.items?.length ? notice.items : [notice]
      return {
        total: summary.total + items.length,
        unread: summary.unread + items.filter((item) => !item.read).length,
      }
    },
    { total: 0, unread: 0 },
  ), [notices])

  return (
    <DrawerShell open={open} onClose={onClose} label="通知中心">
      <OverlayHeader
        icon={<Bell className="h-5 w-5" />}
        title="通知中心"
        desc={`共 ${total} 条，${unread === 0 ? "全部已读" : `${unread} 条未读`}`}
        onClose={onClose}
        extra={notices.length > 0 ? (
          <button type="button" onClick={onClear} disabled={Boolean(pending)} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-negative/10 hover:text-negative disabled:opacity-50" aria-label="清空全部通知">
            <Trash2 className="h-4 w-4" />
          </button>
        ) : undefined}
      />

      {error && <p role="alert" className="mx-4 mt-4 rounded-xl border border-negative/20 bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}

      {unread > 0 && (
        <div className="flex shrink-0 justify-end border-b border-border px-4 py-2.5">
          <button type="button" onClick={onReadAll} disabled={Boolean(pending)} className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">
            {pending?.action === "readAll" ? "处理中…" : "全部标为已读"}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {notices.length === 0 ? (
          <div className="flex h-full min-h-80 flex-col items-center justify-center gap-4 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground"><Bell className="h-6 w-6" /></span>
            <p className="text-sm text-muted-foreground">暂无通知，一切正常</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {notices.map((notice) => {
              const items = notice.items?.length ? notice.items : [notice]
              const isStacked = items.length > 1
              const isExpanded = expandedGroup === notice.groupKey
              const groupUnread = items.filter((item) => !item.read).length

              if (!isStacked) {
                return (
                  <li key={notice.id}>
                    <NotificationCard
                      notice={items[0]}
                      pending={pending}
                      menuId={items[0].id}
                      openMenu={openMenu}
                      onOpenMenu={setOpenMenu}
                      onActivate={() => { if (!items[0].read) onRead(items[0].id) }}
                      onRead={onRead}
                      onSnooze={onSnooze}
                    />
                  </li>
                )
              }

              if (isExpanded) {
                return (
                  <li key={notice.groupKey} data-notification-stack="expanded" className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3 px-1 py-1">
                      <span className="text-xs font-medium text-muted-foreground">{items.length} 条独立通知</span>
                      <button type="button" onClick={() => setExpandedGroup(null)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                        收起 <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {items.map((item, index) => (
                      <div key={item.id} className="animate-stack-expand" style={{ animationDelay: `${index * 55}ms` }}>
                        <NotificationCard
                          notice={item}
                          pending={pending}
                          menuId={item.id}
                          openMenu={openMenu}
                          onOpenMenu={setOpenMenu}
                          onActivate={() => { if (!item.read) onRead(item.id) }}
                          onRead={onRead}
                          onSnooze={onSnooze}
                        />
                      </div>
                    ))}
                  </li>
                )
              }

              const topNotice = { ...items[0], read: groupUnread === 0 }
              const backCards = items.slice(1, 3).reverse()
              return (
                <li key={notice.groupKey} data-notification-stack="collapsed" className="pb-4">
                  <div className="relative">
                    {backCards.map((item, index) => {
                      const depth = backCards.length - index
                      return (
                        <div
                          key={item.id}
                          aria-hidden="true"
                          className={cn("pointer-events-none absolute inset-x-0 h-full rounded-2xl border bg-card shadow-md", severityBorder[item.severity])}
                          style={{ transform: `translateY(${depth * 7}px) scale(${1 - depth * 0.025})`, transformOrigin: "top center", opacity: 0.5 + index * 0.18 }}
                        />
                      )
                    })}
                    <div className="relative z-10">
                      <NotificationCard
                        notice={topNotice}
                        pending={pending}
                        menuId={`group:${notice.groupKey}`}
                        openMenu={openMenu}
                        stackCount={items.length}
                        groupUnread={groupUnread}
                        expanded={false}
                        onOpenMenu={setOpenMenu}
                        onActivate={() => { setOpenMenu(null); setExpandedGroup(notice.groupKey) }}
                        onRead={onRead}
                        onReadGroup={onReadGroup}
                        onSnooze={onSnooze}
                        onSnoozeGroup={onSnoozeGroup}
                      />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </DrawerShell>
  )
}
