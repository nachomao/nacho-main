"use client"

import { useEffect, useState } from "react"
import { Check, Download, Pencil, Power, RefreshCw, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { iconMap, type Plugin, type PluginStatus, usePlugins } from "./plugins-context"

const statusMeta: Record<PluginStatus, { label: string; dot: string; text: string }> = {
  installed: { label: "已安装", dot: "bg-primary", text: "text-primary" },
  available: { label: "未安装", dot: "bg-muted-foreground", text: "text-muted-foreground" },
  disabled: { label: "已停用", dot: "bg-negative", text: "text-negative" },
}

export function PluginCard({
  plugin,
  removing,
  onDelete,
  index,
}: {
  plugin: Plugin
  removing: boolean
  onDelete: (id: string) => void
  index: number
}) {
  const ctx = usePlugins()
  const Icon = iconMap[plugin.icon] ?? iconMap.puzzle
  const s = statusMeta[plugin.status]

  // 入场动画：挂载后由模糊缩放渐显就位（多出动画），按索引错峰
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  if (!ctx) return null

  const selected = ctx.selected.includes(plugin.id)
  const selectMode = ctx.selectMode
  const isDownload = plugin.status === "available"

  const handleCardClick = () => {
    if (selectMode) ctx.toggleSelect(plugin.id)
  }

  // 离场（减少动画）：模糊 + 缩小 + 下移；入场反之
  const visible = shown && !removing
  const style: React.CSSProperties = {
    opacity: visible ? 1 : 0,
    filter: visible ? "blur(0px)" : "blur(8px)",
    transform: visible ? "translateY(0) scale(1)" : removing ? "translateY(8px) scale(0.94)" : "translateY(14px) scale(0.97)",
    transition:
      "opacity 420ms ease-out, filter 420ms ease-out, transform 460ms cubic-bezier(0.22,1,0.36,1)",
    transitionDelay: shown && !removing ? `${index * 55}ms` : "0ms",
  }

  return (
    <div style={style}>
      <div
        role={selectMode ? "button" : undefined}
        onClick={handleCardClick}
        className={cn(
          "group relative flex h-full flex-col rounded-2xl border bg-surface/60 p-4 transition-all duration-300",
          selectMode
            ? "cursor-pointer hover:bg-surface"
            : "hover:-translate-y-1 hover:bg-surface hover:shadow-[0_12px_28px_-8px_oklch(0_0_0_/_45%)]",
          selected ? "border-primary ring-1 ring-primary" : "border-border",
        )}
      >
        {/* 选择态勾选圈：批量安装模式下显示 */}
        {selectMode && (
          <span
            className={cn(
              "absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border transition-all duration-200",
              selected ? "border-primary bg-primary text-primary-foreground scale-100" : "border-border bg-background/40 scale-90",
            )}
          >
            {selected && <Check className="h-3.5 w-3.5" />}
          </span>
        )}

        {/* 头部：图标 + 名称 + 版本 */}
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary transition-transform duration-300 group-hover:scale-105">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold">{plugin.name}</p>
            <p className="text-xs text-muted-foreground">
              v{plugin.version} · {plugin.size}
            </p>
          </div>
        </div>

        {/* 描述 */}
        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{plugin.description}</p>

        {/* 标签：分类 + 重启即恢复 */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-background/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {plugin.category}
          </span>
          {plugin.restartRestore && (
            <span className="flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">
              <RefreshCw className="h-3 w-3" />
              重启即恢复
            </span>
          )}
        </div>

        {/* 底部：状态 + 操作 */}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
          <span className={cn("flex items-center gap-1.5 text-xs font-medium", s.text)}>
            <span className={cn("h-2 w-2 rounded-full", s.dot)} />
            {s.label}
          </span>

          {/* 操作按钮：批量模式下隐藏，避免与选择冲突 */}
          {!selectMode && (
            <div className="flex items-center gap-1.5">
              {/* 启用/停用（仅已安装/已停用之间切换） */}
              {plugin.status !== "available" && (
                <button
                  aria-label={plugin.status === "disabled" ? "启用" : "停用"}
                  onClick={() => ctx.setStatus(plugin.id, plugin.status === "disabled" ? "installed" : "disabled")}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border border-border transition-colors hover:bg-muted",
                    plugin.status === "disabled" ? "text-muted-foreground" : "text-primary",
                  )}
                >
                  <Power className="h-3.5 w-3.5" />
                </button>
              )}
              {/* 下载安装（未安装时） */}
              {isDownload && (
                <button
                  aria-label="下载安装"
                  onClick={() => ctx.setStatus(plugin.id, "installed")}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-muted"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              )}
              {/* 编辑 */}
              <button
                aria-label="编辑"
                onClick={() => ctx.startEdit(plugin)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-muted"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {/* 删除 */}
              <button
                aria-label="删除"
                onClick={() => onDelete(plugin.id)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-negative/40 hover:bg-negative/10 hover:text-negative"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
