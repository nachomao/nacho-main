"use client"

import { createPortal } from "react-dom"
import { RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { statusMeta, type ClientStatus } from "@/components/clients/client-data"
import { useServerData } from "@/components/server-data-context"
import { useOverlayTransition } from "./overlay"

export type HomeFilters = {
  /** 空数组 = 不按状态过滤 */
  statuses: ClientStatus[]
  /** null = 全部分组 */
  group: string | null
  range: "24h" | "7d" | "30d"
}

export const defaultFilters: HomeFilters = { statuses: [], group: null, range: "24h" }

/** 统计已激活的筛选条件数（时间范围非默认值也算一项） */
export function countActiveFilters(f: HomeFilters): number {
  return f.statuses.length + (f.group ? 1 : 0) + (f.range !== "24h" ? 1 : 0)
}

const ranges: { id: HomeFilters["range"]; label: string }[] = [
  { id: "24h", label: "近 24 小时" },
  { id: "7d", label: "近 7 天" },
  { id: "30d", label: "近 30 天" },
]

const chipCls = (active: boolean) =>
  cn(
    "flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors",
    active
      ? "border-primary/50 bg-primary/12 text-primary"
      : "border-border bg-surface/60 text-muted-foreground hover:bg-surface hover:text-foreground",
  )

/**
 * 仪表盘筛选器：锚定在顶栏筛选按钮下方的浮层。
 * 状态多选 + 分组单选 + 时间范围，即改即生效；重置一键恢复默认。
 */
export function FilterPopover({
  open,
  onClose,
  anchor,
  filters,
  onChange,
}: {
  open: boolean
  onClose: () => void
  /** 锚点按钮的矩形（打开瞬间记录） */
  anchor: { top: number; left: number } | null
  filters: HomeFilters
  onChange: (f: HomeFilters) => void
}) {
  const { groups } = useServerData()
  const { mounted, shown } = useOverlayTransition(open, onClose)
  if (!mounted || typeof document === "undefined" || !anchor) return null

  const toggleStatus = (s: ClientStatus) =>
    onChange({
      ...filters,
      statuses: filters.statuses.includes(s)
        ? filters.statuses.filter((x) => x !== s)
        : [...filters.statuses, s],
    })

  const activeCount = countActiveFilters(filters)

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* 透明遮罩：点击任意处关闭 */}
      <button aria-label="关闭筛选" onClick={onClose} className="fixed inset-0 cursor-default" />

      <div
        role="dialog"
        aria-label="仪表盘筛选"
        className="card-glow absolute w-80 origin-top-left overflow-hidden rounded-3xl border border-border bg-card p-5"
        style={{
          top: anchor.top,
          left: Math.min(anchor.left, typeof window !== "undefined" ? window.innerWidth - 336 : anchor.left),
          opacity: shown ? 1 : 0,
          transform: shown ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.96)",
          filter: shown ? "blur(0px)" : "blur(6px)",
          transition:
            "opacity 300ms ease-out, transform 300ms cubic-bezier(0.22,1,0.36,1), filter 300ms ease-out",
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">仪表盘筛选</h2>
          <button
            type="button"
            onClick={() => onChange(defaultFilters)}
            disabled={activeCount === 0}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重置
          </button>
        </div>

        {/* 状态（多选） */}
        <p className="mt-4 pb-2 text-[11px] font-medium text-muted-foreground/70">客户端状态（多选）</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(statusMeta) as ClientStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={filters.statuses.includes(s)}
              onClick={() => toggleStatus(s)}
              className={chipCls(filters.statuses.includes(s))}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", statusMeta[s].dot)} />
              {statusMeta[s].label}
            </button>
          ))}
        </div>

        {/* 分组（单选） */}
        <p className="mt-4 pb-2 text-[11px] font-medium text-muted-foreground/70">所属分组</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={filters.group === null}
            onClick={() => onChange({ ...filters, group: null })}
            className={chipCls(filters.group === null)}
          >
            全部
          </button>
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={filters.group === g}
              onClick={() => onChange({ ...filters, group: filters.group === g ? null : g })}
              className={chipCls(filters.group === g)}
            >
              {g}
            </button>
          ))}
        </div>

        {/* 时间范围 */}
        <p className="mt-4 pb-2 text-[11px] font-medium text-muted-foreground/70">统计时间范围</p>
        <div className="flex gap-2">
          {ranges.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={filters.range === r.id}
              onClick={() => onChange({ ...filters, range: r.id })}
              className={cn(chipCls(filters.range === r.id), "flex-1 justify-center")}
            >
              {r.label}
            </button>
          ))}
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/60">
          {activeCount > 0 ? `已启用 ${activeCount} 项筛选，实时生效` : "未启用筛选，展示全部数据"}
        </p>
      </div>
    </div>,
    document.body,
  )
}
