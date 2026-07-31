"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  CalendarClock,
  CornerDownLeft,
  DownloadCloud,
  HeartPulse,
  Home,
  MonitorSmartphone,
  Puzzle,
  ScrollText,
  Search,
  Settings,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { statusMeta } from "@/components/clients/client-data"
import { useServerData } from "@/components/server-data-context"
import { ModalShell } from "./overlay"

type Entry = {
  id: string
  section: "页面" | "客户端"
  label: string
  desc: string
  keywords: string
  href: string
  icon: React.ReactNode
  dot?: string
}

const pages: Entry[] = [
  { id: "p-home", section: "页面", label: "主页", desc: "仪表盘总览", keywords: "home dashboard 首页 仪表盘", href: "/", icon: <Home className="h-4 w-4" /> },
  { id: "p-clients", section: "页面", label: "客户端", desc: "设备列表与详情", keywords: "clients 设备 机器", href: "/clients", icon: <MonitorSmartphone className="h-4 w-4" /> },
  { id: "p-scripts", section: "页面", label: "脚本安装", desc: "安装脚本与部署命令", keywords: "scripts install 部署 安装", href: "/scripts", icon: <DownloadCloud className="h-4 w-4" /> },
  { id: "p-plugins", section: "页面", label: "插件管理", desc: "导入、下载与批量安装插件", keywords: "plugins 扩展", href: "/plugins", icon: <Puzzle className="h-4 w-4" /> },
  { id: "p-tasks", section: "页面", label: "计划任务", desc: "定时任务管理", keywords: "tasks cron 定时 任务", href: "/tasks", icon: <CalendarClock className="h-4 w-4" /> },
  { id: "p-health", section: "页面", label: "健康中心", desc: "客户端健康状态", keywords: "health 监控 告警", href: "/health", icon: <HeartPulse className="h-4 w-4" /> },
  { id: "p-logs", section: "页面", label: "系统日志", desc: "实时日志流", keywords: "logs 日志", href: "/logs", icon: <ScrollText className="h-4 w-4" /> },
  { id: "p-settings", section: "页面", label: "设置", desc: "通用、外观、通知与安全", keywords: "settings 配置 偏好", href: "/settings", icon: <Settings className="h-4 w-4" /> },
]

/** 全局搜索命令面板（Ctrl+K）：跨页面与客户端搜索，回车跳转 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const { clients } = useServerData()
  const [query, setQuery] = useState("")
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const allEntries = useMemo<Entry[]>(
    () => [
      ...pages,
      ...clients.map((client) => ({
        id: `c-${client.id}`,
        section: "客户端" as const,
        label: client.name,
        desc: `${client.hostname} · ${client.ip} · ${client.os}`,
        keywords: `${client.hostname} ${client.ip} ${client.os} ${client.tags.join(" ")} ${client.group}`,
        href: "/clients",
        icon: <MonitorSmartphone className="h-4 w-4" />,
        dot: statusMeta[client.status].dot,
      })),
    ],
    [clients],
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allEntries
    return allEntries.filter(
      (e) => e.label.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q) || e.keywords.toLowerCase().includes(q),
    )
  }, [allEntries, query])

  // 打开时聚焦并重置
  useEffect(() => {
    if (!open) return
    setQuery("")
    setActiveIdx(0)
    const t = setTimeout(() => inputRef.current?.focus(), 80)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => setActiveIdx(0), [query])

  // 高亮项滚动到可视区
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [activeIdx])

  const go = (entry: Entry) => {
    onClose()
    router.push(entry.href)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return
      const entry = results[activeIdx]
      if (entry) go(entry)
    }
  }

  // 分组渲染：保持 results 顺序，遇到新分区插入小标题
  let lastSection: string | null = null

  return (
    <ModalShell open={open} onClose={onClose} label="全局搜索" maxWidth="max-w-lg" align="top">
      {/* 搜索输入 */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3.5">
        <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="搜索页面、客户端、IP 或标签 ..."
          aria-label="全局搜索"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
        />
        <kbd className="shrink-0 rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          ESC
        </kbd>
      </div>

      {/* 结果列表 */}
      <div ref={listRef} className="min-h-0 max-h-[46vh] flex-1 overflow-y-auto p-2">
        {results.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">{`没有匹配「${query}」的结果`}</p>
        ) : (
          results.map((e, i) => {
            const showHeader = e.section !== lastSection
            lastSection = e.section
            return (
              <div key={e.id}>
                {showHeader && (
                  <p className="px-3 pb-1 pt-2.5 text-[11px] font-medium text-muted-foreground/70">{e.section}</p>
                )}
                <button
                  type="button"
                  data-idx={i}
                  onClick={() => go(e)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                    i === activeIdx ? "bg-primary/12" : "hover:bg-surface",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      i === activeIdx ? "bg-primary/15 text-primary" : "bg-surface text-muted-foreground",
                    )}
                  >
                    {e.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={cn("truncate text-sm font-medium", i === activeIdx && "text-primary")}>
                        {e.label}
                      </span>
                      {e.dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", e.dot)} />}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{e.desc}</span>
                  </span>
                  {i === activeIdx && <CornerDownLeft className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </button>
              </div>
            )
          })
        )}
      </div>

      {/* 底部快捷键提示 */}
      <div className="flex shrink-0 items-center gap-4 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground/70">
        <span className="flex items-center gap-1.5">
          <kbd className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[10px]">↑↓</kbd>
          切换
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[10px]">Enter</kbd>
          跳转
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <kbd className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[10px]">Ctrl K</kbd>
          呼出
        </span>
      </div>
    </ModalShell>
  )
}
