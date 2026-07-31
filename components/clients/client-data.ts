export type ClientStatus = "online" | "offline" | "warning"

export type Client = {
  id: string
  name: string
  hostname: string
  ip: string
  os: "Windows" | "macOS" | "Linux"
  status: ClientStatus
  tags: string[]
  group: string
  version: string
  lastSeen: number
  registeredAt: number
  metrics: { cpu: number; memory: number; disk: number; uptime: number } | null
  connected: boolean
}

export const statusMeta: Record<
  ClientStatus,
  { label: string; dot: string; text: string; ring: string }
> = {
  online: {
    label: "在线",
    dot: "bg-primary",
    text: "text-primary",
    ring: "shadow-[0_0_0_3px_oklch(0.82_0.19_145_/_18%)]",
  },
  warning: {
    label: "告警",
    dot: "bg-[#dce02d]",
    text: "text-[#dce02d]",
    ring: "shadow-[0_0_0_3px_oklch(0.85_0.18_100_/_18%)]",
  },
  offline: {
    label: "离线",
    dot: "bg-negative",
    text: "text-negative",
    ring: "shadow-[0_0_0_3px_oklch(0.65_0.2_25_/_18%)]",
  },
}

