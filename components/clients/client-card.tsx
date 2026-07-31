"use client"

import { Apple, Loader2, Network, Server, Terminal, Trash2 } from "lucide-react"
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
  onDelete,
}: {
  client: Client
  deleting?: boolean
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
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-negative/50 hover:bg-negative/10 hover:text-negative disabled:pointer-events-none disabled:opacity-50"
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
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {client.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
