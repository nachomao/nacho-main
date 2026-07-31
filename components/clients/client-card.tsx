"use client"

import { Apple, ChevronRight, Loader2, Network, Server, Settings2, Terminal, Trash2 } from "lucide-react"
import type { Client } from "./client-data"
import { statusMeta } from "./client-data"
import { cn } from "@/lib/utils"

const osMeta: Record<Client["os"], { icon: typeof Apple; color: string }> = {
  Windows: { icon: Terminal, color: "oklch(0.5 0.15 200)" },
  macOS: { icon: Apple, color: "oklch(0.7 0.02 250)" },
  Linux: { icon: Server, color: "oklch(0.72 0.16 60)" },
}

export function ClientCard({
  client,
  deleting = false,
  onManage,
  onDelete,
}: {
  client: Client
  deleting?: boolean
  onManage?: (client: Client) => void
  onDelete?: (client: Client) => void
}) {
  const s = statusMeta[client.status]
  const os = osMeta[client.os]
  const OsIcon = os.icon

  return (
    <div className="group flex flex-col rounded-2xl border border-border bg-surface/60 p-4 transition-all duration-300 hover:-translate-y-1 hover:bg-surface hover:shadow-[0_12px_28px_-8px_oklch(0_0_0_/_45%)]">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-105",
              s.ring,
            )}
            style={{ backgroundColor: os.color }}
          >
            <OsIcon className="h-5 w-5 text-white" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">{client.name}</p>
            <p className="text-xs text-muted-foreground">{client.hostname}</p>
          </div>
        </div>

        <button
          type="button"
          title="删除客户端"
          aria-label={`删除客户端 ${client.name}`}
          disabled={deleting}
          onClick={() => onDelete?.(client)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-negative/50 hover:bg-negative/10 hover:text-negative disabled:pointer-events-none disabled:opacity-50"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Network className="h-3.5 w-3.5" />
          <span className="font-mono">{client.ip}</span>
        </div>
        <span className="rounded-md bg-background/40 px-2 py-1 text-xs font-medium text-muted-foreground">
          {client.os}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className={cn("flex items-center gap-1.5 text-xs font-medium", s.text)}>
          <span className={cn("h-2 w-2 rounded-full", s.dot)} />
          {s.label}
        </span>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          {client.tags.map((tag) => (
            <span
              key={tag}
              className="max-w-24 truncate rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* 主操作：整块进入式动作条，与页面上其它「胶囊状」次级按钮明显区分 */}
      <button
        type="button"
        title="进入管理面板"
        aria-label={`进入 ${client.name} 的管理面板`}
        onClick={() => onManage?.(client)}
        className="group/manage mt-3 flex h-11 w-full items-center gap-2.5 overflow-hidden rounded-xl bg-primary pl-1.5 pr-3 text-primary-foreground shadow-[0_6px_16px_-8px_oklch(0_0_0_/_55%)] transition-all duration-300 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/15">
          <Settings2 className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start leading-tight">
          <span className="text-sm font-semibold">进入管理面板</span>
          <span className="truncate text-[11px] font-medium text-primary-foreground/70">
            终端 · 文件 · 插件 · 进程
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover/manage:translate-x-1" />
      </button>
    </div>
  )
}
