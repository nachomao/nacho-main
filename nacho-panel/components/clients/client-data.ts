export type ClientStatus = "online" | "offline" | "warning"

export type Client = {
  id: string
  name: string
  hostname: string
  ip: string
  os: "Windows" | "macOS" | "Linux"
  /** agent 上报的具体系统名，如 "Windows 11 专业版" / "ubuntu"，用于匹配发行版 logo */
  osName?: string | null
  status: ClientStatus
  tags: string[]
  group: string
  version: string
  lastSeen: number
  registeredAt: number
  metrics: { cpu: number; memory: number; disk: number; uptime: number } | null
  connected: boolean
}

/* 状态色固定使用语义令牌（positive/warning/negative），不随 data-theme 主色改变：
   设备是否在线是客观事实，蓝色主题下的「在线」不应变成蓝色。
   ring 用 color-mix 从同一语义色派生，保证色相始终与 dot/text 一致。 */
export const statusMeta: Record<ClientStatus, { label: string; dot: string; text: string; ring: string }> = {
  online: {
    label: "在线",
    dot: "bg-positive",
    text: "text-positive",
    ring: "shadow-[0_0_0_3px_color-mix(in_oklab,var(--positive)_20%,transparent)]",
  },
  warning: {
    label: "告警",
    dot: "bg-warning",
    text: "text-warning",
    ring: "shadow-[0_0_0_3px_color-mix(in_oklab,var(--warning)_20%,transparent)]",
  },
  offline: {
    label: "离线",
    dot: "bg-negative",
    text: "text-negative",
    ring: "shadow-[0_0_0_3px_color-mix(in_oklab,var(--negative)_20%,transparent)]",
  },
}

