"use client"

import { createContext, useContext, useState } from "react"
import {
  Activity,
  Camera,
  FolderSync,
  Gauge,
  Network,
  Puzzle,
  RotateCcw,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react"
import { mockSeedPlugins } from "@/lib/mock-panel-api"

/* ---------------- 类型 ---------------- */

export type PluginStatus = "installed" | "available" | "disabled"

export type PluginParam = { id: string; label: string; value: string }

export type Plugin = {
  id: string
  name: string
  version: string
  author: string
  category: string
  description: string
  size: string
  /** 图标键，映射到 iconMap */
  icon: string
  status: PluginStatus
  /** 系统还原类插件：重启即恢复 */
  restartRestore?: boolean
  params: PluginParam[]
}

/* 图标映射：卡片与对话框统一通过键获取，避免在数据里直接存组件 */
export const iconMap: Record<string, LucideIcon> = {
  shield: ShieldCheck,
  activity: Activity,
  gauge: Gauge,
  camera: Camera,
  sync: FolderSync,
  network: Network,
  puzzle: Puzzle,
  restore: RotateCcw,
}

export const categories = ["全部", "系统防护", "监控", "网络", "工具"] as const

/* ---------------- 演示数据 ---------------- */

let seq = 100
const nextId = () => `pg-${++seq}`

// 插件列表统一由服务端 API 获取；演示模式下用模拟种子填充
const demoPlugins: Plugin[] = mockSeedPlugins()

/* ---------------- 工具：创建空白参数行 ---------------- */
let paramSeq = 0
export const newParam = (): PluginParam => ({ id: `np-${++paramSeq}-${Date.now()}`, label: "", value: "" })

/* ---------------- Context ---------------- */

type PluginsCtx = {
  plugins: Plugin[]
  // 顶栏功能：导入
  importOpen: boolean
  openImport: () => void
  closeImport: () => void
  // 顶栏功能：下载
  downloadOpen: boolean
  openDownload: () => void
  closeDownload: () => void
  // 编辑
  editing: Plugin | null
  startEdit: (p: Plugin) => void
  stopEdit: () => void
  // 批量安装
  selectMode: boolean
  toggleSelectMode: () => void
  selected: string[]
  toggleSelect: (id: string) => void
  clearSelection: () => void
  batchInstall: () => void
  // CRUD
  addPlugin: (p: Omit<Plugin, "id">) => void
  updatePlugin: (p: Plugin) => void
  deletePlugin: (id: string) => void
  setStatus: (id: string, status: PluginStatus) => void
  // 下载服务器
  downloadServer: string
  setDownloadServer: (v: string) => void
}

const Ctx = createContext<PluginsCtx | null>(null)

export function PluginsProvider({ children }: { children: React.ReactNode }) {
  const [plugins, setPlugins] = useState<Plugin[]>(demoPlugins)
  const [importOpen, setImportOpen] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [editing, setEditing] = useState<Plugin | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [downloadServer, setDownloadServer] = useState("")

  const openImport = () => setImportOpen(true)
  const closeImport = () => setImportOpen(false)
  const openDownload = () => setDownloadOpen(true)
  const closeDownload = () => setDownloadOpen(false)

  const startEdit = (p: Plugin) => setEditing(p)
  const stopEdit = () => setEditing(null)

  const toggleSelectMode = () =>
    setSelectMode((v) => {
      if (v) setSelected([])
      return !v
    })

  const toggleSelect = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const clearSelection = () => setSelected([])

  const batchInstall = () => {
    setPlugins((list) => list.map((p) => (selected.includes(p.id) ? { ...p, status: "installed" } : p)))
    setSelected([])
    setSelectMode(false)
  }

  const addPlugin = (p: Omit<Plugin, "id">) => setPlugins((list) => [{ ...p, id: nextId() }, ...list])

  const updatePlugin = (p: Plugin) => setPlugins((list) => list.map((x) => (x.id === p.id ? p : x)))

  const deletePlugin = (id: string) => {
    setPlugins((list) => list.filter((p) => p.id !== id))
    setSelected((s) => s.filter((x) => x !== id))
  }

  const setStatus = (id: string, status: PluginStatus) =>
    setPlugins((list) => list.map((p) => (p.id === id ? { ...p, status } : p)))

  return (
    <Ctx.Provider
      value={{
        plugins,
        importOpen,
        openImport,
        closeImport,
        downloadOpen,
        openDownload,
        closeDownload,
        editing,
        startEdit,
        stopEdit,
        selectMode,
        toggleSelectMode,
        selected,
        toggleSelect,
        clearSelection,
        batchInstall,
        addPlugin,
        updatePlugin,
        deletePlugin,
        setStatus,
        downloadServer,
        setDownloadServer,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function usePlugins() {
  return useContext(Ctx)
}
