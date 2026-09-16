"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Plus,
  X,
  SlidersHorizontal,
  Database,
  SquareTerminal,
  Sparkles,
  Search,
  DownloadCloud,
  FolderInput,
  ListChecks,
  CalendarPlus,
  ChevronDown,
  Monitor,
  Terminal,
  Pause,
  Play,
  Download,
  Trash2,
  RefreshCw,
  Settings2,
} from "lucide-react"
import { clientTabs, useClientTabs } from "./clients/clients-context"
import { useTopbarActions } from "./topbar/topbar-actions-context"
import { usePlugins } from "./plugins/plugins-context"
import { useTasks } from "./tasks/tasks-context"
import { useLogs } from "./logs/logs-context"
import { useOnboarding } from "./onboarding/onboarding-context"
import { getAvatar } from "./onboarding/avatars"
import { PixelStardust } from "./pixel-stardust"
import { useServerData } from "@/components/server-data-context"
import Link from "next/link"
import { WindowControls } from "./topbar/window-controls"


/**
 * 顶栏插件功能区：导入插件 / 下载插件 / 批量安装。
 * 与安装按钮一致——始终挂载，由 active 驱动整体展开/收起（切入切出），
 * 内部三个功能键再叠加从左到右的错峰揭示动效（模糊渐显 + 轻移就位）。
 * 离开插件页时整组向左收起、各键反向模糊淡出（减少动画）。
 */
