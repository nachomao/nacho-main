/**
 * 开发者预览模式的演示数据。
 *
 * 数据形态与 `/api/panel/*` 的响应保持一致，仅用于界面预览；全部保存在浏览器内存中，
 * 不写入服务端、数据库或磁盘。时间戳在创建 store 时按当前时间生成，并保持固定的相对间隔。
 */

export type PreviewClientStatus = "online" | "offline" | "warning" | "unregistered"

export type PreviewClient = {
  id: string
  name: string
  hostname: string
  ip: string
  os: "Windows" | "macOS" | "Linux"
  osName?: string | null
  status: PreviewClientStatus
  tags: string[]
  group: string
  version: string
  lastSeen: number
  registeredAt: number
  metrics: { cpu: number; memory: number; disk: number; uptime: number } | null
  connected: boolean
}

export type PreviewOverview = {
  clients: { total: number; online: number; warning: number; offline: number; realtimeConnections: number }
  tasks: { total: number; enabled: number }
  plugins: { installed: number }
  commands: { pending: number }
  resources: { cpu: number; memory: number; disk: number }
  health: { unread: number; critical: number; error: number; packages: number }
  updatedAt: number
}

export type PreviewTriggerId = "daily" | "weekly" | "logon" | "startup" | "boot" | "cron"

export type PreviewTask = {
  id: string
  name: string
  os: "windows" | "linux"
  action: string
  program: string
  args: string
  triggerId: PreviewTriggerId
  time: string
  interval: number
  cron: string
  clientIds: string[]
  enabled: boolean
}

export type PreviewPluginStatus = "installed" | "available" | "disabled"

export type PreviewPlugin = {
  id: string
  name: string
  version: string
  author: string
  category: string
  description: string
  size: string
  icon: string
  status: PreviewPluginStatus
  restartRestore?: boolean
  params: Array<{ id: string; label: string; value: string }>
}

export type PreviewLogLevel = "error" | "warn" | "info" | "debug"

export type PreviewLog = {
  id: string
  ts: number
  level: PreviewLogLevel
  source: string
  message: string
  detail?: string | null
}

export type PreviewNotification = {
  id: string
  type: "offline" | "health" | "task" | "log"
  severity: "info" | "warning" | "error" | "critical"
  title: string
  desc: string
  detail: string
  code: string | null
  source: string
  deviceId: string | null
  time: string
  ts: number
  read: boolean
  snoozedUntil: number | null
  groupKey: string
  count?: number
  items?: PreviewNotification[]
}

export type PreviewHealthSeverity = "critical" | "error" | "warning" | "info"

export type PreviewFinding = {
  id: string
  host: string
  severity: PreviewHealthSeverity
  category: string
  title: string
  detail?: string | null
  ts: number
  read: boolean
}

export type PreviewPackageStatus = "collecting" | "analyzing" | "analyzed" | "failed"

export type PreviewPackage = {
  id: string
  clientId: string | null
  commandId: string | null
  host: string
  category: string
  sizeMB: number
  ts: number
  findings: number
  status: PreviewPackageStatus
  sizeBytes: number
  sources: string[]
  entryCount: number
  truncated: boolean
  error: string | null
  analyzedAt: number | null
  downloadable: boolean
}

export type PreviewRuntimeInfo = {
  version: string
  apiVersion: number
  minPanelVersion: string
  agentArtifactVersion: string | null
  updateExecutor: boolean
  updateStatus: { phase: string; version: string; error?: string } | null
  updateMode?: string
  updateSourceConfigured?: boolean
  updateExecutorProtocol?: number | null
}

export type PreviewInstallProfileValues = {
  name: string
  runMode: "menu" | "silent"
  agentServerUrl: string | null
  heartbeatSeconds: number
  pollSeconds: number
  clientName: string | null
  group: string
  tags: string[]
  overwriteExisting: boolean
  reEnrollOnServerChange: boolean
}

export type PreviewInstallProfile = PreviewInstallProfileValues & {
  id: string
  isDefault: boolean
  revision: number
  activeRevision: number
  createdAt: number
  updatedAt: number
}

export type PreviewInstallProfileRevision = {
  profileId: string
  revision: number
  snapshot: PreviewInstallProfileValues
  note: string
  createdAt: number
}

export type PreviewAgentRelease = {
  version: string
  fileName: string
  sha256: string
  rid: "win-x64"
  sizeBytes: number
  publishedAt: string
}

