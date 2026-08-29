"use client"

import { Loader2, Network, Settings2, Trash2 } from "lucide-react"
import type { Client } from "./client-data"
import { statusMeta } from "./client-data"
import { OsLogo, resolveOsBrand } from "./os-logos"
import { cn } from "@/lib/utils"

export function ClientCard({
  client,
  deleting = false,
  onManage,
  onDelete,
}: {
  client: Client
  deleting?: boolean
  onManage?: (client: Client) => void
  /** origin 为触发按钮，确认弹层据此从按钮向卡片四角展开 */
  onDelete?: (client: Client, origin?: HTMLElement) => void
}) {
  const s = statusMeta[client.status]
  const brand = resolveOsBrand(client.os, client.osName)

  // data-confirm-surface：确认弹层在此卡片范围内就地展开
  return (
    <div
      data-confirm-surface
      className="group flex flex-col rounded-2xl border border-border bg-surface/60 p-4 transition-all duration-300 hover:-translate-y-1 hover:bg-surface hover:shadow-[0_12px_28px_-8px_oklch(0_0_0_/_45%)]"
    >
      <div className="flex items-start justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {/* 品牌实色块是卡片唯一的强色面，不再叠加状态光晕（状态已由底部指示器表达） */}
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-105"
            style={{ backgroundColor: brand.color }}
            title={brand.label}
          >
            <OsLogo brand={brand} className="h-5 w-5 text-white" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold">{client.name}</p>
            <p className="truncate text-xs text-muted-foreground">{client.hostname}</p>
          </div>
        </div>

        {/* 无边框幽灵按钮：破坏性操作不抢视觉权重，hover 时才显现语义色 */}
        <button
          type="button"
          title="删除客户端"
          aria-label={`删除客户端 ${client.name}`}
          disabled={deleting}
          onClick={(event) => onDelete?.(client, event.currentTarget)}
          className="-mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-negative/10 hover:text-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative disabled:pointer-events-none disabled:opacity-50"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>

      {/* IP 与系统名合为一条纯文本元信息行：减少方块数量，避免与底部标签重复成两套 chip */}
      <div className="mt-4 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Network className="h-3.5 w-3.5 shrink-0" />
        <span className="shrink-0 font-mono tabular-nums">{client.ip}</span>
        <span className="text-border" aria-hidden>
          |
        </span>
        <span className="truncate">{brand.label}</span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className={cn("flex shrink-0 items-center gap-1.5 text-xs font-medium", s.text)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
          {s.label}
        </span>
        <div className="flex min-w-0 items-center justify-end gap-1.5">
          {/* 标签是被动的分类信息，降级为中性色描边，不与可点元素争夺注意力 */}
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            {client.tags.map((tag) => (
              <span
                key={tag}
                className="max-w-24 truncate rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
          {/* 整行唯一的主色实心块：主色只留给这一个真正可执行的操作 */}
          <button
            type="button"
            title="管理客户端"
            aria-label={`管理客户端 ${client.name}`}
            onClick={() => onManage?.(client)}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-[filter,box-shadow] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <Settings2 className="h-3.5 w-3.5" />
            管理
          </button>
        </div>
      </div>
    </div>
  )
}
