/* 系统设置的数据模型与默认值 */

export type GeneralSettings = {
  concurrency: number
  channelTimeout: number
  commandTimeout: number
  retryCount: number
  logRetentionDays: number
  logRetentionMax: number
  compressArchive: boolean
  offlineThreshold: number
  timezone: string
  autoCleanTasks: boolean
}

export type EmailSettings = {
  enabled: boolean
  host: string
  port: number
  encryption: "none" | "ssl" | "tls"
  username: string
  password: string
  from: string
  to: string
}

export type NotifyConditions = {
  clientOffline: boolean
  taskFailed: boolean
  cpuAlert: boolean
  cpuThreshold: number
  memAlert: boolean
  memThreshold: number
  diskAlert: boolean
  diskThreshold: number
  quietHours: boolean
}

export type SecuritySettings = {
  sessionTimeout: number
  twoFactor: boolean
  apiKeyAuth: boolean
  ipAllowlist: boolean
  forceHttps: boolean
  loginLockout: boolean
}

export type ApiKey = {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsed: string
  scope: "read" | "write" | "admin"
}

export type SettingsState = {
  general: GeneralSettings
  email: EmailSettings
  conditions: NotifyConditions
  security: SecuritySettings
}

export const defaultSettings: SettingsState = {
  general: {
    concurrency: 4,
    channelTimeout: 30,
    commandTimeout: 120,
    retryCount: 2,
    logRetentionDays: 30,
    logRetentionMax: 100000,
    compressArchive: true,
    offlineThreshold: 60,
    timezone: "Asia/Shanghai",
    autoCleanTasks: true,
  },
  email: {
    enabled: true,
    host: "smtp.example.com",
    port: 587,
    encryption: "tls",
    username: "notify@example.com",
    password: "",
    from: "notify@example.com",
    to: "admin@example.com",
  },
  conditions: {
    clientOffline: true,
    taskFailed: true,
    cpuAlert: true,
    cpuThreshold: 85,
    memAlert: true,
    memThreshold: 90,
    diskAlert: true,
    diskThreshold: 90,
    quietHours: false,
  },
  security: {
    sessionTimeout: 30,
    twoFactor: false,
    apiKeyAuth: true,
    ipAllowlist: false,
    forceHttps: true,
    loginLockout: true,
  },
}

export const initialApiKeys: ApiKey[] = [
  {
    id: "k-1",
    name: "监控采集器",
    prefix: "nk_live_a1b2",
    createdAt: "2025-11-02",
    lastUsed: "今天 09:12",
    scope: "write",
  },
  {
    id: "k-2",
    name: "只读大屏",
    prefix: "nk_live_9f8e",
    createdAt: "2025-10-18",
    lastUsed: "昨天 21:40",
    scope: "read",
  },
  {
    id: "k-3",
    name: "CI 部署机器人",
    prefix: "nk_live_77cd",
    createdAt: "2025-09-30",
    lastUsed: "3 天前",
    scope: "admin",
  },
]

/* 关于页信息 */
export const aboutInfo = {
  panelName: "NachoNeko 控制面板",
  serverVersion: "v2.6.1",
  buildDate: "2026-07-01",
  license: "AGPL-3.0",
  framework: "Next.js 16 · React 19",
  uiLibrary: "shadcn/ui · Tailwind CSS v4",
  runtime: "Node.js 22 LTS",
  commit: "a1b2c3d",
}
