"use client"

import { useCallback, useReducer, useState, type ReactNode } from "react"
import { ArrowLeft, Bell, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createNotificationPreview, notificationPreviewReducer } from "@/lib/notification-preview"
import { notificationUnreadCount } from "@/lib/notification-state"
import { NotificationsDrawer } from "./notifications-drawer"

export function NotificationPreview({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState(true)
  const [open, setOpen] = useState(true)
  const [revision, setRevision] = useState(0)
  const [notices, dispatch] = useReducer(notificationPreviewReducer, undefined, createNotificationPreview)
  const close = useCallback(() => setOpen(false), [])
  const unread = notificationUnreadCount(notices)
  const total = notices.reduce((count, item) => count + item.count, 0)

  if (!preview) return children

  function reset() {
    dispatch({ type: "reset" })
    setRevision((value) => value + 1)
    setOpen(true)
  }

  return (
    <>
      <main className="flex h-full flex-col overflow-y-auto bg-background p-5 sm:p-8" inert={open} aria-hidden={open}>
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <div className="flex items-center gap-3">
            <Bell aria-hidden="true" className="size-5 text-primary" />
            <span className="font-medium">通知中心 · 虚拟数据预览</span>
          </div>
          <Button variant="ghost" onClick={() => setPreview(false)}>
            <ArrowLeft data-icon="inline-start" />
            返回原面板
          </Button>
        </header>

        <section className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 py-10">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-primary">仅演示，不连接真实设备</p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">点开卡片，看看过渡。</h1>
            <p className="text-sm leading-7 text-muted-foreground">准备了 10 条虚拟通知：3 张独立卡片，以及分别包含 4 条、3 条通知的两组堆叠卡片。支持已读、清空与重置，可以反复体验。</p>
          </div>

          <ol className="flex flex-col gap-4 border-y border-border py-5 text-sm text-muted-foreground">
            <li><span className="mr-3 font-mono text-primary">01</span>点击独立卡片，观察详情高度平滑展开。</li>
            <li><span className="mr-3 font-mono text-primary">02</span>点击堆叠卡片，观察子卡片错峰渐显。</li>
            <li><span className="mr-3 font-mono text-primary">03</span>快速连续点击，观察动画中途反向衔接。</li>
          </ol>

          <div className="flex flex-wrap gap-3">
            <Button size="lg" onClick={() => setOpen(true)}>
              <Bell data-icon="inline-start" />
              打开通知中心
            </Button>
            <Button size="lg" variant="outline" onClick={reset}>
              <RotateCcw data-icon="inline-start" />
              重置虚拟数据
            </Button>
          </div>
          <div className="flex flex-col gap-2 text-xs leading-6 text-muted-foreground">
            <p role="status">当前 {total} 条虚拟通知 · {unread} 条未读</p>
            <p>稍后提醒仅隐藏演示通知，不会实际发送提醒。关闭抽屉后点击「重置虚拟数据」可恢复全部卡片；刷新页面也会重置。</p>
          </div>
        </section>
        <footer className="border-t border-border pt-4 text-xs leading-6 text-muted-foreground">原入口已完整备份，恢复不影响已修复的通知动画。</footer>
      </main>

      <NotificationsDrawer
        key={revision}
        open={open}
        onClose={close}
        notices={notices}
        pending={null}
        error={null}
        onRead={(id) => dispatch({ type: "read", id })}
        onReadAll={() => dispatch({ type: "readAll" })}
        onClear={() => dispatch({ type: "clear" })}
        onReadGroup={(groupKey) => dispatch({ type: "readGroup", groupKey })}
        onSnooze={(id, until) => dispatch({ type: "snooze", id, until })}
        onSnoozeGroup={(groupKey, until) => dispatch({ type: "snoozeGroup", groupKey, until })}
      />
    </>
  )
}
