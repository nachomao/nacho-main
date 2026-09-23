"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Bell, Check, ChevronDown, Clock3, Copy, FileText, MoreHorizontal, Trash2, TriangleAlert, WifiOff, CircleAlert } from "lucide-react"
import { DrawerShell, OverlayHeader } from "./overlay"
import { cn } from "@/lib/utils"
import { nextNotificationDayNine, notificationCopyText } from "@/lib/notification-state"
import { playNotificationAnimation } from "@/lib/notification-animation"

type NoticeItem = {
  id: string
  type: "offline" | "health" | "task" | "log"
  severity: "info" | "warning" | "error" | "critical"
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

type CardStage = "compact" | "full" | "log"

export type NoticePending =
  | { action: "read" | "snooze"; id: string }
  | { action: "readAll" | "clear" }
  | { action: "readGroup" | "snoozeGroup"; groupKey: string }
  | null

type ItemActionProps = {
  notice: NoticeItem
  openMenu: string | null
  pending: NoticePending
  onOpenMenu: (id: string | null) => void
  onRead: (id: string) => void
  onSnooze: (id: string, until: number) => void
}

const severityTone = {
  info: "text-positive bg-positive/10",
  critical: "text-negative bg-negative/10",
  error: "text-negative bg-negative/10",
  warning: "text-warning bg-warning/10",
} as const

const severityBorder = {
  info: "border-positive/25",
  critical: "border-negative/30",
  error: "border-negative/25",
  warning: "border-warning/25",
} as const

const springTiming = {
  duration: 620,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
} as const

function formatRelativeTime(timestamp: number) {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}

function NoticeGlyph({ notice, count }: { notice: NoticeItem; count?: number }) {
  const Icon = notice.type === "offline" ? WifiOff : notice.type === "task" ? CircleAlert : notice.type === "log" ? Clock3 : TriangleAlert
  return (
    <span className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted/85 text-foreground shadow-inner shadow-foreground/5">
      <Icon className={cn("size-5", severityTone[notice.severity].split(" ")[0])} />
      {count && count > 1 ? (
        <span className="absolute -right-2 -top-2 flex min-w-6 items-center justify-center rounded-full bg-foreground px-1.5 py-0.5 text-xs font-bold text-background shadow-md">
          {count}
        </span>
      ) : null}
    </span>
  )
}

function ItemActions({ notice, openMenu, pending, onOpenMenu, onRead, onSnooze }: ItemActionProps) {
  const readPending = pending?.action === "read" && pending.id === notice.id
  const snoozePending = pending?.action === "snooze" && pending.id === notice.id

  const snooze = (until: number) => {
    onOpenMenu(null)
    onSnooze(notice.id, until)
  }

  return (
    <div className="relative border-t border-border/60 px-4 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{notice.source}</span>
        <div className="flex items-center gap-1">
          {!notice.read ? (
            <button
              type="button"
              onClick={() => onRead(notice.id)}
              disabled={Boolean(pending)}
              className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <Check className="size-3.5" />
              {readPending ? "处理中" : "标为已读"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(notificationCopyText(notice))}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={`复制“${notice.title}”详情`}
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onOpenMenu(openMenu === notice.id ? null : notice.id)}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={`打开“${notice.title}”稍后提醒菜单`}
            aria-expanded={openMenu === notice.id}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </div>
      </div>
      {openMenu === notice.id ? (
        <div className="absolute right-3 top-10 z-50 flex min-w-40 flex-col rounded-xl border border-border bg-popover p-1 text-xs text-popover-foreground shadow-xl">
          <button type="button" onClick={() => snooze(Date.now() + 3_600_000)} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted">
            <Clock3 className="size-3.5" />{snoozePending ? "处理中" : "1 小时后提醒"}
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
      ) : null}
    </div>
  )
}

function NotificationCard({
  notice,
  pending,
  openMenu,
  stackCount,
  forceCompact = false,
  interactive = true,
  onExpandStack,
  onOpenMenu,
  onRead,
  onSnooze,
}: ItemActionProps & {
  stackCount?: number
  forceCompact?: boolean
  interactive?: boolean
  onExpandStack?: () => void
}) {
  const [stage, setStage] = useState<CardStage>("compact")
  const cardRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const previousHeight = useRef<number | null>(null)
  const visibleStage = forceCompact ? "compact" : stage

  // 堆叠卡片收起时同步重置子卡片阶段，重新展开后从紧凑态开始，避免展开内容残留导致布局抖动。
  useEffect(() => {
    if (forceCompact && stage !== "compact") {
      previousHeight.current = null
      setStage("compact")
    }
  }, [forceCompact, stage])

  useLayoutEffect(() => {
    const card = cardRef.current
    const from = previousHeight.current
    previousHeight.current = null
    if (!card || from === null) return
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const to = card.getBoundingClientRect().height
    const cleanups = [
      playNotificationAnimation(
        card,
        reducedMotion
          ? [{ opacity: 0.6 }, { opacity: 1 }]
          : [{ height: `${from}px` }, { height: `${to}px` }],
        reducedMotion ? { duration: 160, easing: "ease-out" } : springTiming,
      ),
    ]
    if (panelRef.current && !reducedMotion) {
      cleanups.push(playNotificationAnimation(
        panelRef.current,
        [{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 340, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      ))
    }

    return () => cleanups.forEach((cleanup) => cleanup())
  }, [visibleStage])

  const advanceCard = () => {
    if (!interactive || pending) return
    if (onExpandStack) {
      onExpandStack()
      return
    }
    previousHeight.current = cardRef.current?.getBoundingClientRect().height ?? null
    if (stage === "compact") {
      setStage("full")
      if (!notice.read) onRead(notice.id)
      return
    }
    setStage(stage === "full" ? "log" : "compact")
  }

  const nextAction = visibleStage === "compact" ? "展开完整内容" : visibleStage === "full" ? "查看详细日志" : "收起通知"

  return (
    <article
      ref={cardRef}
      data-notification-stage={visibleStage}
      className={cn(
        "relative isolate overflow-hidden rounded-3xl border bg-card/[0.94] bg-clip-padding shadow-xl shadow-background/30 backdrop-blur-[36px] backdrop-saturate-150 transition-[border-color,box-shadow,filter] duration-500",
        severityBorder[notice.severity],
        visibleStage !== "compact" && "shadow-2xl shadow-background/40",
      )}
    >
      <button
        type="button"
        onClick={advanceCard}
        disabled={!interactive || Boolean(pending)}
        aria-expanded={onExpandStack ? false : visibleStage !== "compact"}
        aria-label={`${notice.title}，${nextAction}`}
        className={cn(
          "relative z-10 flex w-full items-start gap-3.5 text-left disabled:pointer-events-none",
          visibleStage === "compact" ? "min-h-24 p-4" : "p-4 pb-3",
        )}
      >
        <NoticeGlyph notice={notice} count={stackCount} />
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold tracking-tight text-foreground">{notice.title}</span>
              <span className={cn("mt-1 block text-sm leading-5 text-muted-foreground", visibleStage === "compact" && "line-clamp-1")}>{notice.desc}</span>
            </span>
            <span className="shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">{formatRelativeTime(notice.ts)}</span>
          </span>
          {visibleStage !== "compact" ? (
            <span className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              {visibleStage === "full" ? "再次点击查看详细日志" : "点击收起通知"}
              <ChevronDown className={cn("size-3.5 transition-transform duration-500", visibleStage === "log" && "rotate-180")} />
            </span>
          ) : null}
        </span>
      </button>

      {visibleStage !== "compact" ? (
        <div ref={panelRef} className="relative z-10">
          {visibleStage === "full" ? (
            <div className="border-t border-border/60 px-4 py-3 text-sm leading-6 text-muted-foreground">
              <p>{notice.detail}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-xs">
                <span>{notice.time}</span>
                {notice.code ? <span className="rounded-md bg-muted px-2 py-0.5">{notice.code}</span> : null}
              </div>
            </div>
          ) : (
            <div className="border-t border-border/60 px-4 py-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileText className="size-4 text-muted-foreground" />事件详细日志
              </div>
              <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 rounded-2xl bg-muted/60 p-3 font-mono text-xs leading-5">
                <dt className="text-muted-foreground">时间</dt><dd className="break-all text-foreground">{notice.time}</dd>
                <dt className="text-muted-foreground">来源</dt><dd className="break-all text-foreground">{notice.source}</dd>
                <dt className="text-muted-foreground">设备</dt><dd className="break-all text-foreground">{notice.deviceId || "未关联"}</dd>
                <dt className="text-muted-foreground">事件代码</dt><dd className="break-all text-foreground">{notice.code || "N/A"}</dd>
                <dt className="text-muted-foreground">分组键</dt><dd className="break-all text-foreground">{notice.groupKey}</dd>
                <dt className="text-muted-foreground">日志正文</dt><dd className="break-words text-foreground">{notice.detail}</dd>
              </dl>
            </div>
          )}
          <ItemActions notice={notice} openMenu={openMenu} pending={pending} onOpenMenu={onOpenMenu} onRead={onRead} onSnooze={onSnooze} />
        </div>
      ) : null}
    </article>
  )
}

function NotificationStack({
  notice,
  expanded: requestedExpanded,
  pending,
  openMenu,
  onToggle,
  onOpenMenu,
  onRead,
  onReadGroup,
  onSnooze,
}: {
  notice: Notice
  expanded: boolean
  pending: NoticePending
  openMenu: string | null
  onToggle: () => void
  onOpenMenu: (id: string | null) => void
  onRead: (id: string) => void
  onReadGroup: (groupKey: string) => void
  onSnooze: (id: string, until: number) => void
}) {
  const items = notice.items?.length ? notice.items : [notice]
  const [expanded, setExpanded] = useState(requestedExpanded)
  const groupUnread = items.filter((item) => !item.read).length
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const activeAnimations = useRef<Array<() => void>>([])
  const layoutSnapshot = useRef<{
    height: number
    cards: Map<string, { rect: DOMRect; opacity: string }>
  } | null>(null)
  const visibleDepth = Math.min(items.length, 4)
  const collapsedHeight = 98 + (visibleDepth - 1) * 12

  useLayoutEffect(() => {
    if (requestedExpanded === expanded) return
    const container = containerRef.current
    if (!container) return
    const cards = new Map<string, { rect: DOMRect; opacity: string }>()
    cardRefs.current.forEach((card, id) => {
      cards.set(id, { rect: card.getBoundingClientRect(), opacity: getComputedStyle(card).opacity })
    })
    layoutSnapshot.current = { height: container.getBoundingClientRect().height, cards }
    activeAnimations.current.forEach((cancel) => cancel())
    activeAnimations.current = []
    setExpanded(requestedExpanded)
  }, [requestedExpanded, expanded])

  useLayoutEffect(() => {
    const snapshot = layoutSnapshot.current
    const container = containerRef.current
    // 父级切换目标时先采集旧布局，下一次提交才播放新布局，轮询不能清理正在播放的动画。
    if (!snapshot || !container || expanded !== requestedExpanded) return
    layoutSnapshot.current = null
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const nextHeight = container.getBoundingClientRect().height
    const destinations = items.flatMap((item, index) => {
      const card = cardRefs.current.get(item.id)
      const before = snapshot.cards.get(item.id)
      return card && before ? [{ card, before, after: card.getBoundingClientRect(), opacity: getComputedStyle(card).opacity, index }] : []
    })

    const cleanups = [playNotificationAnimation(
      container,
      reducedMotion
        ? [{ opacity: 0.6 }, { opacity: 1 }]
        : [{ height: `${snapshot.height}px` }, { height: `${nextHeight}px` }],
      reducedMotion ? { duration: 160, easing: "ease-out" } : springTiming,
    )]

    if (!reducedMotion) destinations.forEach(({ card, before, after, opacity, index }) => {
      const deltaX = before.rect.left - after.left
      const deltaY = before.rect.top - after.top
      const scaleX = before.rect.width / Math.max(after.width, 1)
      const scaleY = before.rect.height / Math.max(after.height, 1)
      cleanups.push(playNotificationAnimation(
        card,
        [
          // 收起时首卡可能正处于 full/log 高度，直接做 Y 缩放会把它瞬间放大成巨卡；
          // 保留位移过渡，让内容先回到 compact 高度，再平滑归位。
          { transform: `translate(${deltaX}px, ${deltaY}px) scale(${expanded || index !== 0 ? scaleX : 1}, ${expanded || index !== 0 ? scaleY : 1})`, opacity: before.opacity },
          { transform: "none", opacity },
        ],
        { ...springTiming, delay: expanded ? Math.min(index, 7) * 48 : Math.min(items.length - index - 1, 7) * 24 },
      ))
    })
    activeAnimations.current = cleanups
  }, [expanded, requestedExpanded, items])

  useLayoutEffect(() => () => {
    activeAnimations.current.forEach((cancel) => cancel())
  }, [])

  return (
    <li data-notification-stack={expanded ? "expanded" : "collapsed"}>
      <div inert={!expanded} aria-hidden={!expanded} className={cn("grid transition-[grid-template-rows,opacity] duration-500", expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-1 pb-2">
            <span className="text-xs font-medium text-muted-foreground">{items.length} 条通知</span>
            <div className="flex items-center gap-2">
              {groupUnread ? <button type="button" onClick={() => onReadGroup(notice.groupKey)} className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">全部已读</button> : null}
              <button type="button" onClick={onToggle} className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">收起</button>
            </div>
          </div>
        </div>
      </div>
      <div
        ref={containerRef}
        className={cn("relative", expanded && "flex flex-col gap-3")}
        style={{ height: expanded ? "auto" : `${collapsedHeight}px` }}
      >
        {items.map((item, index) => {
          const depth = Math.min(index, 3)
          return (
            <div
              key={item.id}
              ref={(node) => { if (node) cardRefs.current.set(item.id, node); else cardRefs.current.delete(item.id) }}
              data-stack-card={item.id}
              className={cn("origin-top-left shrink-0", !expanded && "absolute")}
              style={expanded ? {
                position: "relative",
                zIndex: 1,
              } : {
                top: `${depth * 12}px`,
                left: `${depth * 5}px`,
                right: `${depth * 5}px`,
                zIndex: items.length - index,
                opacity: index > 3 ? 0 : 1,
                pointerEvents: index === 0 ? "auto" : "none",
              }}
              aria-hidden={!expanded && index > 0}
            >
              <NotificationCard
                notice={item}
                pending={pending}
                openMenu={openMenu}
                stackCount={!expanded && index === 0 ? items.length : undefined}
                forceCompact={!expanded}
                interactive={expanded || index === 0}
                onExpandStack={!expanded && index === 0 ? onToggle : undefined}
                onOpenMenu={onOpenMenu}
                onRead={onRead}
                onSnooze={onSnooze}
              />
            </div>
          )
        })}
      </div>
    </li>
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
        icon={<Bell className="size-5" />}
        title="通知中心"
        desc={`共 ${total} 条，${unread === 0 ? "全部已读" : `${unread} 条未读`}`}
        onClose={onClose}
        extra={notices.length > 0 ? (
          <button type="button" onClick={onClear} disabled={Boolean(pending)} className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-negative/10 hover:text-negative disabled:opacity-50" aria-label="清空全部通知">
            <Trash2 className="size-4" />
          </button>
        ) : undefined}
      />

      {error ? <p role="alert" className="mx-4 mt-4 rounded-xl border border-negative/20 bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p> : null}

      {unread > 0 ? (
        <div className="flex shrink-0 justify-end border-b border-border px-4 py-2.5">
          <button type="button" onClick={onReadAll} disabled={Boolean(pending)} className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">
            {pending?.action === "readAll" ? "处理中…" : "全部标为已读"}
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {notices.length === 0 ? (
          <div className="flex h-full min-h-80 flex-col items-center justify-center gap-4 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"><Bell className="size-6" /></span>
            <p className="text-sm text-muted-foreground">暂无通知，一切正常</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {notices.map((notice) => {
              const items = notice.items?.length ? notice.items : [notice]
              if (items.length > 1) {
                return (
                  <NotificationStack
                    key={notice.groupKey}
                    notice={notice}
                    expanded={expandedGroup === notice.groupKey}
                    pending={pending}
                    openMenu={openMenu}
                    onToggle={() => { setOpenMenu(null); setExpandedGroup((current) => current === notice.groupKey ? null : notice.groupKey) }}
                    onOpenMenu={setOpenMenu}
                    onRead={onRead}
                    onReadGroup={onReadGroup}
                    onSnooze={onSnooze}
                  />
                )
              }
              return (
                <li key={notice.id}>
                  <NotificationCard
                    notice={items[0]}
                    pending={pending}
                    openMenu={openMenu}
                    onOpenMenu={setOpenMenu}
                    onRead={onRead}
                    onSnooze={onSnooze}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </DrawerShell>
  )
}
