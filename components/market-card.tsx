"use client"

import { Monitor } from "lucide-react"
import { useServerData } from "@/components/server-data-context"

export function MarketCard() {
  const { clients } = useServerData()
  const onlineClients = clients.filter((client) => client.status === "online")
  return (
    <div className="card-glow flex h-full w-full flex-col overflow-hidden rounded-3xl bg-card p-6">
      <div className="flex items-start justify-between">
        <h3 className="text-lg font-semibold">在线客户端</h3>
      </div>

      <div className="mt-5 grid grid-cols-[1.5rem_1fr_auto_auto_auto] items-center gap-4 px-1 text-xs text-muted-foreground">
        <span>#</span>
        <span>Active Clients</span>
        <span className="text-right">Disk</span>
        <span className="text-right">CPU</span>
        <span className="text-right">Memory</span>
      </div>

      <div className="mt-2 min-h-0 flex-1 divide-y divide-border overflow-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'oklch(0.35 0.02 150) transparent' }}>
        {onlineClients.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center text-muted-foreground">
            <p className="text-sm">暂无在线客户端</p>
          </div>
        )}
        {onlineClients.map((client, index) => (
          <div
            key={client.id}
            className="grid grid-cols-[1.5rem_1fr_auto_auto_auto] items-center gap-4 px-1 py-3.5"
          >
            <span className="text-sm text-muted-foreground">{index + 1}</span>
            <div className="flex items-center gap-3">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary"
              >
                <Monitor className="h-4 w-4" />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-medium">{client.name}</p>
                <p className="text-xs text-muted-foreground">{client.hostname || client.ip}</p>
              </div>
            </div>
            <span className="text-right text-sm font-medium">{client.metrics?.disk ?? 0}%</span>
            <span className="text-right text-sm font-medium">{client.metrics?.cpu ?? 0}%</span>
            <span className="text-right text-sm font-medium">{client.metrics?.memory ?? 0}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