export type PreviewAgentUpdateClient = PreviewClient & {
  currentVersion: string
  targetVersion: string
  command: { id: string; status: string; result: string | null } | null
  phase: string | null
  skipReason: "not-windows" | "already-current" | "newer-than-release" | "invalid-version" | "active-update" | null
}

export type PreviewAgentUpdates = {
  release: PreviewAgentRelease
  clients: PreviewAgentUpdateClient[]
}

export type PreviewSettings = { security: { openEnrollment: boolean } }

export type DeveloperPreviewStore = {
  clients: PreviewClient[]
  groups: string[]
  tasks: PreviewTask[]
  plugins: PreviewPlugin[]
  logs: PreviewLog[]
  notifications: PreviewNotification[]
  findings: PreviewFinding[]
  packages: PreviewPackage[]
  settings: PreviewSettings
  installProfiles: PreviewInstallProfile[]
  installRevisions: PreviewInstallProfileRevision[]
  runtimeInfo: PreviewRuntimeInfo
  agentRelease: PreviewAgentRelease
  counters: { client: number; task: number; plugin: number }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

function createClients(now: number): PreviewClient[] {
  return [
    {
      id: "preview-client-win-001",
      name: "DESKTOP-NACHO",
      hostname: "DESKTOP-NACHO",
      ip: "192.168.1.12",
      os: "Windows",
      osName: "Windows 11 专业版",
      status: "online",
      tags: ["办公", "设计"],
      group: "设计工作室",
      version: "1.1.24",
      lastSeen: now - 8_000,
      registeredAt: now - 42 * HOUR,
      metrics: { cpu: 18, memory: 46, disk: 61, uptime: 152_400 },
      connected: true,
    },
    {
      id: "preview-client-win-002",
      name: "RENDER-NODE-02",
      hostname: "RENDER-NODE-02",
      ip: "192.168.1.24",
      os: "Windows",
      osName: "Windows 10 企业版",
      status: "warning",
      tags: ["渲染"],
      group: "服务器",
      version: "1.1.22",
      lastSeen: now - 6 * MINUTE,
      registeredAt: now - 120 * HOUR,
      metrics: { cpu: 72, memory: 84, disk: 88, uptime: 480_600 },
      connected: true,
    },
    {
      id: "preview-client-linux-003",
      name: "build-runner",
      hostname: "build-runner",
      ip: "192.168.1.31",
      os: "Linux",
      osName: "Ubuntu 24.04 LTS",
      status: "online",
      tags: ["CI", "构建"],
      group: "服务器",
      version: "1.1.24",
      lastSeen: now - 15_000,
      registeredAt: now - 300 * HOUR,
      metrics: { cpu: 34, memory: 52, disk: 43, uptime: 1_080_000 },
      connected: true,
    },
    {
      id: "preview-client-win-004",
      name: "SECRETARY-PC",
      hostname: "SECRETARY-PC",
      ip: "192.168.1.56",
      os: "Windows",
      osName: "Windows 11 家庭版",
      status: "offline",
      tags: ["前台"],
      group: "默认分组",
      version: "1.1.19",
      lastSeen: now - 9 * HOUR,
      registeredAt: now - 260 * HOUR,
      metrics: { cpu: 0, memory: 0, disk: 0, uptime: 0 },
      connected: false,
    },
  ]
}

function createTasks(): PreviewTask[] {
  return [
    {
      id: "preview-task-backup",
      name: "每日文件备份",
      os: "windows",
      action: "运行备份脚本",
      program: "C:\\Scripts\\backup.ps1",
      args: "-Mode Incremental",
      triggerId: "daily",
      time: "02:30",
      interval: 1,
      cron: "",
      clientIds: ["preview-client-win-001", "preview-client-win-002"],
      enabled: true,
    },
    {
      id: "preview-task-logs",
      name: "采集构建日志",
      os: "linux",
      action: "打包日志目录",
      program: "/opt/nacho/collect.sh",
      args: "--since 24h",
      triggerId: "cron",
      time: "",
      interval: 0,
      cron: "0 */6 * * *",
      clientIds: ["preview-client-linux-003"],
      enabled: true,
    },
    {
      id: "preview-task-cleanup",
      name: "周末磁盘清理",
      os: "windows",
      action: "清理临时文件",
      program: "cleanmgr.exe",
      args: "/sagerun:1",
      triggerId: "weekly",
      time: "23:00",
      interval: 1,
      cron: "",
      clientIds: ["preview-client-win-002"],
      enabled: false,
    },
  ]
}

function createPlugins(): PreviewPlugin[] {
  return [
    {
      id: "preview-plugin-shield",
      name: "系统加固",
      version: "0.9.2",
      author: "NachoNeko",
      category: "系统防护",
      description: "检查本机安全基线并给出加固建议。",
      size: "1.8 MiB",
      icon: "shield",
      status: "installed",
      restartRestore: false,
      params: [{ id: "preview-param-1", label: "检查级别", value: "标准" }],
    },
    {
      id: "preview-plugin-monitor",
      name: "性能观测",
      version: "0.7.5",
      author: "NachoNeko",
      category: "监控",
      description: "持续记录 CPU、内存与磁盘的负载变化。",
      size: "2.4 MiB",
      icon: "gauge",
      status: "installed",
      restartRestore: false,
      params: [{ id: "preview-param-2", label: "采样间隔（秒）", value: "10" }],
    },
    {
      id: "preview-plugin-network",
      name: "网络诊断",
      version: "0.5.0",
      author: "NachoNeko",
      category: "网络",
      description: "一键检测连通性、DNS 与路由异常。",
      size: "1.2 MiB",
      icon: "network",
      status: "disabled",
      restartRestore: false,
      params: [],
    },
    {
      id: "preview-plugin-restore",
      name: "还原点管理",
      version: "0.4.1",
      author: "NachoNeko",
      category: "工具",
      description: "在变更前创建系统还原点，重启后自动恢复。",
      size: "0.9 MiB",
      icon: "restore",
      status: "available",
      restartRestore: true,
      params: [],
    },
  ]
}

function createLogs(now: number): PreviewLog[] {
  const rows: Array<[PreviewLogLevel, string, string, string, number]> = [
    ["info", "server", "控制服务已启动，等待客户端连接", "service=control-server;port=8443", 1],
    ["info", "agent", "客户端上线", "client=DESKTOP-NACHO;version=1.1.24", 2],
    ["debug", "panel", "面板心跳正常", "latency=42ms", 3],
    ["info", "task", "计划任务开始执行：每日文件备份", "taskId=preview-task-backup", 5],
    ["info", "task", "计划任务执行完成：每日文件备份", "duration=48s;exitCode=0", 6],
    ["warn", "agent", "磁盘可用空间低于 15%", "client=RENDER-NODE-02;free=12%", 8],
    ["info", "agent", "客户端版本检查完成", "client=build-runner;upToDate=true", 12],
    ["error", "agent", "日志采集失败：目标目录不可写", "client=SECRETARY-PC;code=ACCESS_DENIED", 18],
    ["warn", "server", "通知发送重试", "retry=1;channel=email", 21],
    ["info", "panel", "健康中心生成日志包", "packageId=preview-package-001;entries=482", 26],
    ["debug", "task", "任务调度器唤醒", "pending=2", 30],
    ["error", "panel", "旧版面板心跳超时已忽略", "client=SECRETARY-PC", 35],
  ]
  return rows.map(([level, source, message, detail, minutes], index) => ({
    id: `preview-log-${String(index + 1).padStart(3, "0")}`,
    ts: now - minutes * MINUTE,
    level,
    source,
    message,
    detail,
  }))
}

function notice(
  base: Omit<PreviewNotification, "items" | "count">,
  items: Array<Omit<PreviewNotification, "items" | "count">> = [],
): PreviewNotification {
  if (items.length === 0) return { ...base, count: 1 }
  return { ...base, count: items.length, items: items.map((item) => ({ ...item, count: 1 })) }
}

function createNotifications(now: number): PreviewNotification[] {
  const group = (index: number, overrides: Partial<PreviewNotification>): Omit<PreviewNotification, "count" | "items"> => ({
    id: `preview-notice-${index}`,
    type: "offline",
    severity: "warning",
    title: "客户端离线",
    desc: "客户端连续 5 分钟未上报心跳",
    detail: "请检查设备电源、网络或 Agent 服务状态。",
    code: "AGENT_OFFLINE",
    source: "agent",
    deviceId: null,
    time: `${index} 分钟前`,
    ts: now - index * MINUTE,
    read: false,
    snoozedUntil: null,
    groupKey: "agent-offline",
    ...overrides,
  })

  return [
    notice(group(6, { type: "offline", severity: "warning", title: "客户端离线", deviceId: "preview-client-win-004" }), [
      group(6, { type: "offline", severity: "warning", title: "客户端离线：SECRETARY-PC", deviceId: "preview-client-win-004" }),
      group(12, { type: "offline", severity: "warning", title: "客户端离线：RENDER-NODE-02", deviceId: "preview-client-win-002", read: true }),
    ]),
    notice(group(9, {
      type: "health",
      severity: "critical",
      title: "磁盘空间严重不足",
      desc: "RENDER-NODE-02 磁盘使用率达到 88%",
      detail: "建议清理临时文件或扩容后重新采集。",
      code: "DISK_CRITICAL",
      source: "health",
      deviceId: "preview-client-win-002",
      groupKey: "health-disk",
    })),
    notice(group(15, {
      type: "task",
      severity: "info",
      title: "计划任务执行成功",
      desc: "每日文件备份已在 2 台设备完成",
      detail: "任务耗时 48 秒，退出码 0。",
      code: null,
      source: "task",
      groupKey: "task-success",
      read: true,
    })),
    notice(group(24, {
      type: "log",
      severity: "error",
      title: "日志采集失败",
      desc: "SECRETARY-PC 的日志目录不可写",
      detail: "目标目录返回 ACCESS_DENIED，请检查 Agent 运行账户权限。",
      code: "ACCESS_DENIED",
      source: "log",
      deviceId: "preview-client-win-004",
      groupKey: "log-collect",
    })),
  ]
}

function createFindings(now: number): PreviewFinding[] {
  return [
    {
      id: "preview-finding-1",
      host: "RENDER-NODE-02",
      severity: "critical",
      category: "磁盘存储",
      title: "系统盘可用空间低于 12%",
      detail: "临时文件与渲染缓存占用约 180 GB。",
      ts: now - 8 * MINUTE,
      read: false,
    },
    {
      id: "preview-finding-2",
      host: "RENDER-NODE-02",
      severity: "warning",
      category: "服务异常",
      title: "Agent 升级后服务重启一次",
      detail: "升级流程按预期完成，重启属于正常现象。",
      ts: now - 46 * MINUTE,
      read: false,
    },
    {
      id: "preview-finding-3",
      host: "SECRETARY-PC",
      severity: "error",
      category: "系统日志",
      title: "日志采集目标目录不可写",
      detail: "Agent 运行账户缺少目标目录写权限。",
      ts: now - 2 * HOUR,
      read: false,
    },
    {
      id: "preview-finding-4",
      host: "build-runner",
      severity: "info",
      category: "网络连接",
      title: "构建节点网络延迟恢复正常",
      detail: "过去 24 小时平均延迟 18 ms。",
      ts: now - 5 * HOUR,
      read: true,
    },
    {
      id: "preview-finding-5",
      host: "DESKTOP-NACHO",
      severity: "warning",
      category: "应用崩溃",
      title: "设计软件异常退出一次",
      detail: "应用事件日志中包含 CLR 异常记录。",
      ts: now - 9 * HOUR,
      read: true,
    },
  ]
}

function createPackages(now: number): PreviewPackage[] {
  return [
    {
      id: "preview-package-001",
      clientId: "preview-client-win-002",
      commandId: "preview-command-collect-1",
      host: "RENDER-NODE-02",
      category: "系统日志",
      sizeMB: 2.7,
      ts: now - 26 * MINUTE,
      findings: 3,
      status: "analyzed",
      sizeBytes: 2_828_288,
      sources: ["agent", "system", "application"],
      entryCount: 482,
      truncated: false,
      error: null,
      analyzedAt: now - 24 * MINUTE,
      downloadable: true,
    },
    {
      id: "preview-package-002",
      clientId: "preview-client-win-004",
      commandId: "preview-command-collect-2",
      host: "SECRETARY-PC",
      category: "应用崩溃",
      sizeMB: 0.8,
      ts: now - 2 * HOUR,
      findings: 1,
      status: "failed",
      sizeBytes: 838_860,
      sources: ["application"],
      entryCount: 64,
      truncated: true,
      error: "部分日志文件读取失败：ACCESS_DENIED",
      analyzedAt: null,
      downloadable: false,
    },
  ]
}

function createInstallProfiles(now: number): PreviewInstallProfile[] {
  const base: PreviewInstallProfileValues = {
    name: "默认安装档案",
    runMode: "menu",
    agentServerUrl: null,
    heartbeatSeconds: 20,
    pollSeconds: 15,
    clientName: null,
    group: "默认分组",
    tags: ["内部"],
    overwriteExisting: false,
    reEnrollOnServerChange: false,
  }
  return [
    {
      ...base,
      id: "preview-profile-default",
      isDefault: true,
      revision: 3,
      activeRevision: 3,
      createdAt: now - 72 * HOUR,
      updatedAt: now - 26 * HOUR,
    },
    {
      ...base,
      name: "静默部署（服务器组）",
      runMode: "silent",
      group: "服务器",
      tags: ["CI", "构建"],
      id: "preview-profile-silent",
      isDefault: false,
      revision: 1,
      activeRevision: 1,
      createdAt: now - 30 * HOUR,
      updatedAt: now - 30 * HOUR,
    },
  ]
}

function createInstallRevisions(now: number): PreviewInstallProfileRevision[] {
  return [
    {
      profileId: "preview-profile-default",
      revision: 3,
      snapshot: {
        name: "默认安装档案",
        runMode: "menu",
        agentServerUrl: null,
        heartbeatSeconds: 20,
        pollSeconds: 15,
        clientName: null,
        group: "默认分组",
        tags: ["内部"],
        overwriteExisting: false,
        reEnrollOnServerChange: false,
      },
      note: "调整心跳间隔",
      createdAt: now - 26 * HOUR,
    },
    {
      profileId: "preview-profile-default",
      revision: 2,
      snapshot: {
        name: "默认安装档案",
        runMode: "menu",
        agentServerUrl: null,
        heartbeatSeconds: 30,
        pollSeconds: 15,
        clientName: null,
        group: "默认分组",
        tags: [],
        overwriteExisting: false,
        reEnrollOnServerChange: false,
      },
      note: "初始版本",
      createdAt: now - 72 * HOUR,
    },
  ]
}

function createRuntimeInfo(): PreviewRuntimeInfo {
  return {
    version: "1.1.24",
    apiVersion: 1,
    minPanelVersion: "0.1.2",
    agentArtifactVersion: "1.1.24",
    updateExecutor: false,
    updateStatus: null,
    updateMode: "disabled",
    updateSourceConfigured: false,
    updateExecutorProtocol: null,
  }
}

function createAgentRelease(now: number): PreviewAgentRelease {
  return {
    version: "1.1.24",
    fileName: "nacho-agent-win-x64.exe",
    sha256: "9f2d4e2b7c1a3e6f8b0c2d4e6f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f70",
    rid: "win-x64",
    sizeBytes: 24_117_248,
    publishedAt: new Date(now - 48 * HOUR).toISOString(),
  }
}

export function createDeveloperPreviewStore(now = Date.now()): DeveloperPreviewStore {
  const clients = createClients(now)
  const release = createAgentRelease(now)
  return {
    clients,
    groups: ["默认分组", "设计工作室", "服务器"],
    tasks: createTasks(),
    plugins: createPlugins(),
    logs: createLogs(now),
    notifications: createNotifications(now),
    findings: createFindings(now),
    packages: createPackages(now),
    settings: { security: { openEnrollment: false } },
    installProfiles: createInstallProfiles(now),
    installRevisions: createInstallRevisions(now),
    runtimeInfo: createRuntimeInfo(),
    agentRelease: release,
    counters: { client: clients.length, task: 3, plugin: 4 },
  }
}

/** 与 `Overview` 类型一致：预览模式的概览由内存 store 实时统计。 */
export function developerPreviewOverview(store: DeveloperPreviewStore, now = Date.now()): PreviewOverview {
  const online = store.clients.filter((client) => client.status === "online").length
  const warning = store.clients.filter((client) => client.status === "warning").length
  const offline = store.clients.filter((client) => client.status === "offline").length
  const findings = store.findings
  return {
    clients: {
      total: store.clients.length,
      online,
      warning,
      offline,
      realtimeConnections: store.clients.filter((client) => client.connected).length,
    },
    tasks: { total: store.tasks.length, enabled: store.tasks.filter((task) => task.enabled).length },
    plugins: { installed: store.plugins.filter((plugin) => plugin.status === "installed").length },
    commands: { pending: 0 },
    resources: { cpu: 32, memory: 48, disk: 61 },
    health: {
      unread: findings.filter((finding) => !finding.read).length,
      critical: findings.filter((finding) => finding.severity === "critical").length,
      error: findings.filter((finding) => finding.severity === "error").length,
      packages: store.packages.length,
    },
    updatedAt: now,
  }
}

/** 与 `AgentUpdates` 类型一致：客户端更新页使用当前预览客户端生成。 */
export function developerPreviewAgentUpdates(store: DeveloperPreviewStore): PreviewAgentUpdates {
  return {
    release: store.agentRelease,
    clients: store.clients.map((client) => ({
      ...client,
      currentVersion: client.version,
      targetVersion: store.agentRelease.version,
      command: null,
      phase: null,
      skipReason: client.os !== "Windows"
        ? "not-windows"
        : client.version === store.agentRelease.version
          ? "already-current"
          : null,
    })),
  }
}
