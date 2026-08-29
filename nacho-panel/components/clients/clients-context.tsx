"use client"

import { createContext, useContext, useRef, useState } from "react"
import { FolderPlus, LayoutGrid, MonitorDown, MonitorSmartphone, RefreshCw } from "lucide-react"
import { AddClientPanel, AddGroupPanel, ClientUpdatePanel, ClientsPanel } from "./panels"
import { ExtensionsPanel } from "./extensions-panel"

export const clientTabs = [
  { id: "clients", label: "客户端", icon: MonitorSmartphone, Panel: ClientsPanel },
  { id: "add-client", label: "安装客户端", icon: MonitorDown, Panel: AddClientPanel },
  { id: "add-group", label: "添加分组", icon: FolderPlus, Panel: AddGroupPanel },
  { id: "update", label: "客户端更新", icon: RefreshCw, Panel: ClientUpdatePanel },
  { id: "extensions", label: "批量操作", icon: LayoutGrid, Panel: ExtensionsPanel },
]

type ClientTabsCtx = {
  active: number
  /** 离场层：切换时上一张卡片平移离开 */
  exiting: number | null
  /** 切换方向：1 = 往后切（卡片上移，下面贴上来）；-1 = 往前切（卡片下移，上面贴下来） */
  direction: 1 | -1
  select: (i: number) => void
}

const ClientTabsContext = createContext<ClientTabsCtx | null>(null)

export function ClientTabsProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(0)
  const [exiting, setExiting] = useState<number | null>(null)
  const [direction, setDirection] = useState<1 | -1>(1)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const select = (i: number) => {
    setActive((prev) => {
      if (i === prev) return prev
      // 根据目标标签相对当前的位置决定动画方向
      setDirection(i > prev ? 1 : -1)
      setExiting(prev)
      if (timer.current) clearTimeout(timer.current)
      // 与 animate-panel-exit 动画时长保持一致
      timer.current = setTimeout(() => setExiting(null), 500)
      return i
    })
  }

  return (
    <ClientTabsContext.Provider value={{ active, exiting, direction, select }}>
      {children}
    </ClientTabsContext.Provider>
  )
}

export function useClientTabs() {
  return useContext(ClientTabsContext)
}