function PluginsActions({ active }: { active: boolean }) {
  const ctx = usePlugins()
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (active) {
      const raf = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(raf)
    }
    setShown(false)
  }, [active])

  const buttons = ctx
    ? [
        { key: "import", label: "导入插件", icon: <FolderInput className="h-5 w-5" />, onClick: ctx.openImport, accent: false },
        { key: "download", label: "下载插件", icon: <DownloadCloud className="h-5 w-5" />, onClick: ctx.openDownload, accent: false },
        {
          key: "batch",
          label: ctx.selectMode ? `批量安装（${ctx.selected.length}）` : "批量安装",
          icon: <ListChecks className="h-5 w-5" />,
          onClick: ctx.toggleSelectMode,
          accent: ctx.selectMode,
        },
      ]
    : []

  return (
    <span
      className="inline-flex overflow-hidden"
      style={{
        maxWidth: shown ? "560px" : "0px",
        marginRight: shown ? undefined : "-1rem", // 抵消父级 gap-4，未展开时不占位
        transition: "max-width 560ms cubic-bezier(0.22,1,0.36,1), margin-right 560ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      <div className="flex items-center gap-3">
        {buttons.map((b, i) => (
          <span key={b.key} style={revealStyle(shown, 80 + i * 75)}>
            <button
              type="button"
              onClick={b.onClick}
              aria-hidden={!active}
              tabIndex={active ? 0 : -1}
              className={cn(
                "flex h-12 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-all duration-300 ease-out hover:scale-[1.02] active:scale-95",
                b.accent
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                  : "bg-surface text-foreground hover:bg-muted",
              )}
            >
              {b.icon}
              <span className="leading-none">{b.label}</span>
            </button>
          </span>
        ))}
      </div>
    </span>
  )
}

/**
 * 顶栏计划任务功能区：「新建任务」下拉按钮（仅在计划任务页常驻，主色高亮）。
 * 与安装/插件功能区一致——始终挂载，由 active 驱动整体展开/收起（切入切出），
 * 内部按钮叠加从左揭示动效（模糊渐显 + 轻移就位）；离开时反向收起。
 * 点击展开菜单可选择创建 Windows 任务或 Linux 任务（菜单项错峰模糊渐显）。
 */
function TasksActions({ active }: { active: boolean }) {
  const ctx = useTasks()
  const [shown, setShown] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => {
    if (active) {
      const raf = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(raf)
    }
    setShown(false)
    setMenuOpen(false)
  }, [active])

  // 菜单打开时，基于按钮位置计算 Portal 菜单坐标（fixed，脱离 overflow-hidden 裁剪）
  useLayoutEffect(() => {
    if (!menuOpen || !btnRef.current) return
    const update = () => {
      const r = btnRef.current!.getBoundingClientRect()
      setPos({ top: r.bottom + 8, right: window.innerWidth - r.right })
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [menuOpen])

  // 离开页面或失活时关闭菜单
  useEffect(() => {
    if (!menuOpen) return
    const onClick = () => setMenuOpen(false)
    window.addEventListener("click", onClick)
    return () => window.removeEventListener("click", onClick)
  }, [menuOpen])

  const options = [
    { os: "windows" as const, label: "Windows 任务", icon: <Monitor className="h-4 w-4" /> },
    { os: "linux" as const, label: "Linux 任务", icon: <Terminal className="h-4 w-4" /> },
  ]

  return (
    <span
      className="inline-flex overflow-hidden rounded-full"
      style={{
        maxWidth: shown ? "200px" : "0px",
        marginRight: shown ? undefined : "-1rem", // 抵消父级 gap-4，未展开时不占位
        transition: "max-width 520ms cubic-bezier(0.22,1,0.36,1), margin-right 520ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      <span style={revealStyle(shown, 80)}>
        <button
          ref={btnRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-hidden={!active}
          tabIndex={active ? 0 : -1}
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((v) => !v)
          }}
          className="flex h-12 items-center gap-2 whitespace-nowrap rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-300 ease-out hover:scale-[1.02] active:scale-95"
        >
          <CalendarPlus className="h-5 w-5" />
          <span className="leading-none">新建任务</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform duration-300", menuOpen && "rotate-180")} />
        </button>
      </span>

      {/* 下拉菜单：Portal 到 body，避免被工具栏 overflow-hidden 裁剪；错峰模糊渐显揭示 */}
      {typeof document !== "undefined" &&
        pos &&
        createPortal(
          <div
            role="menu"
            onClick={(e) => e.stopPropagation()}
            className="fixed z-[60] w-48 origin-top-right overflow-hidden rounded-2xl border border-border bg-card p-1.5 shadow-xl"
            style={{
              top: pos.top,
              right: pos.right,
              opacity: menuOpen ? 1 : 0,
              transform: menuOpen ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.96)",
              filter: menuOpen ? "blur(0px)" : "blur(6px)",
              pointerEvents: menuOpen ? "auto" : "none",
              transition: "opacity 240ms ease-out, transform 240ms cubic-bezier(0.22,1,0.36,1), filter 240ms ease-out",
            }}
          >
            {options.map((o, i) => (
              <button
                key={o.os}
                role="menuitem"
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  ctx?.openCreate(o.os)
                  setMenuOpen(false)
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-surface"
                style={{
                  opacity: menuOpen ? 1 : 0,
                  transform: menuOpen ? "translateX(0)" : "translateX(-6px)",
                  filter: menuOpen ? "blur(0px)" : "blur(4px)",
                  transition: "opacity 260ms ease-out, transform 260ms ease-out, filter 260ms ease-out",
                  transitionDelay: menuOpen ? `${80 + i * 70}ms` : "0ms",
                }}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/12 text-primary">
                  {o.icon}
                </span>
                {o.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  )
}

/**
 * 顶栏系统日志功能区：暂停/继续 / 导出 / 清空。
 * 与客户端页一致——仅在 /logs 挂载于条件插槽，采用两阶段过渡：
 * 1) 先渲染上一页（首页样式）的四个动作按钮，令其向左收拢、变淡并模糊离场（回收动画）；
 * 2) 待其完全消失后，日志三个功能键再从左到右逐个模糊渐显展开。
 * 离开日志页时，由目标页工具栏（如 HomeActions 的 fromLogs 分支）负责回放日志按钮的收拢。
 */
function LogsActions() {
  const ctx = useLogs()
  // 0: 渲染首页四键（静止） 1: 四键向左收拢离场 2: 展示日志功能键
  const [stage, setStage] = useState<0 | 1 | 2>(0)
  const [keysIn, setKeysIn] = useState(false)
  // 清空按钮的二次确认态：首次点击展开为「确认清空」胶囊，再次点击才真正清空
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setStage(1)) // 触发收拢离场
    const toKeys = setTimeout(() => setStage(2), 470) // 离场完成后展示功能键
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(toKeys)
    }
  }, [])

  useEffect(() => {
    if (stage !== 2) return
    const raf = requestAnimationFrame(() => setKeysIn(true))
    return () => cancelAnimationFrame(raf)
  }, [stage])

  // 展开确认后若 3.5s 内无操作则自动收起，避免误触后一直停留
  useEffect(() => {
    if (!confirmClear) return
    const t = setTimeout(() => setConfirmClear(false), 3500)
    return () => clearTimeout(t)
  }, [confirmClear])

  // 阶段 0/1：渲染首页四个动作按钮，并执行向左收拢 + 变淡 + 模糊离场
  if (stage < 2) {
    const merging = stage === 1
    const mergeBtns = [
      { key: "add", Icon: Plus, accent: false },
      { key: "filter", Icon: SlidersHorizontal, accent: false },
      { key: "db", Icon: Database, accent: true },
      { key: "terminal", Icon: SquareTerminal, accent: false },
    ]
    return (
      <div className="flex items-center gap-3">
        {mergeBtns.map((b, i) => (
          <span
            key={b.key}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-foreground"
            style={{
              transform: merging ? `translateX(-${i * 60}px) scale(0.92)` : "translateX(0) scale(1)",
              opacity: merging ? 0 : 1,
              filter: merging ? "blur(6px)" : "blur(0px)",
              transition: "transform 440ms cubic-bezier(0.4,0,1,1), opacity 440ms ease-in, filter 440ms ease-in",
            }}
          >
            <b.Icon className={cn("h-5 w-5", b.accent && "text-primary")} />
          </span>
        ))}
      </div>
    )
  }

  const live = ctx?.live ?? true
  const buttons = ctx
    ? [
        {
          key: "toggle",
          label: live ? "实时跟随中" : "已暂停",
          icon: live ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />,
          onClick: ctx.toggleLive,
          accent: live,
        },
        {
          key: "export",
          label: "导出",
          icon: <Download className="h-5 w-5" />,
          onClick: ctx.exportLogs,
          accent: false,
        },
      ]
    : []

  const handleClear = () => {
    if (!confirmClear) {
      setConfirmClear(true) // 首次点击：展开确认胶囊
      return
    }
    ctx?.clearLogs() // 再次点击：执行清空
    setConfirmClear(false)
  }

  // 阶段 2：日志功能键由左到右逐个展开
  return (
    <div className="flex items-center gap-3">
      {buttons.map((b, i) => (
        <Reveal show={keysIn} delay={i * 75} key={b.key}>
          <button
            type="button"
            onClick={b.onClick}
            className={cn(
              "flex h-12 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-all duration-300 ease-out hover:scale-[1.02] active:scale-95",
              b.accent
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                : "bg-surface text-foreground hover:bg-muted",
            )}
          >
            {b.icon}
            <span className="leading-none">{b.label}</span>
          </button>
        </Reveal>
      ))}

      {/* 清空按钮：图标锚定在左，点击后按钮自身宽度增长、向右扩展成胶囊并显示「确认清空」。
          在流内布局（非绝对定位），扩展时占用右侧空白，不会覆盖相邻的导出按钮。 */}
      <Reveal show={keysIn} delay={buttons.length * 75}>
        <button
          type="button"
          onClick={handleClear}
          onBlur={() => setConfirmClear(false)}
          aria-label={confirmClear ? "确认清空日志" : "清空日志"}
          className={cn(
            // 图标左边缘用固定的 pl-[14px] 锚定：圆形按钮宽 48px、图标 20px，
            // 14+10=24 恰为半径，收起态图标居中；展开态沿用同一 pl，图标位置完全不动，
            // 仅文字向右伸缩，避免收回时图标左移再归位的跳动
            "flex h-12 items-center overflow-hidden whitespace-nowrap rounded-full pl-[14px] text-sm font-medium transition-all duration-300 ease-out active:scale-95",
            confirmClear
              ? "gap-2 bg-negative pr-4 text-primary-foreground shadow-lg shadow-negative/25"
              : "gap-0 bg-surface pr-[14px] text-foreground hover:bg-negative/15 hover:text-negative",
          )}
          // 用显式数值 width（而非 w-12 的 auto）使展开/收回两个方向都能平滑动画；
          // 展开宽度贴合内容（图标+间距+四字+左右内边距），避免右侧留白
          style={{ width: confirmClear ? "7.75rem" : "3rem" }}
        >
          <Trash2 className="h-5 w-5 shrink-0" />
          {/* 未确认时文字宽度收为 0，避免占位把图标挤出 w-12 圆形按钮而被裁剪 */}
          <span
            className="overflow-hidden leading-none transition-all duration-200"
            style={{ maxWidth: confirmClear ? "6rem" : "0px", opacity: confirmClear ? 1 : 0 }}
          >
            确认清空
          </span>
        </button>
      </Reveal>
    </div>
  )
}

function ExpandableLabel({ expanded, children }: { expanded: boolean; children: string }) {
  const labelRef = useRef<HTMLSpanElement>(null)
  const [labelWidth, setLabelWidth] = useState(0)

  useLayoutEffect(() => {
    const label = labelRef.current
    if (!label) return

    const updateWidth = () => setLabelWidth(Math.ceil(label.getBoundingClientRect().width))
    updateWidth()

    const resizeObserver = new ResizeObserver(updateWidth)
    resizeObserver.observe(label)
    return () => resizeObserver.disconnect()
  }, [children])

  return (
    <span
      aria-hidden="true"
      className={cn(
        "shrink-0 overflow-hidden whitespace-nowrap text-sm font-medium leading-none transition-[width,margin-left,opacity,filter] duration-300 ease-linear motion-reduce:transition-none",
        expanded ? "ml-1.5 opacity-100 blur-0" : "ml-0 opacity-0 blur-[4px]",
      )}
      style={{ width: expanded ? `${labelWidth}px` : "0px" }}
    >
      <span ref={labelRef} className="inline-block">
        {children}
      </span>
    </span>
  )
}

function IconButton({
  children,
  label,
  expandLabel,
  onClick,
  badge,
}: {
  children: React.ReactNode
  label: string
  /** 悬浮或键盘聚焦时向右匀速展开显示的文字 */
  expandLabel?: string
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  /** 右上角角标：数字显示计数气泡，true 显示小圆点 */
  badge?: number | boolean
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const expanded = hovered || focused

  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex h-12 items-center justify-start rounded-full bg-surface px-3.5 text-foreground transition-colors duration-300 ease-out hover:bg-muted"
    >
      {/* 角标：未读计数气泡或激活小圆点 */}
      {typeof badge === "number" && badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-negative px-1 text-[10px] font-semibold leading-none text-primary-foreground">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
      {badge === true && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-primary" />}
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{children}</span>
      {expandLabel && <ExpandableLabel expanded={expanded}>{expandLabel}</ExpandableLabel>}
    </button>
  )
}

type NoticeIconPhase =
  | "bell-idle"
  | "bell-erasing"
  | "warning-drawing"
  | "warning-idle"
  | "warning-erasing"
  | "bell-drawing"

function NoticeStrokeIcon({ phase, onSequenceEnd }: { phase: NoticeIconPhase; onSequenceEnd: () => void }) {
  const warning = phase.startsWith("warning")

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("notice-stroke-icon size-[1.375rem]", `notice-phase-${phase}`)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      onAnimationEnd={(event) => {
        if ((event.target as SVGElement).dataset.sequenceEnd === "true") onSequenceEnd()
      }}
    >
      {warning ? (
        // 警告落笔顺序：三角形 → 中间竖线 → 底部圆点；倒绘时严格反向。
        <g key="warning">
          <path className="notice-stroke notice-warning-triangle" pathLength="1" d="M10.3 3.6 2.7 17a2 2 0 0 0 1.75 3h15.1a2 2 0 0 0 1.75-3L13.7 3.6a2 2 0 0 0-3.4 0Z" data-sequence-end={phase === "warning-erasing" ? "true" : undefined} />
          <path className="notice-stroke notice-warning-mark" pathLength="1" d="M12 9v4" />
          <circle className="notice-stroke notice-warning-dot" pathLength="1" cx="12" cy="17" r=".5" data-sequence-end={phase === "warning-drawing" ? "true" : undefined} />
        </g>
      ) : (
        // 铃铛落笔顺序：先一笔画完顶部帽罩 → 再画下方铃身与底边 → 最后补铃舌；倒绘时严格反向。
        <g key="bell">
          <path className="notice-stroke notice-bell-hood" pathLength="1" d="M6 8a6 6 0 0 1 12 0" data-sequence-end={phase === "bell-erasing" ? "true" : undefined} />
          <path className="notice-stroke notice-bell-body" pathLength="1" d="M18 8c0 4.5 1.4 6 2.7 7.3A1 1 0 0 1 20 17H4a1 1 0 0 1-.7-1.7C4.6 14 6 12.5 6 8" />
          <path className="notice-stroke notice-bell-clapper" pathLength="1" d="M10.3 20a2 2 0 0 0 3.4 0" data-sequence-end={phase === "bell-drawing" ? "true" : undefined} />
        </g>
      )}
    </svg>
  )
}

/** 顶栏通知灵动岛：断线时倒绘铃铛再正绘警告，恢复时严格反向播放。 */
function NotificationIsland({ unread, criticalAttention, onOpen }: { unread: number; criticalAttention?: boolean; onOpen?: () => void }) {
  const { overview, error, refreshing, refresh } = useServerData()
  const [recovered, setRecovered] = useState(false)
  const [iconPhase, setIconPhase] = useState<NoticeIconPhase>("bell-idle")
  const desiredWarning = useRef(false)
  const wasDisconnected = useRef(false)

  useEffect(() => {
    // 首次打开面板时服务端可能已经离线，此时 overview 尚未生成，但错误同样需要展示。
    const disconnected = Boolean(error)
    desiredWarning.current = disconnected

    if (disconnected) {
      setRecovered(false)
      wasDisconnected.current = true
      setIconPhase((phase) => (phase === "warning-idle" || phase === "warning-drawing" ? phase : "bell-erasing"))
      return
    }

    // 只有服务端真实返回 overview 后才算恢复；重试开始时的中间态不得冒充成功。
    if (wasDisconnected.current && overview) {
      setRecovered(true)
      wasDisconnected.current = false
      setIconPhase((phase) => (phase === "bell-idle" || phase === "bell-drawing" ? phase : "warning-erasing"))
    }
  }, [error, overview])

  const advanceIconSequence = () => {
    setIconPhase((phase) => {
      if (phase === "bell-erasing") return desiredWarning.current ? "warning-drawing" : "bell-drawing"
      if (phase === "warning-drawing") return desiredWarning.current ? "warning-idle" : "warning-erasing"
      if (phase === "warning-erasing") return desiredWarning.current ? "warning-drawing" : "bell-drawing"
      if (phase === "bell-drawing") {
        if (desiredWarning.current) return "bell-erasing"
        setRecovered(false)
        return "bell-idle"
      }
      return phase
    })
  }

  const expanded = Boolean(error)
  // 图标配色跟随当前笔画身份而非连接状态：避免出现“红色铃铛”“绿色警告”这类过渡中间态。
  const iconWarning = iconPhase.startsWith("warning")
  return (
    <div
      role={expanded ? "alert" : undefined}
      data-notification-state={expanded ? "error" : recovered ? "recovered" : "idle"}
      data-icon-phase={iconPhase}
      aria-live="polite"
      className={cn(
        "relative flex h-13 flex-row-reverse items-center overflow-hidden rounded-full border transition-[width,background-color,border-color,box-shadow] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
        expanded
          ? "border-negative/35 bg-card/95 shadow-xl shadow-negative/10"
          : recovered
            ? "border-positive/30 bg-positive/10"
            : "border-transparent bg-surface",
      )}
      style={{ width: expanded ? "min(27rem, calc(100vw - 8.5rem))" : "3.25rem" }}
    >
      <button
        type="button"
        onClick={expanded ? undefined : onOpen}
        className={cn(
          "relative z-10 flex h-13 w-13 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
          iconWarning ? "text-negative" : recovered ? "text-positive" : "text-foreground",
        )}
        aria-label={expanded ? "服务端连接已断开" : "通知中心"}
      >
        <span className="inline-flex">
          <NoticeStrokeIcon phase={iconPhase} onSequenceEnd={advanceIconSequence} />
        </span>
        {expanded && iconWarning && <span className="absolute inset-1 rounded-full border border-negative/30 animate-notice-pulse" />}
        {!expanded && unread > 0 && (
          <span className={cn("absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-negative px-1 text-[10px] font-semibold text-primary-foreground", criticalAttention && "animate-pulse ring-4 ring-negative/20")}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <div className={cn("min-w-0 flex-1 pl-[1.125rem] pr-1 transition-[opacity,transform,filter] duration-500", expanded ? "translate-x-0 opacity-100 blur-0 delay-150" : "-translate-x-2 opacity-0 blur-sm")}>
        <p className="truncate text-[13px] font-semibold text-foreground">服务端连接已断开</p>
        <p className="truncate text-xs text-muted-foreground">{error}</p>
      </div>

      {expanded && (
        <div className="flex shrink-0 items-center gap-0.5 pr-1">
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground disabled:opacity-50" aria-label="重新连接">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </button>
          <Link href="/settings?tab=connection" className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground" aria-label="连接设置">
            <Settings2 className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  )
}

/** 按当前时段返回问候语：凌晨/早上/中午/下午/晚上 */
function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 5) return "凌晨好"
  if (h < 11) return "早上好"
  if (h < 13) return "中午好"
  if (h < 18) return "下午好"
  return "晚上好"
}

/**
 * 顶栏左侧始终保留的代币胶囊（logo + 用户气泡），用户名沿用引导注册的称呼。
 * 首次进入界面时依次播放入场动效：
 * 1) 整体从圆形（仅头像）横向展开成胶囊形状；
 * 2) 右侧 X 符号顺势旋转一整圈；
 * 3) 问候语与用户名模糊渐显浮现（时段问候：早上好 / 下午好 / 晚上好…）。
 */
function TokenPill() {
  const { userName, avatarId, customAvatar, phase } = useOnboarding()
  const avatar = getAvatar(avatarId)
  const isCustom = avatarId === "custom" && !!customAvatar
  const [greeting, setGreeting] = useState("你好")
  const [shown, setShown] = useState(false)

  // 引导覆盖层始终盖在主界面之上：待其完全渐隐离场、主界面彻底进来（phase === "done"）之后，
  // 才播放圆形展开成胶囊 / X 旋转 / 问候语渐显的入场动效，确保动画在界面完全进来时才开始。
  const revealed = phase === "done"

  useEffect(() => {
    if (!revealed) return
    setGreeting(getGreeting())
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [revealed])

  return (
    <div
      className="flex items-center rounded-full border border-border bg-surface p-1.5"
      style={{
        // 折叠时右侧内边距归零，容器收成一个正圆；展开时补足右内边距，成为胶囊
        paddingRight: shown ? 16 : 6,
        transition: "padding-right 620ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      {/* 头像：始终可见，作为圆形本体 */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full">
        {isCustom ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={customAvatar! || "/placeholder.svg"} alt="用户头像" className="h-full w-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar.src || "/placeholder.svg"} alt="用户头像" className="h-full w-full object-cover" />
        )}
      </div>

      {/* 右侧内容区：以 grid 列宽 0fr→1fr 从头像右侧横向展开，形成圆→胶囊的拉伸 */}
      <div
        className="grid"
        style={{
          // 必须用 minmax(0, …)：fr 轨道默认最小尺寸为 auto(min-content)，
          // 会残留内容最小宽度导致折叠时右侧多出一块，minmax 强制最小为 0 才能收成正圆
          gridTemplateColumns: shown ? "minmax(0, 1fr)" : "minmax(0, 0fr)",
          transition: "grid-template-columns 620ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <div className="flex min-w-0 items-center gap-2 overflow-hidden pl-2">
          <div className="leading-tight">
            {/* 用户名：展开后模糊渐显 */}
            <p
              className="whitespace-nowrap text-sm font-semibold"
              style={{
                opacity: shown ? 1 : 0,
                filter: shown ? "blur(0px)" : "blur(6px)",
                transition: "opacity 460ms ease-out, filter 460ms ease-out",
                transitionDelay: shown ? "300ms" : "0ms",
              }}
            >
              {userName}
            </p>
            {/* 问候语：最后模糊渐显 */}
            <p
              className="whitespace-nowrap text-xs text-muted-foreground"
              style={{
                opacity: shown ? 1 : 0,
                filter: shown ? "blur(0px)" : "blur(6px)",
                transition: "opacity 460ms ease-out, filter 460ms ease-out",
                transitionDelay: shown ? "400ms" : "0ms",
              }}
            >
              {greeting}
            </p>
          </div>
          <button
            aria-label="移除"
            className="ml-1 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            style={{
              // X 在展开后顺势旋转一整圈就位
              transform: shown ? "rotate(360deg)" : "rotate(0deg)",
              transition: "transform 700ms cubic-bezier(0.22,1,0.36,1)",
              transitionDelay: shown ? "260ms" : "0ms",
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

/** 入场揭示样式：从左到右逐个展开（模糊到清晰 + 轻微右移就位） */
function revealStyle(show: boolean, delay: number): React.CSSProperties {
  return {
    transform: show ? "translateX(0)" : "translateX(-14px)",
    opacity: show ? 1 : 0,
    filter: show ? "blur(0px)" : "blur(8px)",
    transition:
      "transform 520ms cubic-bezier(0.22,1,0.36,1), opacity 520ms ease-out, filter 520ms ease-out",
    transitionDelay: show ? `${delay}ms` : "0ms",
  }
}

/** 入场揭示容器：包裹单个功能键，驱动其逐字模糊渐显展开 */
function Reveal({
  show,
  delay,
  className,
  children,
}: {
  show: boolean
  delay: number
  className?: string
  children: React.ReactNode
}) {
  return (
    <span className={cn("inline-flex", className)} style={revealStyle(show, delay)}>
      {children}
    </span>
  )
}

/**
 * 首页的动作按钮组。
 * 从客户端返回时（fromClients）执行逆向过渡：
 * 1) 先渲染客户端标签，其右侧按钮向最左侧「客户端」合并并伴随变淡 + 模糊离场（「客户端」本身也模糊渐出）；
 * 2) 待其完全消失后，首页功能键从左到右逐个展开（由浅到深、模糊到清晰）。
 */
function HomeActions({ fromClients, fromLogs }: { fromClients: boolean; fromLogs: boolean }) {
  const actions = useTopbarActions()
  // 是否需要先回放「上一页按钮收拢离场」再展示首页功能键
  const reverse = fromClients || fromLogs
  // 0: 渲染上一页按钮（静止） 1: 向左合并离场 2: 展示首页功能键
  const [stage, setStage] = useState<0 | 1 | 2>(reverse ? 0 : 2)
  // 初值恒为「未入场」：无论从客户端/日志返回，还是首页 ↔ 脚本安装切换，
  // 都从模糊轻移态开始逐个揭示，保证每次进入页面顶栏都有一致的切入动画。
  const [keysIn, setKeysIn] = useState(false)

  useEffect(() => {
    if (!reverse) return
    const raf = requestAnimationFrame(() => setStage(1)) // 触发合并离场
    const toKeys = setTimeout(() => setStage(2), 470) // 离场完成后展示功能键
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(toKeys)
    }
  }, [reverse])

  useEffect(() => {
    if (stage !== 2 || keysIn) return
    const raf = requestAnimationFrame(() => setKeysIn(true))
    return () => cancelAnimationFrame(raf)
  }, [stage, keysIn])

  // 阶段 0/1（从日志返回）：日志三个功能键向左收拢，伴随变淡与模糊离场
  if (stage < 2 && fromLogs) {
    const merging = stage === 1
    const logsMerge = [
      { key: "toggle", Icon: Pause, accent: true },
      { key: "export", Icon: Download, accent: false },
      { key: "clear", Icon: Trash2, accent: false },
    ]
    return (
      <div className="flex items-center gap-3">
        {logsMerge.map((b, i) => (
          <span
            key={b.key}
            className={cn(
              "flex h-12 items-center justify-center rounded-full px-4",
              b.accent
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                : "bg-surface text-foreground",
            )}
            style={{
              transform: merging ? `translateX(-${i * 64}px) scale(0.92)` : "translateX(0) scale(1)",
              opacity: merging ? 0 : 1,
              filter: merging ? "blur(6px)" : "blur(0px)",
              transition: "transform 440ms cubic-bezier(0.4,0,1,1), opacity 440ms ease-in, filter 440ms ease-in",
            }}
          >
            <b.Icon className="h-5 w-5" />
          </span>
        ))}
      </div>
    )
  }

  // 阶段 0/1（从客户端返回）：客户端标签从右往「客户端」合并，伴随变淡与模糊离场
  if (stage < 2) {
    const merging = stage === 1
    return (
      <div className="flex items-center gap-2">
        {clientTabs.map((t, i) => {
          const Icon = t.icon
          const isFirst = i === 0
          return (
            <span
              key={t.id}
              className={cn(
                "flex h-12 items-center justify-start rounded-full px-3.5",
                isFirst
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                  : "border border-border bg-surface/70 text-foreground",
              )}
              style={{
                // 全部向最左侧「客户端」靠拢堆叠，伴随变淡与模糊
                transform: merging ? `translateX(-${i * 60}px) scale(0.92)` : "translateX(0) scale(1)",
                opacity: merging ? 0 : 1,
                filter: merging ? "blur(6px)" : "blur(0px)",
                transition: "transform 440ms cubic-bezier(0.4,0,1,1), opacity 440ms ease-in, filter 440ms ease-in",
              }}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <Icon className="h-5 w-5" />
              </span>
              {isFirst && (
                <span className="ml-1.5 whitespace-nowrap text-sm font-medium leading-none">{t.label}</span>
              )}
            </span>
          )
        })}
      </div>
    )
  }

  // 阶段 2：首页功能键由左到右展开
  return (
    <>
      <Reveal show={keysIn} delay={0}>
        <button
          aria-label="添加客户端"
          onClick={actions?.openAdd}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-surface"
        >
          <Plus className="h-5 w-5" />
        </button>
      </Reveal>

      <div className="flex items-center gap-3">
        <Reveal show={keysIn} delay={70}>
          <IconButton
            label="仪表盘筛选"
            expandLabel="筛选"
            badge={(actions?.filterCount ?? 0) > 0}
            onClick={(e) => actions?.openFilter(e.currentTarget)}
          >
            <SlidersHorizontal className="h-5 w-5" />
          </IconButton>
        </Reveal>
        <Reveal show={keysIn} delay={140}>
          <IconButton label="数据库管理" expandLabel="数据库管理">
            <Database className="h-5 w-5 text-primary" />
          </IconButton>
        </Reveal>
        <Reveal show={keysIn} delay={210}>
          <IconButton label="远程终端" expandLabel="远程终端" onClick={actions?.openTerminal}>
            <SquareTerminal className="h-5 w-5" />
          </IconButton>
        </Reveal>
      </div>

    </>
  )
}

/** 客户端页的标签按钮：图标常驻，激活或悬浮时标签模糊渐显展开（继承「数据库管理」按钮动效） */
function TopbarTab({
  tab,
  isActive,
  onSelect,
  show,
  delay,
}: {
  tab: (typeof clientTabs)[number]
  isActive: boolean
  onSelect: () => void
  /** 入场是否完成（驱动从左到右逐个展开） */
  show: boolean
  delay: number
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const expanded = isActive || hovered || focused
  const Icon = tab.icon

  return (
    <button
      type="button"
      aria-label={tab.label}
      onClick={onSelect}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "flex h-12 items-center justify-start rounded-full px-3.5",
        isActive
          ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
          : "border border-border bg-surface/70 text-foreground hover:bg-muted",
      )}
      style={{
        // 入场：从左到右逐个展开（透明度由浅到深 + 模糊到清晰 + 轻微右移就位）
        transform: show ? "translateX(0)" : "translateX(-14px)",
        opacity: show ? 1 : 0,
        filter: show ? "blur(0px)" : "blur(8px)",
        transition:
          "transform 520ms cubic-bezier(0.22,1,0.36,1), opacity 520ms ease-out, filter 520ms ease-out, background-color 300ms ease-out",
        transitionDelay: show ? `${delay}ms` : "0ms",
      }}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <Icon className="h-5 w-5" />
      </span>
      <ExpandableLabel expanded={expanded}>{tab.label}</ExpandableLabel>
    </button>
  )
}

/**
 * 客户端页顶栏动作区：
 * 1) 延续首页的四个动作按钮（含加号），向左侧第一个按钮收拢、合并，伴随变淡与模糊后消失；
 * 2) 待其完全消失后，客户端标签从左到右逐个展开（由浅到深、模糊到清晰）。
 */
function ClientsActions() {
  const ctx = useClientTabs()
  // 0: 静止（与首页一致） 1: 收拢合并离场 2: 展示标签
  const [stage, setStage] = useState<0 | 1 | 2>(0)
  const [tabsIn, setTabsIn] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setStage(1)) // 触发收拢离场
    const toTabs = setTimeout(() => setStage(2), 470) // 离场完成后切换到标签
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(toTabs)
    }
  }, [])

  useEffect(() => {
    if (stage !== 2) return
    const raf = requestAnimationFrame(() => setTabsIn(true))
    return () => cancelAnimationFrame(raf)
  }, [stage])

  // 阶段 0/1：渲染首页四个动作按钮，并执行向左收拢 + 变淡 + 模糊离场
  if (stage < 2) {
    const merging = stage === 1
    const mergeBtns = [
      { key: "add", Icon: Plus, accent: false },
      { key: "filter", Icon: SlidersHorizontal, accent: false },
      { key: "db", Icon: Database, accent: true },
      { key: "terminal", Icon: SquareTerminal, accent: false },
    ]
    return (
      <div className="flex items-center gap-3">
        {mergeBtns.map((b, i) => (
          <span
            key={b.key}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-foreground"
            style={{
              // 全部向最左侧的加号按钮靠拢并堆叠，伴随变淡与模糊
              transform: merging ? `translateX(-${i * 60}px) scale(0.92)` : "translateX(0) scale(1)",
              opacity: merging ? 0 : 1,
              filter: merging ? "blur(6px)" : "blur(0px)",
              transition: "transform 440ms cubic-bezier(0.4,0,1,1), opacity 440ms ease-in, filter 440ms ease-in",
            }}
          >
            <b.Icon className={cn("h-5 w-5", b.accent && "text-primary")} />
          </span>
        ))}
      </div>
    )
  }

  // 阶段 2：客户端标签从左到右逐个展开
  return (
    <div className="flex flex-wrap items-center gap-2">
      {clientTabs.map((t, i) => (
        <TopbarTab
          key={t.id}
          tab={t}
          isActive={ctx?.active === i}
          onSelect={() => ctx?.select(i)}
          show={tabsIn}
          delay={i * 95}
        />
      ))}
    </div>
  )
}

/**
 * AI Mode 入口按钮：悬浮时按钮内浮现 LED 像素星芒（PixelStardust）。
 * 星光围绕指针聚集、随指针游走，偶有像素爆闪成白色星光——
 * 配合原有的图标旋转，营造「星尘被唤醒」的入口氛围。
 */
function AIModeButton({ onClick }: { onClick?: () => void }) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative ml-1 flex h-12 items-center gap-2 overflow-hidden rounded-full border border-border bg-surface px-4.5 transition-colors hover:border-primary/40"
    >
      {/* 悬浮像素星芒：LED 点阵随指针点亮 */}
      <PixelStardust active={hovered} />
      <Sparkles className="relative h-4.5 w-4.5 text-primary transition-transform duration-300 group-hover:rotate-12" />
      <span className="relative whitespace-nowrap text-sm font-medium">AI Mode</span>
    </button>
  )
}

export function Topbar() {
  const actions = useTopbarActions()
  const pathname = usePathname()
  const onClients = !!pathname && pathname.startsWith("/clients")
  // 插件功能区仅在「插件管理」页面常驻
  const onPlugins = !!pathname && pathname.startsWith("/plugins")
  // 新建任务功能区仅在「计划任务」页面常驻
  const onTasks = !!pathname && pathname.startsWith("/tasks")
  // 系统日志功能区仅在「系统日志」页面常驻
  const onLogs = !!pathname && pathname.startsWith("/logs")
  // 记录上一个路由：用于判断首页是否「从客户端返回」，从而播放逆向过渡动画。
  // 此处在渲染时读取的仍是切换前的旧值（effect 在渲染后才更新），正好对应过渡帧。
  const prevPathRef = useRef<string | null>(null)
  const cameFromClients = prevPathRef.current?.startsWith("/clients") ?? false
  const cameFromLogs = prevPathRef.current?.startsWith("/logs") ?? false

  useEffect(() => {
    prevPathRef.current = pathname ?? null
  }, [pathname])

  return (
    // 固定 min-h-14：无论首页（含 h-14 加号）还是客户端页（h-12 标签），
    // 行高都锁定为 56px，避免切换时 items-center 基线变化导致顶栏整体上移。
    <header className="flex min-h-14 flex-wrap items-center gap-4">
      <TokenPill />
      <PluginsActions active={onPlugins} />
      <TasksActions active={onTasks} />
      {/* 不加 key：首页 ↔ 脚本安装 ↔ 健康中心为同一套工具栏，组件复用、keysIn 保持为 true，
          工具栏未变时不重放揭示动画（避免上方按钮无变化却动画的突兀感）。
          从客户端/日志返回时 HomeActions 是重新挂载（那些页面渲染的是别的组件），
          逆向收拢+揭示动画照常由 reverse 逻辑触发。
          日志与客户端一样占用条件插槽（互斥挂载），以便切入时先回放上一页按钮的收拢离场。 */}
      {onClients ? (
        <ClientsActions />
      ) : onLogs ? (
        <LogsActions />
      ) : onPlugins || onTasks ? null : (
        <HomeActions fromClients={cameFromClients} fromLogs={cameFromLogs} />
      )}

      {/* 常驻右侧控件：不管切换到哪个页面都始终显示 */}
      <div className="ml-auto flex items-center gap-4">
        <NotificationIsland unread={actions?.unread ?? 0} criticalAttention={actions?.criticalAttention} onOpen={actions?.openNotices} />
        <IconButton label="全局搜索" expandLabel="Ctrl K" onClick={actions?.openSearch}>
          <Search className="h-5 w-5" />
        </IconButton>

        {/* AI Mode 入口：自然语言操作所有客户端 */}
        <AIModeButton onClick={actions?.openAI} />

        {/* 窗口控制：缩小 / 最大化 / 关闭（桌面壳调用原生接口，浏览器降级为全屏切换） */}
        <WindowControls />
      </div>

    </header>
  )
}

