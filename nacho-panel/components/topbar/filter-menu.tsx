"use client"

import { useState } from "react"
import { RotateCcw, SlidersHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { statusMeta, type ClientStatus } from "@/components/clients/client-data"
import { useServerData } from "@/components/server-data-context"
import { InlineExpandMenu } from "@/components/ui/inline-expand-menu"
import { useTopbarActions } from "./topbar-actions-context"
import { countActiveFilters, defaultFilters, type HomeFilters } from "./filter-state"

const ranges: { id: HomeFilters["range"]; label: string }[] = [
  { id: "24h", label: "近 24 小时" },
  { id: "7d", label: "近 7 天" },
  { id: "30d", label: "近 30 天" },
]

const chipCls = (active: boolean) =>
  cn(
    "flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors",
    active
      ? "border-primary/50 bg-primary/12 text-primary"
      : "border-border bg-surface/60 text-muted-foreground hover:bg-surface hover:text-foreground",
  )

/**
 * 仪表盘筛选：筛选按钮原位向下长成一张卡片，按钮留在卡片左上角作为入口。
 * 状态多选 + 分组单选 + 时间范围，即改即生效；重置一键恢复默认。
 * 卡片按视口剩余空间自动决定向右/向左展开，不再另起浮层。
 */
export function FilterMenu() {
  const actions = useTopbarActions()
  const { groups } = useServerData()
  const [open, setOpen] = useState(false)

  if (!actions) return null

  const { filters, setFilters, filterCount } = actions
  const activeCount = countActiveFilters(filters)

  const toggleStatus = (status: ClientStatus) =>
    setFilters({
      ...filters,
      statuses: filters.statuses.includes(status)
        ? filters.statuses.filter((item) => item !== status)
        : [...filters.statuses, status],
    })

  const toggleGroup = (group: string | null) =>
    setFilters({ ...filters, group: group === filters.group ? null : group })

  return (
    <InlineExpandMenu
      open={open}
      onOpenChange={setOpen}
      triggerLabel="仪表盘筛选"
      panelLabel="仪表盘筛选"
      panelWidth={320}
      triggerHeight={48}
      radius={24}
      align="auto"
      panelRole="dialog"
      triggerClassName="h-12 w-12 rounded-[24px] bg-surface text-foreground transition-colors hover:bg-muted"
      expandedTriggerClassName="bg-transparent hover:bg-surface/60"
      skinClassName="border border-border bg-card shadow-[0_24px_60px_-20px_oklch(0_0_0_/_85%)]"
      trigger={
        <>
          <SlidersHorizontal className="h-5 w-5" />
          {filterCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-negative px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {filterCount > 9 ? "9+" : filterCount}
            </span>
          )}
        </>
      }
      header={
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <h2 className="truncate text-sm font-semibold">仪表盘筛选</h2>
          <button
            type="button"
            onClick={() => setFilters(defaultFilters)}
            disabled={activeCount === 0}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重置
          </button>
        </div>
      }
    >
      <div className="flex flex-col p-5 pt-1">
        <p className="pb-2 text-[11px] font-medium text-muted-foreground/70">客户端状态（多选）</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(statusMeta) as ClientStatus[]).map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={filters.statuses.includes(status)}
              onClick={() => toggleStatus(status)}
              className={chipCls(filters.statuses.includes(status))}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", statusMeta[status].dot)} />
              {statusMeta[status].label}
            </button>
          ))}
        </div>

        <p className="mt-4 pb-2 text-[11px] font-medium text-muted-foreground/70">所属分组</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={filters.group === null}
            onClick={() => toggleGroup(null)}
            className={chipCls(filters.group === null)}
          >
            全部
          </button>
          {groups.map((group) => (
            <button
              key={group}
              type="button"
              aria-pressed={filters.group === group}
              onClick={() => toggleGroup(group)}
              className={chipCls(filters.group === group)}
            >
              {group}
            </button>
          ))}
        </div>

        <p className="mt-4 pb-2 text-[11px] font-medium text-muted-foreground/70">统计时间范围</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ranges.map((range) => (
            <button
              key={range.id}
              type="button"
              aria-pressed={filters.range === range.id}
              onClick={() => setFilters({ ...filters, range: range.id })}
              className={cn(chipCls(filters.range === range.id), "justify-center")}
            >
              {range.label}
            </button>
          ))}
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/60">
          {activeCount > 0 ? `已启用 ${activeCount} 项筛选，实时生效` : "未启用筛选，展示全部数据"}
        </p>
      </div>
    </InlineExpandMenu>
  )
}
