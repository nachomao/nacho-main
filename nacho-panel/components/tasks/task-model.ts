import { Monitor, Terminal } from "lucide-react"
import type { TaskLastStatus } from "@/lib/task-schedule-format"
import type { OSType } from "./tasks-context"

export type TriggerId = "daily" | "weekly" | "logon" | "startup" | "boot" | "cron"

export type ScheduledTask = {
  id: string
  name: string
  os: OSType
  action: string
  /* 原始字段，便于编辑时精确回填 */
  program: string
  args: string
  triggerId: TriggerId
  time: string
  interval: number
  cron: string
  /** IANA 时区；旧版服务端可能不返回 */
  timezone?: string
  clientIds: string[]
  enabled: boolean
  /* 服务端调度状态（旧版服务端可能不返回） */
  nextRunAt?: number | null
  lastRunAt?: number | null
  lastStatus?: TaskLastStatus
  lastError?: string | null
  createdAt?: number
}

/* ---------- 操作系统展示元数据 ---------- */
export const osMeta: Record<OSType, { label: string; icon: typeof Monitor; pathHint: string; pathPlaceholder: string }> = {
  windows: {
    label: "Windows",
    icon: Monitor,
    pathHint: "目标客户端上的绝对路径，例如 C:\\Scripts\\backup.bat",
    pathPlaceholder: "C:\\Scripts\\backup.bat",
  },
  linux: {
    label: "Linux",
    icon: Terminal,
    pathHint: "目标主机上的绝对路径，例如 /opt/scripts/backup.sh",
    pathPlaceholder: "/opt/scripts/backup.sh",
  },
}

export function triggerSummary(_os: OSType, id: TriggerId, time: string, interval: number, cron: string) {
  switch (id) {
    case "daily":
      return `每 ${interval} 天 · ${time}`
    case "weekly":
      return `每 ${interval} 周 · ${time}`
    case "logon":
      return "用户登录时"
    case "startup":
      return "系统启动时"
    case "boot":
      return "开机时（@reboot）"
    case "cron":
      return `Cron · ${cron}`
    default:
      return time
  }
}

/* 登录 / 启动 / 开机类触发器由客户端事件驱动，服务端不计算 nextRunAt */
export function isEventTrigger(id: TriggerId) {
  return id === "logon" || id === "startup" || id === "boot"
}

/* 由程序 + 参数拼出展示路径 */
export function taskPath(t: Pick<ScheduledTask, "program" | "args">) {
  return t.args.trim() ? `${t.program} ${t.args}`.trim() : t.program
}
