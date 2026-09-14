"use client"

import { useState } from "react"
import { Bell, CalendarClock, CheckCheck, ChevronDown, Copy, HeartPulse, Loader2, ServerOff, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { DrawerShell, OverlayHeader } from "./overlay"
import { nextNotificationDayNine, notificationCopyText, notificationUnreadCount } from "@/lib/notification-state"

export type NoticeType = "offline" | "health" | "task"

export type Notice = {
  id: string
  type: NoticeType
  title: string
  desc: string
  detail: string
  severity: "warning" | "error" | "critical"
  code: string | null
  source: string
  deviceId: string | null
  snoozedUntil: number | null
  groupKey: string
  time: string
  read: boolean
}

export type GroupedNotice = Notice & {
  count: number
  items?: Notice[]
}

export type NoticePending =
  | { action: "read"; id: string }
  | { action: "readAll" }
  | { action: "clear" }
  | { action: "snooze"; id: string }
  | { action: "snoozeGroup"; groupKey: string }
  | { action: "readGroup"; groupKey: string }
  | null

/** 通知数据由面板定时从服务端 API 刷新，不再内置模拟数据 */
export const initialNotices: Notice[] = []

const typeMeta: Record<NoticeType, { icon: React.ReactNode; tone: string }> = {
  offline: { icon: <ServerOff className="h-4 w-4" />, tone: "bg-negative/12 text-negative" },
  health: { icon: <HeartPulse className="h-4 w-4" />, tone: "bg-warning/12 text-warning" },
  task: { icon: <CalendarClock className="h-4 w-4" />, tone: "bg-primary/12 text-primary" },
}

/** 通知中心抽屉：聚合客户端离线、健康告警、任务失败与插件更新 */
export function NotificationsDrawer({
  open,
  onClose,
  notices,
  pending,
  error,
  onRead,
  onReadAll,
  onClear, onSnooze, onSnoozeGroup, onReadGroup,
}: {
  open: boolean
  onClose: () => void
  notices: GroupedNotice[]
  pending: NoticePending
  error: string | null
  onRead: (id: string) => void
  onReadAll: () => void
  onClear: () => void
  onSnooze: (id: string, until: number) => void
  onSnoozeGroup: (groupKey: string, until: number) => void
  onReadGroup: (groupKey: string) => void
}) {
  const [expanded, setExpanded] = useState<Map<string, boolean>>(new Map())
  const [copied, setCopied] = useState<string | null>(null)
  const unread = notificationUnreadCount(notices)
  const totalCount = notices.reduce((sum, n) => sum + n.count, 0)

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Map(prev)
      next.set(id, !prev.get(id))
      return next
    })
  }
  const snoozeUntil = (kind: "hour" | "tomorrow") => kind === "hour" ? Date.now() + 3600000 : nextNotificationDayNine(Date.now())
  const copyDetail = async (n: Notice) => { await navigator.clipboard?.writeText(notificationCopyText(n)); setCopied(n.id); window.setTimeout(() => setCopied(null), 1200) }

  return (
    <DrawerShell open={open} onClose={onClose} label="通知中心">
      <OverlayHeader
        icon={<Bell className="h-5 w-5" />}
        title="通知中心"
        desc={unread > 0 ? `${unread} 条未读 · 共 ${totalCount} 条` : `共 ${totalCount} 条，全部已读`}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error && (
          <p role="alert" className="mb-3 rounded-xl border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative">
            {error}
          </p>
        )}
        {notices.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface">
              <Bell className="h-6 w-6" />
            </span>
            <p className="text-sm">暂无通知，一切正常</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {notices.map((n) => {
              const isExpanded = expanded.get(n.id) || false
              const isStacked = n.count > 1
              
              return (
                <li key={n.id} className="relative">
                  {/* 堆叠视觉：底层阴影卡片 */}
                  {isStacked && !isExpanded && (
                    <>
                      <div className="absolute inset-0 translate-y-1 rounded-2xl bg-surface/30 shadow-sm" style={{ zIndex: -2 }} />
                      <div className="absolute inset-0 translate-y-0.5 rounded-2xl bg-surface/50 shadow-sm" style={{ zIndex: -1 }} />
                    </>
                  )}
                  
                  {/* 主卡片 */}
                  <button
                    type="button"
                    onClick={() => { if (isStacked) toggleExpand(n.id); else { toggleExpand(n.id); if (!n.read) onRead(n.id) } }}
                    disabled={Boolean(pending)}
                    className={cn(
                      "relative flex w-full items-start gap-3 rounded-2xl p-3 text-left transition-all disabled:pointer-events-none",
                      n.read && !isStacked ? "opacity-60" : "bg-surface/50 hover:bg-surface shadow-sm",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                        typeMeta[n.type].tone,
                      )}
                    >
                      {pending?.action === "read" && pending.id === n.id ? <Loader2 className="h-4 w-4 animate-spin" /> : typeMeta[n.type].icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{n.title}</span>
                        {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="未读" />}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{n.desc}</span>
                      <span className="mt-1 block text-[11px] text-muted-foreground/70">{n.time} · {n.severity}</span>
                    </span>
                    
                    {/* 堆叠角标 */}
                    {isStacked && (
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                          共 {n.count} 条
                        </span>
                        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                      </span>
                    )}
                  </button>
                  {isExpanded && (
                    <div className="mt-1 flex items-center gap-2 px-3 pb-2 text-[11px] text-muted-foreground">
                      {n.code && <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{n.code}</span>}
                      <span>{n.source}{n.deviceId ? ` · ${n.deviceId}` : ""}</span>
                      <pre className="max-w-[55%] whitespace-pre-wrap rounded bg-background/50 p-1.5 font-mono text-[10px]">{n.detail}</pre>
                      <button type="button" onClick={() => void copyDetail(n)} className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-muted"><Copy className="h-3 w-3" />{copied === n.id ? "已复制" : "复制详情"}</button>
                      <button type="button" onClick={() => onSnooze(n.id, snoozeUntil("hour"))} className="rounded px-2 py-1 hover:bg-muted">1 小时</button>
                      <button type="button" onClick={() => onSnooze(n.id, snoozeUntil("tomorrow"))} className="rounded px-2 py-1 hover:bg-muted">明天 09:00</button>
                      <button type="button" onClick={() => { const raw = window.prompt("输入提醒时间（ISO）"); const value = raw ? Date.parse(raw) : NaN; if (Number.isFinite(value)) onSnooze(n.id, value) }} className="rounded px-2 py-1 hover:bg-muted">自定义</button>
                    </div>
                  )}
                  
                  {/* 展开的子条目列表 */}
                  {isStacked && isExpanded && n.items && (
                    <ul className="mt-1.5 flex flex-col gap-1 animate-stack-expand">
                      {n.items.map((item, idx) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => onRead(item.id)}
                            disabled={Boolean(pending) || item.read}
                            className={cn(
                              "flex w-full items-start gap-3 rounded-xl p-2.5 text-left transition-colors disabled:pointer-events-none",
                              item.read ? "opacity-60" : "bg-muted/50 hover:bg-muted",
                            )}
                            style={{
                              animationDelay: `${idx * 50}ms`,
                            }}
                          >
                            <span className="min-w-0 flex-1 pl-12">
                              <span className="flex items-center gap-2">
                                <span className="text-xs font-medium">{item.title}</span>
                                {!item.read && <span className="h-1 w-1 shrink-0 rounded-full bg-primary" aria-label="未读" />}
                              </span>
                              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{item.desc}</span>
                              <pre className="mt-1 whitespace-pre-wrap rounded bg-background/50 p-1.5 font-mono text-[10px]">{item.detail}</pre>
                              <span className="mt-0.5 block text-[10px] text-muted-foreground/70">{item.time}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {isStacked && isExpanded && <div className="ml-12 mt-1 flex gap-2"><button type="button" onClick={() => onReadGroup(n.groupKey)} className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">整组已读</button><button type="button" onClick={() => onSnoozeGroup(n.groupKey, snoozeUntil("hour"))} className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">整组 1 小时</button><button type="button" onClick={() => onSnoozeGroup(n.groupKey, snoozeUntil("tomorrow"))} className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">整组明天</button></div>}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {notices.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-3 sm:px-4">
          <button
            type="button"
            onClick={onClear}
            disabled={Boolean(pending)}
            className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-negative/12 hover:text-negative disabled:pointer-events-none disabled:opacity-40"
          >
            {pending?.action === "clear" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            清空
          </button>
          <button
            type="button"
            onClick={onReadAll}
            disabled={unread === 0 || Boolean(pending)}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
          >
            {pending?.action === "readAll" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
            全部已读
          </button>
        </div>
      )}
    </DrawerShell>
  )
}
