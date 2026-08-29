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
import { useServerData } from "@/components/server-data-context"
import { usePanelResource } from "@/components/use-panel-resource"

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

/* ---------------- 工具：创建空白参数行 ---------------- */
let paramSeq = 0
export const newParam = (): PluginParam => ({ id: `np-${++paramSeq}-${Date.now()}`, label: "", value: "" })

/* ---------------- Context ---------------- */

type PluginsCtx = {
  plugins: Plugin[]
  /** 服务端加载态：首次拉取 /api/panel/plugins 期间为 true */
  loading: boolean
  /** 加载失败信息，null 表示正常 */
  error: string | null
  /** 写操作失败信息，与加载失败分开展示 */
  actionError: string | null
  dismissActionError: () => void
  /** 重新拉取插件列表 */
  reload: () => Promise<void>
  /** 正在提交的插件 id，用于禁用重复点击 */
  busyIds: string[]
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
  batchInstall: () => Promise<void>
  // CRUD：全部走服务端 /api/panel/plugins，成功后以服务端返回记录更新本地列表
  addPlugin: (p: Omit<Plugin, "id">) => Promise<void>
  updatePlugin: (p: Plugin) => Promise<void>
  deletePlugin: (id: string) => Promise<void>
  setStatus: (id: string, status: PluginStatus) => Promise<void>
  // 下载服务器
  downloadServer: string
  setDownloadServer: (v: string) => void
}

const Ctx = createContext<PluginsCtx | null>(null)

export function PluginsProvider({ children }: { children: React.ReactNode }) {
  const { apiRequest } = useServerData()
  const { data: plugins, setData: setPlugins, loading, error, reload } = usePanelResource<Plugin[]>("/plugins", [])
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<string[]>([])
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

  /* 服务端 pluginSchema 要求 restartRestore 与 params 必填，这里补齐默认值 */
  const pluginPayload = (p: Omit<Plugin, "id">) => ({
    name: p.name,
    version: p.version,
    author: p.author,
    category: p.category,
    description: p.description,
    size: p.size,
    icon: p.icon,
    status: p.status,
    restartRestore: p.restartRestore ?? false,
    params: p.params,
  })

  /* 统一包装写操作：标记忙碌、清理旧错误、失败时保留列表不变 */
  const mutate = async (key: string, run: () => Promise<void>, failMessage: string) => {
    if (busyIds.includes(key)) return
    setBusyIds((b) => [...b, key])
    setActionError(null)
    try {
      await run()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : failMessage)
    } finally {
      setBusyIds((b) => b.filter((x) => x !== key))
    }
  }

  /* 批量安装：逐个提交状态，全部成功后才退出选择模式 */
  const batchInstall = () =>
    mutate(
      "batch",
      async () => {
        const updated = await Promise.all(
          selected.map((id) =>
            apiRequest<Plugin>(`/plugins/${id}/status`, {
              method: "POST",
              body: JSON.stringify({ status: "installed" }),
            }),
          ),
        )
        const byId = new Map(updated.map((p) => [p.id, p]))
        setPlugins((list) => list.map((p) => byId.get(p.id) ?? p))
        setSelected([])
        setSelectMode(false)
      },
      "批量安装失败",
    )

  const addPlugin = (p: Omit<Plugin, "id">) =>
    mutate(
      "create",
      async () => {
        const created = await apiRequest<Plugin>("/plugins", {
          method: "POST",
          body: JSON.stringify(pluginPayload(p)),
        })
        setPlugins((list) => [created, ...list])
      },
      "新增插件失败",
    )

  const updatePlugin = (p: Plugin) =>
    mutate(
      p.id,
      async () => {
        const saved = await apiRequest<Plugin>(`/plugins/${p.id}`, {
          method: "PATCH",
          body: JSON.stringify(pluginPayload(p)),
        })
        setPlugins((list) => list.map((x) => (x.id === saved.id ? saved : x)))
      },
      "保存插件失败",
    )

  const deletePlugin = (id: string) =>
    mutate(
      id,
      async () => {
        await apiRequest(`/plugins/${id}`, { method: "DELETE" })
        setPlugins((list) => list.filter((p) => p.id !== id))
        setSelected((s) => s.filter((x) => x !== id))
      },
      "删除插件失败",
    )

  const setStatus = (id: string, status: PluginStatus) =>
    mutate(
      id,
      async () => {
        const saved = await apiRequest<Plugin>(`/plugins/${id}/status`, {
          method: "POST",
          body: JSON.stringify({ status }),
        })
        setPlugins((list) => list.map((p) => (p.id === saved.id ? saved : p)))
      },
      "切换插件状态失败",
    )

  return (
    <Ctx.Provider
      value={{
        plugins,
        loading,
        error,
        actionError,
        dismissActionError: () => setActionError(null),
        reload,
        busyIds,
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
