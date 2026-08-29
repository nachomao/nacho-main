"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useServerData } from "@/components/server-data-context"
import { AddClientDialog } from "./add-client-dialog"
import { WebSSHDialog } from "./webssh-dialog"
import { useAIMode } from "@/components/ai-mode/ai-mode-context"
import { CommandPalette } from "./command-palette"
import { NotificationsDrawer, initialNotices, type Notice } from "./notifications-drawer"
import { FilterPopover, countActiveFilters, defaultFilters, type HomeFilters } from "./filter-popover"

type TopbarActionsContextValue = {
  /** 打开添加客户端向导 */
  openAdd: () => void
  /** 打开远程终端 WebSSH */
  openTerminal: () => void
  /** 打开通知中心 */
  openNotices: () => void
  /** 打开全局搜索（Ctrl+K） */
  openSearch: () => void
  /** 打开仪表盘筛选浮层（锚定到触发按钮下方） */
  openFilter: (el: HTMLElement) => void
  /** 当前筛选条件与已激活条数 */
  filters: HomeFilters
  filterCount: number
  /** 未读通知数 */
  unread: number
  /** 打开 AI Mode 操作面板 */
  openAI: () => void
  onlineCount: number
  totalCount: number
}

const TopbarActionsContext = createContext<TopbarActionsContextValue | null>(null)

export function useTopbarActions() {
  return useContext(TopbarActionsContext)
}

/**
 * 顶栏功能提供者：集中管理添加客户端 / 筛选 / 远程终端 / 通知中心 /
 * 全局搜索（Ctrl+K）/ 在线视图开关的状态，并在此渲染各弹层。
 */
export function TopbarActionsProvider({ children }: { children: React.ReactNode }) {
  const [addOpen, setAddOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [noticesOpen, setNoticesOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [filterAnchor, setFilterAnchor] = useState<{ top: number; left: number } | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState<HomeFilters>(defaultFilters)
  const [notices, setNotices] = useState<Notice[]>(initialNotices)
  const aiMode = useAIMode()
  const { clients } = useServerData()

  // 全局快捷键 Ctrl/Cmd + K 呼出搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const openFilter = useCallback((el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setFilterAnchor({ top: r.bottom + 10, left: r.left })
    setFilterOpen(true)
  }, [])

  const unread = notices.filter((n) => !n.read).length
  const onlineCount = clients.filter((c) => c.status === "online").length

  const value = useMemo<TopbarActionsContextValue>(
    () => ({
      openAdd: () => setAddOpen(true),
      openTerminal: () => setTerminalOpen(true),
      openNotices: () => setNoticesOpen(true),
      openSearch: () => setSearchOpen(true),
      openFilter,
      filters,
      filterCount: countActiveFilters(filters),
      unread,
      openAI: aiMode.enter,
      onlineCount,
      totalCount: clients.length,
    }),
    [openFilter, filters, unread, onlineCount, clients.length, aiMode.enter],
  )

  return (
    <TopbarActionsContext.Provider value={value}>
      {children}

      <AddClientDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <WebSSHDialog open={terminalOpen} onClose={() => setTerminalOpen(false)} />
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <NotificationsDrawer
        open={noticesOpen}
        onClose={() => setNoticesOpen(false)}
        notices={notices}
        onRead={(id) => setNotices((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))}
        onReadAll={() => setNotices((prev) => prev.map((n) => ({ ...n, read: true })))}
        onClear={() => setNotices([])}
      />
      <FilterPopover
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        anchor={filterAnchor}
        filters={filters}
        onChange={setFilters}
      />
    </TopbarActionsContext.Provider>
  )
}
