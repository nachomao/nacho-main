"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import {
  Check,
  DownloadCloud,
  FileArchive,
  FolderInput,
  ListChecks,
  Package,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { PluginCard } from "./plugin-card"
import {
  categories,
  iconMap,
  newParam,
  type Plugin,
  type PluginParam,
  usePlugins,
} from "./plugins-context"

const inputCls =
  "h-11 w-full rounded-xl border border-border bg-surface/60 px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:bg-surface"

/* ------------- 通用对话框外壳（沿用安装对话框的模糊缩放揭示动效） ------------- */
function DialogShell({
  open,
  onClose,
  icon,
  title,
  desc,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  icon: React.ReactNode
  title: string
  desc: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  // mounted 在退场动画期间保持挂载，shown 驱动渐显 / 渐隐
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)

  // 挂载 / 卸载：open 关闭时先播放渐隐，过渡结束后再卸载
  useEffect(() => {
    if (open) {
      setMounted(true)
      const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
      window.addEventListener("keydown", onKey)
      return () => window.removeEventListener("keydown", onKey)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), 460)
    return () => clearTimeout(t)
  }, [open, onClose])

  // 揭示：挂载后用双重 rAF 确保模糊帧先绘制，再切到清晰态，保证渐显动画
  useEffect(() => {
    if (!mounted || !open) return
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setShown(true))
    })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
    }
  }, [mounted, open])

  if (!mounted || typeof document === "undefined") return null

  // 通过 Portal 渲染到 body，脱离带 transform 的祖先（页面过渡容器），
  // 否则 fixed 会相对该祖先定位，导致弹窗底部超出视口被裁剪。
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        aria-label="关闭"
        onClick={onClose}
        className="fixed inset-0 bg-background/70 backdrop-blur-sm"
        style={{
          opacity: shown ? 1 : 0,
          transition: shown ? "opacity 360ms ease-out" : "opacity 420ms cubic-bezier(0.55,0,0.68,0.4)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card-glow relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-card"
        style={{
          transform: shown ? "translateY(0) scale(1)" : "translateY(12px) scale(0.97)",
          opacity: shown ? 1 : 0,
          filter: shown ? "blur(0px)" : "blur(8px)",
          // 入场 ease-out 快速就位，退场 ease-in 缓慢起步，让模糊渐隐全程可见
          transition: shown
            ? "transform 460ms cubic-bezier(0.22,1,0.36,1), opacity 460ms ease-out, filter 460ms ease-out"
            : "transform 420ms cubic-bezier(0.55,0,0.68,0.4), opacity 420ms cubic-bezier(0.55,0,0.68,0.4), filter 420ms cubic-bezier(0.55,0,0.68,0.4)",
        }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border text-foreground">
              {icon}
            </span>
            <div>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
            </div>
          </div>
          <button
            aria-label="关闭"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>

        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-border p-5">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

const primaryBtn =
  "flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-95"
const ghostBtn =
  "flex h-11 items-center gap-2 rounded-xl border border-border bg-surface/60 px-5 text-sm font-medium text-foreground transition-colors hover:bg-surface"

/* ------------- 导入插件对话框 ------------- */
function ImportDialog() {
  const ctx = usePlugins()!
  const [name, setName] = useState("")
  const [version, setVersion] = useState("1.0.0")
  const [category, setCategory] = useState("工具")
  const [description, setDescription] = useState("")

  const reset = () => {
    setName("")
    setVersion("1.0.0")
    setCategory("工具")
    setDescription("")
  }

  const submit = () => {
    if (!name.trim()) return
    ctx.addPlugin({
      name: name.trim(),
      version: version.trim() || "1.0.0",
      author: "本地导入",
      category,
      description: description.trim() || "通过本地包导入的插件。",
      size: "—",
      icon: "puzzle",
      status: "installed",
      params: [],
    })
    reset()
    ctx.closeImport()
  }

  return (
    <DialogShell
      open={ctx.importOpen}
      onClose={ctx.closeImport}
      icon={<FolderInput className="h-5 w-5" />}
      title="导入插件"
      desc="从本地插件包（.zip / .npkg）导入并安装到面板"
      footer={
        <>
          <button className={ghostBtn} onClick={ctx.closeImport}>
            取消
          </button>
          <button className={primaryBtn} onClick={submit}>
            <FolderInput className="h-4 w-4" />
            导入并安装
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* 拖拽区（演示） */}
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface/40 py-8 text-center transition-colors hover:border-primary/50 hover:bg-surface/60">
          <FileArchive className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">拖拽插件包到此处，或点击选择文件</p>
          <p className="text-xs text-muted-foreground">支持 .zip / .npkg，单个不超过 50 MB</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="插件名称">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 系统还原" />
          </Field>
          <Field label="版本号">
            <input className={cn(inputCls, "font-mono")} value={version} onChange={(e) => setVersion(e.target.value)} />
          </Field>
        </div>

        <Field label="分类">
          <div className="flex flex-wrap gap-2">
            {categories.slice(1).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                  category === c ? "bg-primary text-primary-foreground" : "border border-border bg-surface/60 text-muted-foreground hover:bg-surface",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </Field>

        <Field label="描述">
          <textarea
            className={cn(inputCls, "h-24 resize-none py-3 leading-relaxed")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="简要说明插件功能"
          />
        </Field>
      </div>
    </DialogShell>
  )
}

/* ------------- 下载插件对话框（需自行填入下载服务器） ------------- */
function DownloadDialog() {
  const ctx = usePlugins()!
  const [identifier, setIdentifier] = useState("")
  const [pulled, setPulled] = useState(false)

  const server = ctx.downloadServer.trim()
  const normalized = server ? (/^https?:\/\//i.test(server) ? server.replace(/\/+$/, "") : `http://${server.replace(/\/+$/, "")}`) : ""
  const ready = !!normalized && !!identifier.trim()

  const pull = () => {
    if (!ready) return
    ctx.addPlugin({
      name: identifier.trim(),
      version: "latest",
      author: "远程仓库",
      category: "工具",
      description: `从下载服务器 ${normalized} 拉取的插件。`,
      size: "—",
      icon: "puzzle",
      status: "installed",
      params: [],
    })
    setPulled(true)
    setTimeout(() => {
      setPulled(false)
      setIdentifier("")
      ctx.closeDownload()
    }, 900)
  }

  return (
    <DialogShell
      open={ctx.downloadOpen}
      onClose={ctx.closeDownload}
      icon={<DownloadCloud className="h-5 w-5" />}
      title="下载插件"
      desc="填入下载服务器地址，从远程仓库拉取并安装插件"
      footer={
        <>
          <button className={ghostBtn} onClick={ctx.closeDownload}>
            取消
          </button>
          <button className={cn(primaryBtn, !ready && "cursor-not-allowed opacity-40 hover:scale-100")} onClick={pull} disabled={!ready}>
            <DownloadCloud className="h-4 w-4" />
            {pulled ? "已拉取" : "拉取并安装"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="下载服务器地址">
          <input
            className={cn(inputCls, "font-mono")}
            value={ctx.downloadServer}
            onChange={(e) => ctx.setDownloadServer(e.target.value)}
            placeholder="例如 http://repo.example.com:8443（需自行填入）"
          />
        </Field>

        <Field label="插件标识 / 名称">
          <input
            className={cn(inputCls, "font-mono")}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="例如 system-restore"
          />
        </Field>

        {/* 拉取地址预览 */}
        <div className="rounded-2xl border border-border bg-background/40 p-3">
          <p className="px-1 pb-2 text-xs font-medium text-muted-foreground">拉取地址预览</p>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface/60 p-3">
            <Server className="h-4 w-4 shrink-0 text-primary" />
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12.5px] text-foreground">
              {normalized ? `${normalized}/plugins/${identifier.trim() || "<标识>"}/download` : "请先填写下载服务器地址"}
            </code>
          </div>
        </div>
      </div>
    </DialogShell>
  )
}

/* ------------- 编辑插件对话框（含可自定义参数） ------------- */
function EditDialog() {
  const ctx = usePlugins()!
  const editing = ctx.editing
  const [draft, setDraft] = useState<Plugin | null>(null)

  // 仅在打开时回填草稿；关闭时保留上次草稿，让 DialogShell 退场动画期间内容不闪烁/不丢失
  useEffect(() => {
    if (editing) setDraft({ ...editing, params: editing.params.map((p) => ({ ...p })) })
  }, [editing])

  // 从未打开过则不渲染；一旦打开后即便 editing 变 null 也保留草稿，交由 open 驱动渐隐
  if (!draft) return null

  const Icon = iconMap[draft.icon] ?? iconMap.puzzle
  const set = <K extends keyof Plugin>(k: K, v: Plugin[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))

  const setParam = (id: string, patch: Partial<PluginParam>) =>
    setDraft((d) => (d ? { ...d, params: d.params.map((p) => (p.id === id ? { ...p, ...patch } : p)) } : d))
  const addParamRow = () => setDraft((d) => (d ? { ...d, params: [...d.params, newParam()] } : d))
  const removeParamRow = (id: string) =>
    setDraft((d) => (d ? { ...d, params: d.params.filter((p) => p.id !== id) } : d))

  const save = () => {
    if (!draft) return
    ctx.updatePlugin({ ...draft, params: draft.params.filter((p) => p.label.trim()) })
    ctx.stopEdit()
  }

  return (
    <DialogShell
      open={!!editing}
      onClose={ctx.stopEdit}
      icon={<Icon className="h-5 w-5" />}
      title={`编辑：${draft.name}`}
      desc="修改插件信息与可自定义参数"
      footer={
        <>
          <button className={ghostBtn} onClick={ctx.stopEdit}>
            取消
          </button>
          <button className={primaryBtn} onClick={save}>
            <Check className="h-4 w-4" />
            保存修改
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="插件名称">
            <input className={inputCls} value={draft.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="版本号">
            <input className={cn(inputCls, "font-mono")} value={draft.version} onChange={(e) => set("version", e.target.value)} />
          </Field>
        </div>

        <Field label="分类">
          <div className="flex flex-wrap gap-2">
            {categories.slice(1).map((c) => (
              <button
                key={c}
                onClick={() => set("category", c)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                  draft.category === c ? "bg-primary text-primary-foreground" : "border border-border bg-surface/60 text-muted-foreground hover:bg-surface",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </Field>

        <Field label="描述">
          <textarea
            className={cn(inputCls, "h-20 resize-none py-3 leading-relaxed")}
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>

        {/* 重启即恢复开关 */}
        <div className="flex items-center justify-between rounded-2xl border border-border bg-surface/60 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <RefreshCw className="h-4 w-4 text-primary" />
            <div className="leading-tight">
              <p className="text-sm font-medium">重启即恢复</p>
              <p className="text-xs text-muted-foreground">重启后自动还原至基准快照</p>
            </div>
          </div>
          <button
            role="switch"
            aria-checked={!!draft.restartRestore}
            onClick={() => set("restartRestore", !draft.restartRestore)}
            className={cn("relative h-6 w-11 rounded-full transition-colors", draft.restartRestore ? "bg-primary" : "bg-muted")}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-foreground transition-transform",
                draft.restartRestore ? "left-0.5 translate-x-5 bg-primary-foreground" : "left-0.5",
              )}
            />
          </button>
        </div>

        {/* 自定义参数 */}
        <div className="rounded-2xl border border-border bg-surface/40 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">自定义参数</p>
            <button
              onClick={addParamRow}
              className="flex h-8 items-center gap-1.5 rounded-full bg-primary/12 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            >
              <Plus className="h-3.5 w-3.5" />
              添加参数
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {draft.params.length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">暂无参数，点击「添加参数」新增。</p>
            )}
            {draft.params.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <input
                  className={cn(inputCls, "h-10 flex-1")}
                  value={p.label}
                  onChange={(e) => setParam(p.id, { label: e.target.value })}
                  placeholder="参数名"
                />
                <input
                  className={cn(inputCls, "h-10 flex-1 font-mono")}
                  value={p.value}
                  onChange={(e) => setParam(p.id, { value: e.target.value })}
                  placeholder="参数值"
                />
                <button
                  aria-label="删除参数"
                  onClick={() => removeParamRow(p.id)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-negative/40 hover:bg-negative/10 hover:text-negative"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DialogShell>
  )
}

/* ------------- 主视图 ------------- */
export function PluginsView() {
  const ctx = usePlugins()
  const [activeCat, setActiveCat] = useState<string>("全部")
  const [removing, setRemoving] = useState<string[]>([])

  const plugins = ctx?.plugins ?? []
  const filtered = useMemo(
    () => (activeCat === "全部" ? plugins : plugins.filter((p) => p.category === activeCat)),
    [plugins, activeCat],
  )

  if (!ctx) return null

  const handleDelete = (id: string) => {
    setRemoving((r) => [...r, id])
    setTimeout(() => {
      ctx.deletePlugin(id)
      setRemoving((r) => r.filter((x) => x !== id))
    }, 380)
  }

  const installedCount = plugins.filter((p) => p.status === "installed").length

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pr-1">
      {/* 统计 + 分类筛选 */}
      <div className="card-glow flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-card p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-foreground">
            <Package className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">
              共 {ctx.plugins.length} 个插件 · {installedCount} 个已安装
            </p>
            <p className="text-xs text-muted-foreground">导入、下载、编辑、删除与批量安装</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setActiveCat(c)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-200",
                activeCat === c
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  : "border border-border bg-surface/60 text-muted-foreground hover:bg-surface hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* 批量安装提示条：随选择模式切入/切出（高度 + 透明度 + 模糊过渡） */}
      <div
        className="shrink-0 overflow-hidden"
        style={{
          maxHeight: ctx.selectMode ? "96px" : "0px",
          opacity: ctx.selectMode ? 1 : 0,
          filter: ctx.selectMode ? "blur(0px)" : "blur(6px)",
          transition: "max-height 420ms cubic-bezier(0.22,1,0.36,1), opacity 360ms ease-out, filter 360ms ease-out",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <ListChecks className="h-4 w-4 text-primary" />
            <span className="font-medium">批量安装模式</span>
            <span className="text-muted-foreground">已选择 {ctx.selected.length} 个插件</span>
          </div>
          <div className="flex items-center gap-2">
            <button className={cn(ghostBtn, "h-9 px-4 text-xs")} onClick={ctx.toggleSelectMode}>
              取消
            </button>
            <button
              className={cn(primaryBtn, "h-9 px-4 text-xs", ctx.selected.length === 0 && "cursor-not-allowed opacity-40 hover:scale-100")}
              onClick={ctx.batchInstall}
              disabled={ctx.selected.length === 0}
            >
              <Check className="h-3.5 w-3.5" />
              安装所选（{ctx.selected.length}）
            </button>
          </div>
        </div>
      </div>

      {/* 插件网格 */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p, i) => (
            <PluginCard key={p.id} plugin={p} index={i} removing={removing.includes(p.id)} onDelete={handleDelete} />
          ))}
        </div>
      ) : (
        <div className="card-glow flex flex-col items-center justify-center gap-2 rounded-3xl bg-card py-16 text-muted-foreground">
          <Package className="h-8 w-8" />
          <p className="text-sm">该分类下暂无插件。</p>
        </div>
      )}

      {/* 对话框 */}
      <ImportDialog />
      <DownloadDialog />
      <EditDialog />
    </div>
  )
}
