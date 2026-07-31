"use client"

import { Bell, CalendarClock, CheckCheck, HeartPulse, Puzzle, ServerOff, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { DrawerShell, OverlayHeader } from "./overlay"

export type NoticeType = "offline" | "health" | "task" | "plugin"

export type Notice = {
  id: string
  type: NoticeType
  title: string
  desc: string
  time: string
  read: boolean
}

/** 通知数据由服务端 API 推送，面板不再内置模拟数据 */
export const initialNotices: Notice[] = []

const typeMeta: Record<NoticeType, { icon: React.ReactNode; tone: string }> = {
  offline: { icon: <ServerOff className="h-4 w-4" />, tone: "bg-negative/12 text-negative" },
  health: { icon: <HeartPulse className="h-4 w-4" />, tone: "bg-warning/12 text-warning" },
  task: { icon: <CalendarClock className="h-4 w-4" />, tone: "bg-primary/12 text-primary" },
  plugin: { icon: <Puzzle className="h-4 w-4" />, tone: "bg-accent/12 text-accent" },
}

/** 通知中心抽屉：聚合客户端离线、健康告警、任务失败与插件更新 */
export function NotificationsDrawer({
  open,
  onClose,
  notices,
  onRead,
  onReadAll,
  onClear,
}: {
  open: boolean
  onClose: () => void
  notices: Notice[]
  onRead: (id: string) => void
  onReadAll: () => void
  onClear: () => void
}) {
  const unread = notices.filter((n) => !n.read).length

  return (
    <DrawerShell open={open} onClose={onClose} label="通知中心">
      <OverlayHeader
        icon={<Bell className="h-5 w-5" />}
        title="通知中心"
        desc={unread > 0 ? `${unread} 条未读 · 共 ${notices.length} 条` : `共 ${notices.length} 条，全部已读`}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {notices.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface">
              <Bell className="h-6 w-6" />
            </span>
            <p className="text-sm">暂无通知，一切正常</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {notices.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onRead(n.id)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-2xl p-3 text-left transition-colors",
                    n.read ? "opacity-60 hover:bg-surface/60 hover:opacity-80" : "bg-surface/50 hover:bg-surface",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                      typeMeta[n.type].tone,
                    )}
                  >
                    {typeMeta[n.type].icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{n.title}</span>
                      {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="未读" />}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{n.desc}</span>
                    <span className="mt-1 block text-[11px] text-muted-foreground/70">{n.time}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {notices.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-3 sm:px-4">
          <button
            type="button"
            onClick={onClear}
            className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-negative/12 hover:text-negative"
          >
            <Trash2 className="h-4 w-4" />
            清空
          </button>
          <button
            type="button"
            onClick={onReadAll}
            disabled={unread === 0}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
          >
            <CheckCheck className="h-4 w-4" />
            全部已读
          </button>
        </div>
      )}
    </DrawerShell>
  )
}
