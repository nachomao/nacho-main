/**
 * 面板演示用模拟控制服务端（仅前端内存实现，用于在没有 WSL 控制服务端时联调 UI）。
 *
 * 使用方式：
 *   - 默认开启。设置 NEXT_PUBLIC_NACHO_MOCK=off 即改回请求真实服务端。
 *   - installMockPanelApi() 会在浏览器端劫持 `/api/panel/*` 的 fetch 请求，
 *     其余请求（本机 /api/local-settings 等）原样透传。
 *   - 制品上传走 mockUploadPanelApi()，由 server-data-context 在 mock 模式下调用。
 *
 * 数据与真实服务端 envelope 保持一致：{ ok: true, data } / { ok: false, message }。
 * 命令状态按真实链路推进：pending -> sent -> running -> success|failed（离线客户端保持 pending 排队）。
 *
 * 恢复真实链路：删除本文件并还原 .mock-backup/ 中的原始文件即可。
 */

const MOCK_DEFAULT_ENABLED = true

export function isMockPanelEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_NACHO_MOCK?.toLowerCase()
  if (flag === "off" || flag === "0" || flag === "false") return false
  if (flag === "on" || flag === "1" || flag === "true") return true
  return MOCK_DEFAULT_ENABLED
}

/* ==================== 基础工具 ==================== */

type Json = Record<string, unknown>

let idCounter = 0

function hex12() {
  idCounter += 1
  const random = Math.floor(Math.random() * 0xfffff).toString(16)
  return `${idCounter.toString(16)}${random}`.padEnd(12, "0").slice(0, 12).replace(/[^a-f0-9]/g, "0")
}

function sha256Hex(seed: string) {
  let value = 0x811c9dc5
  let out = ""
  for (let index = 0; index < 8; index += 1) {
    for (const character of `${seed}:${index}`) {
      value = (value ^ character.charCodeAt(0)) * 0x01000193 >>> 0
    }
    out += value.toString(16).padStart(8, "0")
  }
  return out.slice(0, 64)
}

const minute = 60_000
const hour = 60 * minute
const day = 24 * hour
const now0 = Date.now()

/* ==================== 类型 ==================== */

type MockClient = {
  id: string
  name: string
  hostname: string
  ip: string
  os: "Windows" | "macOS" | "Linux"
  osName: string | null
  status: "online" | "offline" | "warning"
  tags: string[]
  group: string
  version: string
  lastSeen: number
  registeredAt: number
  metrics: { cpu: number; memory: number; disk: number; uptime: number } | null
  connected: boolean
}

type MockCommand = {
  id: string
  clientId: string
  taskId: string | null
  type: string
  payload: Json
  status: "pending" | "sent" | "running" | "success" | "failed" | "canceled"
  result: string | null
  exitCode: number | null
  createdAt: number
  updatedAt: number
  /** 离线客户端的命令排队等待，不自动推进 */
  queued: boolean
  /** 预设终态，便于演示失败分支 */
  outcome: "success" | "failed"
}

type MockArtifact = {
  id: string
  kind: "package" | "file"
  displayName: string
  version: string
  originalFileName: string
  storageName: string
  sizeBytes: number
  sha256: string | null
  installerType: "msi" | "exe" | null
  arguments: string[]
  successExitCodes: number[]
  status: "draft" | "uploading" | "ready" | "deleted"
  createdAt: number
  updatedAt: number
}

type MockBatchItem = { id: string; commandId: string; artifactId: string; clientId: string }

type MockBatch = {
  id: string
  kind: "package" | "file"
  totalItems: number
  createdAt: number
  updatedAt: number
  items: MockBatchItem[]
}

type MockLog = {
  id: string
  ts: number
  level: "error" | "warn" | "info" | "debug"
  source: string
  message: string
  detail: string | null
}

/* ==================== 初始数据 ==================== */

const releaseVersion = "1.1.2"
const release = {
  version: releaseVersion,
  fileName: `nacho-agent-${releaseVersion}-win-x64.exe`,
  sha256: sha256Hex("release"),
  rid: "win-x64" as const,
  sizeBytes: 76_182_016,
  publishedAt: new Date(now0 - 2 * day).toISOString(),
}

const groups = ["生产环境", "测试环境", "门店终端", "研发环境"]

const clients: MockClient[] = [
  mockClient("win-office-07", "WIN-OFFICE-07", "192.168.10.7", "Windows", "Windows 11 专业版", "online", ["办公", "远程"], "测试环境", "1.1.0", { cpu: 24, memory: 58, disk: 61, uptime: 5 * day / 1000 }),
  mockClient("win-dev-12", "WIN-DEV-12", "192.168.10.12", "Windows", "Windows 11 企业版", "online", ["研发"], "研发环境", releaseVersion, { cpu: 41, memory: 66, disk: 48, uptime: 11 * day / 1000 }),
  mockClient("win-kiosk-03", "WIN-KIOSK-03", "10.20.3.3", "Windows", "Windows 10 LTSC", "warning", ["门店", "自助机"], "门店终端", "1.1.0", { cpu: 87, memory: 91, disk: 78, uptime: 2 * day / 1000 }),
  mockClient("win-lab-21", "WIN-LAB-21", "10.20.4.21", "Windows", "Windows Server 2022", "offline", ["实验室"], "测试环境", "1.0.9", null),
  mockClient("web-prod-01", "web-prod-01", "10.0.1.11", "Linux", "ubuntu", "online", ["web", "nginx"], "生产环境", releaseVersion, { cpu: 32, memory: 61, disk: 44, uptime: 30 * day / 1000 }),
  mockClient("db-prod-01", "db-prod-01", "10.0.1.21", "Linux", "debian", "warning", ["database"], "生产环境", releaseVersion, { cpu: 78, memory: 86, disk: 67, uptime: 18 * day / 1000 }),
  mockClient("cache-prod-02", "cache-prod-02", "10.0.1.32", "Linux", "alpine", "offline", ["redis"], "生产环境", "1.1.0", null),
  mockClient("mac-design-05", "mac-design-05", "192.168.10.45", "macOS", "macOS 15.3", "online", ["设计"], "研发环境", "1.1.0", { cpu: 19, memory: 47, disk: 72, uptime: 4 * day / 1000 }),
]

function mockClient(
  name: string,
  hostname: string,
  ip: string,
  os: MockClient["os"],
  osName: string,
  status: MockClient["status"],
  tags: string[],
  group: string,
  version: string,
  metrics: MockClient["metrics"],
): MockClient {
  return {
    id: `client-${hex12()}`,
    name,
    hostname,
    ip,
    os,
    osName,
    status,
    tags,
    group,
    version,
    lastSeen: status === "offline" ? now0 - 3 * hour : now0 - 12_000,
    registeredAt: now0 - 42 * day,
    metrics,
    connected: status !== "offline",
  }
}

const commands: MockCommand[] = []
const artifacts: MockArtifact[] = []
const batches: MockBatch[] = []
const logs: MockLog[] = []

const tasks: Json[] = [
  {
    id: `task-${hex12()}`,
    name: "每日日志清理",
    os: "linux",
    action: "运行程序",
    program: "/usr/local/bin/cleanup.sh",
    args: "--days 7",
    triggerId: "daily",
    time: "03:00",
    interval: 1,
    cron: "",
    clientIds: [clients[4].id, clients[5].id],
    enabled: true,
    createdAt: now0 - 12 * day,
    updatedAt: now0 - 2 * hour,
  },
  {
    id: `task-${hex12()}`,
    name: "Windows 补丁检查",
    os: "windows",
    action: "运行程序",
    program: "powershell.exe",
    args: "-File C:\\scripts\\patch-check.ps1",
    triggerId: "weekly",
    time: "08:00",
    interval: 1,
    cron: "",
    clientIds: [clients[0].id, clients[1].id],
    enabled: true,
    createdAt: now0 - 20 * day,
    updatedAt: now0 - 20 * hour,
  },
]

const plugins: Json[] = [
  {
    id: `plugin-${hex12()}`,
    name: "系统资源采集器",
    version: "1.2.0",
    author: "NachoTeam",
    category: "监控",
    description: "定时采集 CPU / 内存 / 磁盘等资源指标并上报服务端。",
    size: "1.8 MB",
    icon: "activity",
    status: "installed",
    restartRestore: true,
    params: [{ id: "interval", label: "采集间隔(秒)", value: "30" }],
  },
  {
    id: `plugin-${hex12()}`,
    name: "日志收集器",
    version: "0.9.3",
    author: "NachoTeam",
    category: "日志",
    description: "打包指定路径日志并上传至服务端进行分析。",
    size: "2.4 MB",
    icon: "file-text",
    status: "available",
    restartRestore: false,
    params: [],
  },
]

const healthFindings: Json[] = [
  { id: `finding-${hex12()}`, host: "db-prod-01", severity: "warning", category: "资源", title: "内存使用率持续高于 80%", detail: "最近 15 分钟平均内存 86%，建议排查慢查询。", read: false, createdAt: now0 - 40 * minute },
  { id: `finding-${hex12()}`, host: "win-kiosk-03", severity: "critical", category: "磁盘", title: "系统盘可用空间不足 8%", detail: "C: 剩余 6.4 GB，建议清理更新缓存。", read: false, createdAt: now0 - 3 * hour },
  { id: `finding-${hex12()}`, host: "web-prod-01", severity: "error", category: "服务", title: "nginx 在 24 小时内重启 3 次", detail: "worker 进程异常退出，建议检查上游超时配置。", read: true, createdAt: now0 - 9 * hour },
]

const healthPackages: Json[] = [
  { id: `pkg-${hex12()}`, host: "web-prod-01", category: "系统日志", sizeMB: 12.4, findings: 3, status: "analyzed", createdAt: now0 - 6 * hour },
  { id: `pkg-${hex12()}`, host: "win-kiosk-03", category: "应用日志", sizeMB: 5.1, findings: 1, status: "analyzing", createdAt: now0 - 25 * minute },
]

let settings: Json = {
  serverName: "Nacho 控制服务端（演示）",
  heartbeatSeconds: 10,
  offlineThresholdSeconds: 60,
  retentionDays: 30,
  emailNotify: false,
}

/* ==================== 初始日志与历史命令 ==================== */

function pushLog(level: MockLog["level"], source: string, message: string, detail: string | null = null, ts = Date.now()) {
  logs.unshift({ id: `log-${hex12()}`, ts, level, source, message, detail })
  if (logs.length > 400) logs.length = 400
}

function seedLogs() {
  const seeds: Array<[MockLog["level"], string, string, string | null, number]> = [
    ["info", "agent", "客户端 win-office-07 心跳正常", "version=1.1.0", now0 - 30_000],
    ["info", "ws", "客户端 win-dev-12 实时通道已建立", "transport=websocket", now0 - 90_000],
    ["warn", "health", "db-prod-01 内存使用率 86%", "threshold=80", now0 - 40 * minute],
    ["error", "command", "命令执行失败：manage-service", "service=Spooler exit=1053", now0 - 55 * minute],
    ["info", "command", "命令执行成功：run-shell", "client=win-dev-12 duration=812ms", now0 - 70 * minute],
    ["debug", "http", "GET /api/panel/overview 200", "duration=6ms", now0 - 2 * hour],
    ["warn", "agent", "客户端 cache-prod-02 心跳超时，标记离线", "lastSeen=3h", now0 - 3 * hour],
    ["info", "update", "Agent 发布清单已刷新", `version=${releaseVersion}`, now0 - 2 * day],
    ["info", "deploy", "软件包部署批次完成", "success=2 failed=1", now0 - 4 * hour],
    ["debug", "db", "SQLite WAL checkpoint 完成", "pages=128", now0 - 5 * hour],
    ["info", "auth", "面板 API Key 校验通过", "source=127.0.0.1", now0 - 6 * hour],
    ["error", "agent", "客户端 win-lab-21 连接中断", "reason=socket-closed", now0 - 7 * hour],
  ]
  seeds.forEach(([level, source, message, detail, ts]) => pushLog(level, source, message, detail, ts))
}

function seedHistory() {
  const msi: MockArtifact = {
    id: `artifact-${hex12()}`,
    kind: "package",
    displayName: "企业 VPN 客户端",
    version: "4.2.1",
    originalFileName: "enterprise-vpn-4.2.1.msi",
    storageName: `pkg-${hex12()}.msi`,
    sizeBytes: 48_234_496,
    sha256: sha256Hex("vpn"),
    installerType: "msi",
    arguments: ["ALLUSERS=1", "REBOOT=ReallySuppress"],
    successExitCodes: [0, 3010],
    status: "ready",
    createdAt: now0 - 5 * day,
    updatedAt: now0 - 5 * day,
  }
  const exe: MockArtifact = {
    id: `artifact-${hex12()}`,
    kind: "package",
    displayName: "终端安全代理",
    version: "9.0.7",
    originalFileName: "endpoint-agent-9.0.7.exe",
    storageName: `pkg-${hex12()}.exe`,
    sizeBytes: 92_301_312,
    sha256: sha256Hex("edr"),
    installerType: "exe",
    arguments: ["/quiet", "/norestart"],
    successExitCodes: [0],
    status: "ready",
    createdAt: now0 - 3 * day,
    updatedAt: now0 - 3 * day,
  }
  const conf: MockArtifact = {
    id: `artifact-${hex12()}`,
    kind: "file",
    displayName: "统一代理配置",
    version: "2026.07",
    originalFileName: "proxy.conf",
    storageName: `file-${hex12()}.conf`,
    sizeBytes: 4_312,
    sha256: sha256Hex("conf"),
    installerType: null,
    arguments: [],
    successExitCodes: [],
    status: "ready",
    createdAt: now0 - 2 * day,
    updatedAt: now0 - 2 * day,
  }
  artifacts.push(msi, exe, conf)

  // 历史软件包部署批次（已终态）
  const packageTargets = [clients[0], clients[1], clients[2]]
  const packageItems: MockBatchItem[] = packageTargets.map((client, index) => {
    const command = createCommand(client.id, "install-package", { artifactId: msi.id, timeoutSeconds: 1800 }, {
      createdAt: now0 - 4 * hour,
      forceOutcome: index === 2 ? "failed" : "success",
      finalize: true,
    })
    return { id: `item-${hex12()}`, commandId: command.id, artifactId: msi.id, clientId: client.id }
  })
  batches.push({ id: `batch-${hex12()}`, kind: "package", totalItems: packageItems.length, createdAt: now0 - 4 * hour, updatedAt: now0 - 4 * hour + 90_000, items: packageItems })

  // 历史文件部署批次（已终态，可回滚）
  const fileItems: MockBatchItem[] = [clients[0], clients[1]].map((client) => {
    const command = createCommand(client.id, "deploy-file", {
      artifactId: conf.id,
      destinationPath: "C:\\ProgramData\\Nacho\\proxy.conf",
      conflictPolicy: "replace",
      createDirectories: true,
    }, { createdAt: now0 - 100 * minute, forceOutcome: "success", finalize: true })
    return { id: `item-${hex12()}`, commandId: command.id, artifactId: conf.id, clientId: client.id }
  })
  batches.push({ id: `batch-${hex12()}`, kind: "file", totalItems: fileItems.length, createdAt: now0 - 100 * minute, updatedAt: now0 - 98 * minute, items: fileItems })

  // 历史命令：脚本、消息、网页、服务、日志采集
  createCommand(clients[1].id, "run-shell", { shell: "powershell", script: "Get-Service | Select-Object -First 5", timeoutSeconds: 120 }, { createdAt: now0 - 70 * minute, forceOutcome: "success", finalize: true })
  createCommand(clients[0].id, "manage-service", { serviceName: "Spooler", action: "restart", timeoutSeconds: 60 }, { createdAt: now0 - 55 * minute, forceOutcome: "failed", finalize: true })
  createCommand(clients[0].id, "collect-logs", { sources: ["agent", "system"], sinceUtc: new Date(now0 - 6 * hour).toISOString(), untilUtc: new Date(now0 - hour).toISOString(), maxEntries: 200 }, { createdAt: now0 - 45 * minute, forceOutcome: "success", finalize: true })
}

/* ==================== 命令生命周期 ==================== */

const timeline = { sent: 900, running: 2_000, terminal: 3_600 }

function createCommand(
  clientId: string,
  type: string,
  payload: Json,
  options: { createdAt?: number; forceOutcome?: "success" | "failed"; finalize?: boolean; expiresAt?: string } = {},
): MockCommand {
  const client = clients.find((item) => item.id === clientId)
  const createdAt = options.createdAt ?? Date.now()
  const command: MockCommand = {
    id: `cmd-${hex12()}`,
    clientId,
    taskId: null,
    type,
    payload: options.expiresAt ? { ...payload, expiresAt: options.expiresAt } : { ...payload },
    status: "pending",
    result: null,
    exitCode: null,
    createdAt,
    updatedAt: createdAt,
    queued: client ? client.status === "offline" : false,
    outcome: options.forceOutcome ?? "success",
  }
  commands.push(command)
  pushLog("info", "command", `创建命令：${type}`, `client=${client?.name ?? clientId}`, createdAt)
  if (options.finalize) advance(command, Number.POSITIVE_INFINITY)
  return command
}

/** 按经过时间推进所有命令状态，并执行终态副作用 */
function tick() {
  const current = Date.now()
  commands.forEach((command) => advance(command, current))
}

function advance(command: MockCommand, current: number) {
  if (command.status === "success" || command.status === "failed" || command.status === "canceled") return
  if (command.queued) return
  const elapsed = current - command.createdAt
  const next = elapsed >= timeline.terminal ? command.outcome : elapsed >= timeline.running ? "running" : elapsed >= timeline.sent ? "sent" : "pending"
  if (next === command.status) return
  command.status = next
  command.updatedAt = Math.min(current, command.createdAt + timeline.terminal)
  if (next !== "success" && next !== "failed") return

  const built = buildResult(command)
  command.result = built.result
  command.exitCode = built.exitCode
  if (command.type === "update-agent" && next === "success") {
    const client = clients.find((item) => item.id === command.clientId)
    if (client) client.version = releaseVersion
  }
  pushLog(next === "success" ? "info" : "error", "command", `命令${next === "success" ? "执行成功" : "执行失败"}：${command.type}`, `id=${command.id}`, command.updatedAt)
}

function updatePhase(command: MockCommand) {
  if (command.queued) return "pending"
  if (command.status === "success") return "healthy"
  if (command.status === "failed") return "failed"
  if (command.status === "canceled") return "canceled"
  const elapsed = Date.now() - command.createdAt
  if (elapsed >= 3_000) return "applying"
  if (elapsed >= 2_000) return "verified"
  if (elapsed >= 1_200) return "downloading"
  return command.status
}

function buildResult(command: MockCommand): { result: string; exitCode: number | null } {
  const failed = command.status === "failed"
  const payload = command.payload
  const client = clients.find((item) => item.id === command.clientId)

  switch (command.type) {
    case "run-shell": {
      const shell = payload.shell === "cmd" ? "cmd" : "powershell"
      return {
        result: JSON.stringify({
          shell,
          stdout: failed ? "" : `Status   Name        DisplayName\n------   ----        -----------\nRunning  NachoAgent  Nacho Agent Service\nRunning  Dnscache    DNS Client\nStopped  Spooler     Print Spooler\n`,
          stderr: failed ? "命令未找到或执行被策略阻止" : "",
          exitCode: failed ? 1 : 0,
          durationMs: failed ? 412 : 812,
          timedOut: false,
          truncated: false,
          error: failed ? "退出码非零" : null,
        }),
        exitCode: failed ? 1 : 0,
      }
    }
    case "manage-service": {
      const action = String(payload.action ?? "query")
      const finalStatus = failed ? "Stopped" : action === "stop" ? "Stopped" : "Running"
      return {
        result: JSON.stringify({
          serviceName: String(payload.serviceName ?? "NachoAgent"),
          action,
          initialStatus: action === "start" ? "Stopped" : "Running",
          finalStatus,
          durationMs: failed ? 1_536 : 964,
          timedOut: false,
          error: failed ? "服务重启失败（1053：服务未及时响应启动或控制请求）" : null,
        }),
        exitCode: failed ? 1053 : 0,
      }
    }
    case "terminate-process": {
      const processId = Number(payload.processId ?? 4321)
      return {
        result: JSON.stringify({
          processId,
          expectedPath: String(payload.expectedPath ?? "C:\\Windows\\System32\\notepad.exe"),
          actualPath: failed ? null : String(payload.expectedPath ?? "C:\\Windows\\System32\\notepad.exe"),
          killProcessTree: Boolean(payload.killProcessTree),
          initialStatus: failed ? "unknown" : "running",
          finalStatus: failed ? "unknown" : "exited",
          durationMs: failed ? 240 : 386,
          timedOut: false,
          error: failed ? "目标进程路径与预期不一致，已拒绝终止" : null,
        }),
        exitCode: failed ? 1 : 0,
      }
    }
    case "restart-system": {
      const delaySeconds = Number.isInteger(payload.delaySeconds) ? Number(payload.delaySeconds) : 30
      return {
        result: JSON.stringify({
          delaySeconds,
          reason: typeof payload.reason === "string" ? payload.reason : null,
          requestedAt: new Date(command.createdAt + 1_200).toISOString(),
          previousBootId: sha256Hex(`boot-prev-${command.clientId}`).slice(0, 32),
          currentBootId: failed ? null : sha256Hex(`boot-next-${command.clientId}`).slice(0, 32),
          phase: failed ? "failed" : "verified",
          durationMs: failed ? 900 : 62_400,
          verifiedAfterRestart: !failed,
          error: failed ? "重启请求被本机策略拒绝" : null,
        }),
        exitCode: failed ? 1 : 0,
      }
    }
    case "collect-logs": {
      const requested = Array.isArray(payload.sources) ? (payload.sources as string[]) : ["agent"]
      const sources = requested.filter((item) => item === "agent" || item === "system" || item === "application")
      const entries = failed ? [] : sources.flatMap((source, sourceIndex) =>
        Array.from({ length: 4 }, (_unused, index) => ({
          source,
          timestampUtc: new Date(command.createdAt - (sourceIndex * 4 + index) * 90_000).toISOString(),
          level: index === 1 ? "Warning" : index === 3 ? "Error" : "Information",
          eventId: 1000 + sourceIndex * 10 + index,
          provider: source === "agent" ? "NachoAgent" : source === "system" ? "Service Control Manager" : "Application Error",
          message: source === "agent"
            ? "心跳已上报，命令队列为空"
            : source === "system"
              ? "服务 Print Spooler 进入停止状态"
              : "应用 excel.exe 出现未处理异常，已生成崩溃报告",
        })),
      )
      const counts: Record<string, number> = {}
      sources.forEach((source) => { counts[source] = entries.filter((entry) => entry.source === source).length })
      return {
        result: JSON.stringify({
          sources,
          requestedSinceUtc: typeof payload.sinceUtc === "string" ? payload.sinceUtc : null,
          requestedUntilUtc: typeof payload.untilUtc === "string" ? payload.untilUtc : null,
          effectiveSinceUtc: typeof payload.sinceUtc === "string" ? payload.sinceUtc : null,
          effectiveUntilUtc: typeof payload.untilUtc === "string" ? payload.untilUtc : null,
          entries,
          countsBySource: counts,
          truncated: false,
          durationMs: failed ? 620 : 2_480,
          error: failed ? "读取系统事件日志被拒绝（访问权限不足）" : null,
        }),
        exitCode: failed ? 1 : 0,
      }
    }
    case "show-message": {
      return {
        result: JSON.stringify({
          sessionId: failed ? null : 2,
          deliveryStatus: failed ? "failed" : "confirmed",
          responseCode: failed ? null : 1,
          timedOut: false,
          durationMs: failed ? 300 : 4_120,
          error: failed ? { code: "NO_ACTIVE_SESSION", message: "目标客户端没有活动的交互式用户会话" } : null,
        }),
        exitCode: failed ? 1 : 0,
      }
    }
    case "open-url": {
      return {
        result: JSON.stringify({
          sessionId: failed ? null : 2,
          processStarted: !failed,
          pid: failed ? null : 7_412,
          durationMs: failed ? 210 : 640,
          expired: false,
          error: failed ? { code: "LAUNCH_FAILED", message: "默认浏览器启动失败" } : null,
        }),
        exitCode: failed ? 1 : 0,
      }
    }
    case "manage-local-user": {
      const action = String(payload.action ?? "list")
      const accounts = [
        { userName: "Administrator", sid: "S-1-5-21-1004336348-1177238915-682003330-500", enabled: true, builtIn: true, groups: ["Administrators"] },
        { userName: "office", sid: "S-1-5-21-1004336348-1177238915-682003330-1001", enabled: true, builtIn: false, groups: ["Users", "Remote Desktop Users"] },
        { userName: "kiosk", sid: "S-1-5-21-1004336348-1177238915-682003330-1002", enabled: false, builtIn: false, groups: ["Users"] },
        { userName: "Guest", sid: "S-1-5-21-1004336348-1177238915-682003330-501", enabled: false, builtIn: true, groups: ["Guests"] },
      ]
      if (action === "list") {
        return {
          result: JSON.stringify({
            action: "list",
            changed: false,
            accounts: failed ? [] : accounts,
            error: failed ? { code: "ACCESS_DENIED", message: "枚举本地账户失败" } : null,
          }),
          exitCode: failed ? 1 : 0,
        }
      }
      const userName = typeof payload.userName === "string" ? payload.userName : "office"
      const groupName = typeof payload.groupName === "string" ? payload.groupName : null
      const base = accounts.find((item) => item.userName === userName) ?? { ...accounts[1], userName }
      const target = action === "delete" ? null : {
        ...base,
        enabled: action === "enable" ? true : action === "disable" ? false : base.enabled,
        groups: action === "add-to-group" && groupName ? [...new Set([...base.groups, groupName])]
          : action === "remove-from-group" && groupName ? base.groups.filter((item) => item !== groupName)
            : base.groups,
      }
      return {
        result: JSON.stringify({
          action,
          changed: !failed,
          target: failed ? null : target,
          error: failed ? { code: "ACCESS_DENIED", message: "该账户受本机策略保护，操作被拒绝" } : null,
        }),
        exitCode: failed ? 1 : 0,
      }
    }
    case "manage-registry": {
      const action = String(payload.action ?? "list")
      const hive = payload.hive === "HKU" ? "HKU" : "HKLM"
      const view = payload.view === "registry32" ? "registry32" : "registry64"
      const subKey = typeof payload.subKey === "string" && payload.subKey ? payload.subKey : "SOFTWARE\\Nacho\\Agent"
      const sample = [
        { valueName: "InstallPath", valueKind: "string", value: "C:\\Program Files\\Nacho\\Agent", sizeBytes: 62 },
        { valueName: "HeartbeatSeconds", valueKind: "dword", value: 10, sizeBytes: 4 },
        { valueName: "Channels", valueKind: "multiString", value: ["ws", "http"], sizeBytes: 24 },
      ]
      const valueName = typeof payload.valueName === "string" ? payload.valueName : null
      const currentValue = valueName
        ? { valueName, valueKind: (typeof payload.valueKind === "string" ? payload.valueKind : "string") as string, value: (payload.value ?? "demo") as never, sizeBytes: 32 }
        : null
      const shared = { action, hive, view, subKey, error: failed ? { code: "ACCESS_DENIED", message: "注册表操作被拒绝" } : null }
      if (action === "list") {
        return { result: JSON.stringify({ ...shared, changed: false, values: failed ? [] : sample, previous: null, current: null }), exitCode: failed ? 1 : 0 }
      }
      if (action === "get") {
        return { result: JSON.stringify({ ...shared, changed: false, values: null, previous: null, current: failed ? null : (currentValue ?? sample[0]) }), exitCode: failed ? 1 : 0 }
      }
      if (action === "delete") {
        return { result: JSON.stringify({ ...shared, changed: !failed, values: null, previous: failed ? null : (currentValue ?? sample[0]), current: null }), exitCode: failed ? 1 : 0 }
      }
      return {
        result: JSON.stringify({ ...shared, changed: !failed, values: null, previous: sample[0], current: failed ? null : (currentValue ?? sample[0]) }),
        exitCode: failed ? 1 : 0,
      }
    }
    case "install-package": {
      const artifact = artifacts.find((item) => item.id === payload.artifactId)
      return {
        result: JSON.stringify({
          phase: failed ? "install-failed" : "installed",
          downloadedBytes: artifact?.sizeBytes ?? 10_485_760,
          hashVerified: true,
          installerType: artifact?.installerType ?? "msi",
          exitCode: failed ? 1603 : 0,
          rebootRequired: !failed && artifact?.installerType === "msi",
          durationMs: failed ? 24_800 : 61_200,
          timedOut: false,
          error: failed ? "安装程序返回 1603（安装过程中出现严重错误）" : null,
        }),
        exitCode: failed ? 1603 : 0,
      }
    }
    case "deploy-file": {
      const artifact = artifacts.find((item) => item.id === payload.artifactId)
      const destinationPath = typeof payload.destinationPath === "string" ? payload.destinationPath : "C:\\ProgramData\\Nacho\\proxy.conf"
      return {
        result: JSON.stringify({
          phase: failed ? "write-failed" : "completed",
          downloadedBytes: artifact?.sizeBytes ?? 4_312,
          hashVerified: true,
          destinationPath,
          conflictPolicy: payload.conflictPolicy === "replace" ? "replace" : "fail",
          replaced: payload.conflictPolicy === "replace" && !failed,
          backupValid: payload.conflictPolicy === "replace" && !failed,
          backupPath: payload.conflictPolicy === "replace" && !failed ? `${destinationPath}.bak` : null,
          previousSha256: payload.conflictPolicy === "replace" && !failed ? sha256Hex(`prev-${command.id}`) : null,
          finalSha256: failed ? null : (artifact?.sha256 ?? sha256Hex(`final-${command.id}`)),
          durationMs: failed ? 1_120 : 3_640,
          error: failed ? "目标路径已存在且冲突策略为 fail" : null,
        }),
        exitCode: failed ? 1 : 0,
      }
    }
    case "rollback-file-deploy": {
      const destinationPath = typeof payload.destinationPath === "string" ? payload.destinationPath : "C:\\ProgramData\\Nacho\\proxy.conf"
      return {
        result: JSON.stringify({
          phase: failed ? "failed" : "restored",
          originalCommandId: String(payload.originalCommandId ?? `cmd-${hex12()}`),
          destinationPath,
          backupValid: !failed,
          restoredSha256: failed ? null : sha256Hex(`restore-${command.id}`),
          error: failed ? "备份文件校验失败，未执行回滚" : null,
        }),
        exitCode: failed ? 1 : 0,
      }
    }
    case "update-agent": {
      return {
        result: JSON.stringify({
          fromVersion: client?.version ?? "1.1.0",
          targetVersion: releaseVersion,
          ...(failed ? { error: "安装包校验失败，已回滚到原版本", rollbackReason: "hash-mismatch" } : {}),
        }),
        exitCode: failed ? 1 : 0,
      }
    }
    default:
      return { result: JSON.stringify({ ok: !failed }), exitCode: failed ? 1 : 0 }
  }
}

/* ==================== 视图构建 ==================== */

function clientView(client: MockClient) {
  return { ...client, connected: client.status !== "offline" }
}

function commandView(command: MockCommand) {
  return {
    id: command.id,
    clientId: command.clientId,
    taskId: command.taskId,
    type: command.type,
    payload: command.payload,
    status: command.status,
    result: command.result,
    exitCode: command.exitCode,
    createdAt: command.createdAt,
    updatedAt: command.updatedAt,
  }
}

function overviewView() {
  const online = clients.filter((client) => client.status === "online").length
  const warning = clients.filter((client) => client.status === "warning").length
  const offline = clients.filter((client) => client.status === "offline").length
  const metrics = clients.filter((client) => client.metrics)
  const average = (pick: (value: NonNullable<MockClient["metrics"]>) => number) =>
    metrics.length === 0 ? 0 : Math.round(metrics.reduce((total, client) => total + pick(client.metrics!), 0) / metrics.length)
  return {
    clients: { total: clients.length, online, warning, offline, realtimeConnections: online + warning },
    tasks: { total: tasks.length, enabled: tasks.filter((task) => task.enabled).length },
    plugins: { installed: plugins.filter((plugin) => plugin.status === "installed").length },
    commands: { pending: commands.filter((command) => command.status === "pending" || command.status === "sent" || command.status === "running").length },
    resources: { cpu: average((value) => value.cpu), memory: average((value) => value.memory), disk: average((value) => value.disk) },
    health: {
      unread: healthFindings.filter((finding) => !finding.read).length,
      critical: healthFindings.filter((finding) => finding.severity === "critical").length,
      error: healthFindings.filter((finding) => finding.severity === "error").length,
      packages: healthPackages.length,
    },
    updatedAt: Date.now(),
  }
}

function batchView(batch: MockBatch) {
  const items = batch.items.map((item) => {
    const command = commands.find((candidate) => candidate.id === item.commandId)
    const client = clients.find((candidate) => candidate.id === item.clientId)
    const artifact = artifacts.find((candidate) => candidate.id === item.artifactId)
    return {
      id: item.id,
      commandId: item.commandId,
      artifactId: item.artifactId,
      clientId: item.clientId,
      artifact: artifact ?? null,
      client: client ? { id: client.id, name: client.name, hostname: client.hostname, status: client.status } : null,
      command: command ? commandView(command) : null,
    }
  })
  const counts: Record<string, number> = {}
  items.forEach((item) => {
    const status = item.command?.status ?? "pending"
    counts[status] = (counts[status] ?? 0) + 1
  })
  const finished = (counts.success ?? 0) + (counts.failed ?? 0) + (counts.canceled ?? 0)
  const status = finished < items.length
    ? (counts.running || counts.sent ? "running" : "pending")
    : counts.failed || counts.canceled
      ? (counts.success ? "completed-with-failures" : "failed")
      : "success"
  return {
    id: batch.id,
    kind: batch.kind,
    status,
    totalItems: batch.totalItems,
    createdAt: batch.createdAt,
    updatedAt: Math.max(batch.updatedAt, ...items.map((item) => item.command?.updatedAt ?? 0)),
    counts,
    items,
  }
}

function compareVersion(left: string, right: string) {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0)
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function agentUpdatesView() {
  const rows = clients.filter((client) => client.os === "Windows").map((client) => {
    const active = [...commands]
      .filter((command) => command.type === "update-agent" && command.clientId === client.id)
      .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
    const activeOngoing = active && !["success", "failed", "canceled"].includes(active.status)
    const comparison = compareVersion(client.version, releaseVersion)
    const skipReason = activeOngoing ? "active-update" : comparison === 0 ? "already-current" : comparison > 0 ? "newer-than-release" : null
    return {
      ...clientView(client),
      currentVersion: client.version,
      targetVersion: releaseVersion,
      command: active ? { id: active.id, status: active.status, result: active.result } : null,
      phase: active ? updatePhase(active) : null,
      skipReason,
    }
  })
  return { release, clients: rows }
}

/* ==================== 路由 ==================== */

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), { status, headers: { "Content-Type": "application/json" } })
}

function fail(message: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, message }), { status, headers: { "Content-Type": "application/json" } })
}

function parse(body: string | null): Json {
  if (!body) return {}
  try {
    const value = JSON.parse(body) as unknown
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {}
  } catch {
    return {}
  }
}

const artifactOnlyTypes = new Set(["install-package", "deploy-file", "rollback-file-deploy", "update-agent"])

function handle(method: string, pathname: string, search: URLSearchParams, rawBody: string | null): Response {
  tick()
  const body = parse(rawBody)
  const segments = pathname.split("/").filter(Boolean)
  const [first, second, third, fourth] = segments

  if (first === "overview" && method === "GET") return ok(overviewView())

  if (first === "clients") {
    if (!second && method === "GET") return ok(clients.map(clientView))
    if (!second && method === "POST") {
      const created = mockClient(
        String(body.name ?? `client-${clients.length + 1}`),
        String(body.hostname ?? body.name ?? "unknown"),
        String(body.ip ?? "10.0.0.1"),
        (body.os as MockClient["os"]) ?? "Windows",
        String(body.osName ?? "Windows 11 专业版"),
        "online",
        (body.tags as string[]) ?? [],
        String(body.group ?? groups[0]),
        String(body.version ?? releaseVersion),
        { cpu: 12, memory: 34, disk: 40, uptime: 3_600 },
      )
      clients.push(created)
      pushLog("info", "client", `新增客户端：${created.name}`)
      return ok(clientView(created), 201)
    }
    const client = clients.find((item) => item.id === second)
    if (!client) return fail("客户端不存在", 404)
    if (!third && method === "GET") return ok(clientView(client))
    if (!third && method === "PATCH") {
      if (typeof body.name === "string") client.name = body.name
      if (Array.isArray(body.tags)) client.tags = body.tags as string[]
      if (typeof body.group === "string") client.group = body.group
      if (typeof body.status === "string") {
        client.status = body.status as MockClient["status"]
        client.connected = client.status !== "offline"
      }
      return ok(clientView(client))
    }
    if (!third && method === "DELETE") {
      clients.splice(clients.indexOf(client), 1)
      pushLog("warn", "client", `删除客户端：${client.name}`)
      return ok({ id: client.id })
    }
    if (third === "commands" && method === "POST") {
      const type = String(body.type ?? "")
      if (!type) return fail("命令类型无效")
      if (artifactOnlyTypes.has(type)) return fail(`${type} 必须通过专用接口创建`)
      if (client.os !== "Windows" && type !== "run-shell") return fail("该命令仅支持 Windows 客户端")
      if (type === "open-url" && client.status !== "online") return fail("打开网页仅支持当前在线的 Windows 客户端")
      const payload = (body.payload as Json) ?? {}
      const expiresAt = type === "open-url" || type === "show-message"
        ? new Date(Date.now() + (type === "show-message" ? Number(payload.timeoutSeconds ?? 60) * 1000 : 120_000)).toISOString()
        : undefined
      return ok(commandView(createCommand(client.id, type, payload, { expiresAt })), 201)
    }
    if (third === "file-deployments" && segments[4] === "rollback" && method === "POST") {
      const origin = commands.find((item) => item.id === fourth)
      if (!origin) return fail("原始文件部署命令不存在", 404)
      const created = createCommand(client.id, "rollback-file-deploy", {
        originalCommandId: origin.id,
        destinationPath: origin.payload.destinationPath ?? "C:\\ProgramData\\Nacho\\proxy.conf",
      })
      return ok(commandView(created), 201)
    }
  }

  if (first === "commands") {
    if (!second && method === "GET") {
      const clientId = search.get("clientId")
      const list = commands.filter((command) => !clientId || command.clientId === clientId)
      return ok([...list].sort((left, right) => right.createdAt - left.createdAt).map(commandView))
    }
    if (second === "batch" && method === "POST") {
      const clientIds = Array.isArray(body.clientIds) ? (body.clientIds as string[]) : []
      const type = String(body.type ?? "")
      const payload = (body.payload as Json) ?? {}
      const targets = clientIds.map((id) => clients.find((client) => client.id === id))
      if (targets.some((client) => !client)) return fail("部分客户端不存在", 404)
      if (targets.some((client) => client!.os !== "Windows")) return fail("批量命令仅支持 Windows 客户端")
      if (type === "open-url" && targets.some((client) => client!.status !== "online")) {
        return fail("打开网页仅支持当前在线的 Windows 客户端")
      }
      const expiresAt = new Date(Date.now() + (type === "show-message" ? Number(payload.timeoutSeconds ?? 60) * 1000 : 120_000)).toISOString()
      const created = clientIds.map((clientId) => commandView(createCommand(clientId, type, payload, { expiresAt })))
      return ok({ commands: created }, 201)
    }
  }

  if (first === "groups") {
    if (!second && method === "GET") return ok([...groups])
    if (!second && method === "POST") {
      const name = String(body.name ?? "").trim()
      if (!name) return fail("分组名称无效")
      if (!groups.includes(name)) groups.push(name)
      pushLog("info", "client", `创建分组：${name}`)
      return ok([...groups], 201)
    }
    if (second && method === "DELETE") {
      const name = decodeURIComponent(second)
      const index = groups.indexOf(name)
      if (index >= 0) groups.splice(index, 1)
      return ok([...groups])
    }
  }

  if (first === "managed-artifacts") {
    if (!second && method === "GET") {
      const kind = search.get("kind")
      return ok(artifacts.filter((artifact) => artifact.status !== "deleted" && (!kind || artifact.kind === kind)))
    }
    if (!second && method === "POST") {
      const kind = body.kind === "file" ? "file" : "package"
      const created: MockArtifact = {
        id: `artifact-${hex12()}`,
        kind,
        displayName: String(body.displayName ?? "未命名制品"),
        version: String(body.version ?? ""),
        originalFileName: String(body.originalFileName ?? "artifact.bin"),
        storageName: `${kind}-${hex12()}`,
        sizeBytes: Number(body.sizeBytes ?? 0),
        sha256: null,
        installerType: kind === "package" ? ((body.installerType as "msi" | "exe") ?? "exe") : null,
        arguments: Array.isArray(body.arguments) ? (body.arguments as string[]) : [],
        successExitCodes: Array.isArray(body.successExitCodes) ? (body.successExitCodes as number[]) : kind === "package" ? [0] : [],
        status: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      artifacts.push(created)
      return ok(created, 201)
    }
    const artifact = artifacts.find((item) => item.id === second)
    if (!artifact) return fail("制品不存在", 404)
    if (third === "content" && method === "PUT") return ok(finishUpload(artifact))
    if (!third && method === "DELETE") {
      artifact.status = "deleted"
      return ok({ id: artifact.id })
    }
  }

  if (first === "package-deployments" && method === "POST") {
    const artifactIds = Array.isArray(body.artifactIds) ? (body.artifactIds as string[]) : []
    const clientIds = Array.isArray(body.clientIds) ? (body.clientIds as string[]) : []
    if (artifactIds.length === 0 || clientIds.length === 0) return fail("请选择制品与目标客户端")
    const items: MockBatchItem[] = []
    clientIds.forEach((clientId) => {
      artifactIds.forEach((artifactId) => {
        const command = createCommand(clientId, "install-package", { artifactId, timeoutSeconds: Number(body.timeoutSeconds ?? 1800) })
        items.push({ id: `item-${hex12()}`, commandId: command.id, artifactId, clientId })
      })
    })
    const batch: MockBatch = { id: `batch-${hex12()}`, kind: "package", totalItems: items.length, createdAt: Date.now(), updatedAt: Date.now(), items }
    batches.unshift(batch)
    return ok(batchView(batch), 201)
  }

  if (first === "file-deployments" && method === "POST") {
    const artifactId = String(body.artifactId ?? "")
    const clientIds = Array.isArray(body.clientIds) ? (body.clientIds as string[]) : []
    if (!artifactId || clientIds.length === 0) return fail("请选择文件与目标客户端")
    const items: MockBatchItem[] = clientIds.map((clientId) => {
      const command = createCommand(clientId, "deploy-file", {
        artifactId,
        destinationPath: String(body.destinationPath ?? "C:\\ProgramData\\Nacho\\deployed.bin"),
        conflictPolicy: body.conflictPolicy === "replace" ? "replace" : "fail",
        createDirectories: Boolean(body.createDirectories),
      })
      return { id: `item-${hex12()}`, commandId: command.id, artifactId, clientId }
    })
    const batch: MockBatch = { id: `batch-${hex12()}`, kind: "file", totalItems: items.length, createdAt: Date.now(), updatedAt: Date.now(), items }
    batches.unshift(batch)
    return ok(batchView(batch), 201)
  }

  if (first === "deployment-batches") {
    if (!second && method === "GET") {
      const kind = search.get("kind")
      const limit = Number(search.get("limit") ?? 20) || 20
      return ok(batches.filter((batch) => !kind || batch.kind === kind)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, limit)
        .map(batchView))
    }
    const batch = batches.find((item) => item.id === second)
    if (!batch) return fail("部署批次不存在", 404)
    if (method === "GET") return ok(batchView(batch))
  }

  if (first === "agent-updates") {
    if (method === "GET") return ok(agentUpdatesView())
    if (method === "POST") {
      const view = agentUpdatesView()
      const scope = body.scope === "clients" ? "clients" : "all"
      const requested = scope === "clients" && Array.isArray(body.clientIds) ? (body.clientIds as string[]) : []
      const queued: Array<{ id: string; status: string; result: string | null }> = []
      const skipped: Array<{ clientId: string; reason: string }> = []
      view.clients.forEach((row) => {
        const selected = scope === "all" ? row.skipReason === null : requested.includes(row.id)
        if (!selected) return
        if (row.skipReason !== null) {
          skipped.push({ clientId: row.id, reason: row.skipReason })
          return
        }
        const command = createCommand(row.id, "update-agent", { targetVersion: releaseVersion, sha256: release.sha256 })
        queued.push({ id: command.id, status: command.status, result: command.result })
      })
      pushLog("info", "update", `创建 Agent 升级命令`, `queued=${queued.length} skipped=${skipped.length}`)
      return ok({ release, queued, skipped }, 201)
    }
  }

  if (first === "logs") {
    if (second === "sources" && method === "GET") return ok([...new Set(logs.map((entry) => entry.source))])
    if (!second && method === "GET") {
      const level = search.get("level")
      const source = search.get("source")
      const keyword = search.get("q")?.toLowerCase()
      const since = Number(search.get("since") ?? 0)
      const limit = Number(search.get("limit") ?? 100) || 100
      return ok(logs
        .filter((entry) => (!level || level === "all" || entry.level === level)
          && (!source || source === "all" || entry.source === source)
          && (!keyword || entry.message.toLowerCase().includes(keyword) || (entry.detail ?? "").toLowerCase().includes(keyword))
          && (!since || entry.ts >= since))
        .slice(0, limit))
    }
    if (!second && method === "DELETE") {
      logs.length = 0
      return ok({ cleared: true })
    }
  }

  if (first === "tasks") {
    if (!second && method === "GET") return ok(tasks)
    if (!second && method === "POST") {
      const created = { ...body, id: `task-${hex12()}`, createdAt: Date.now(), updatedAt: Date.now() }
      tasks.push(created)
      return ok(created, 201)
    }
    const task = tasks.find((item) => item.id === second)
    if (!task) return fail("任务不存在", 404)
    if (!third && method === "PATCH") {
      Object.assign(task, body, { updatedAt: Date.now() })
      return ok(task)
    }
    if (third === "enabled" && method === "POST") {
      task.enabled = Boolean(body.enabled)
      task.updatedAt = Date.now()
      return ok(task)
    }
    if (third === "dispatch" && method === "POST") {
      const clientIds = Array.isArray(task.clientIds) ? (task.clientIds as string[]) : []
      const created = clientIds.map((clientId) => commandView(createCommand(clientId, "run-shell", {
        shell: task.os === "windows" ? "powershell" : "cmd",
        script: `${task.program} ${task.args}`.trim(),
        timeoutSeconds: 300,
      })))
      return ok({ taskId: task.id, commands: created })
    }
    if (!third && method === "DELETE") {
      tasks.splice(tasks.indexOf(task), 1)
      return ok({ id: second })
    }
  }

  if (first === "plugins") {
    if (!second && method === "GET") return ok(plugins)
    if (!second && method === "POST") {
      const created = { ...body, id: `plugin-${hex12()}` }
      plugins.push(created)
      return ok(created, 201)
    }
    const plugin = plugins.find((item) => item.id === second)
    if (!plugin) return fail("插件不存在", 404)
    if (!third && method === "PATCH") {
      Object.assign(plugin, body)
      return ok(plugin)
    }
    if (third === "status" && method === "POST") {
      plugin.status = String(body.status ?? "installed")
      return ok(plugin)
    }
    if (!third && method === "DELETE") {
      plugins.splice(plugins.indexOf(plugin), 1)
      return ok({ id: second })
    }
  }

  if (first === "health") {
    if (second === "findings" && !third && method === "GET") return ok(healthFindings)
    if (second === "findings" && third === "read-all" && method === "POST") {
      healthFindings.forEach((finding) => { finding.read = true })
      return ok({ done: true })
    }
    if (second === "findings" && fourth === "read" && method === "POST") {
      const finding = healthFindings.find((item) => item.id === third)
      if (finding) finding.read = true
      return ok({ id: third })
    }
    if (second === "packages" && method === "GET") return ok(healthPackages)
    if (second === "stats" && method === "GET") {
      return ok({
        unread: healthFindings.filter((finding) => !finding.read).length,
        critical: healthFindings.filter((finding) => finding.severity === "critical").length,
        error: healthFindings.filter((finding) => finding.severity === "error").length,
        warning: healthFindings.filter((finding) => finding.severity === "warning").length,
        packages: healthPackages.length,
      })
    }
  }

  if (first === "settings") {
    if (method === "GET") return ok(settings)
    if (method === "PUT") {
      settings = { ...settings, ...body }
      return ok(settings)
    }
  }

  return fail(`模拟服务端未实现该接口：${method} ${pathname}`, 404)
}

function finishUpload(artifact: MockArtifact) {
  artifact.status = "ready"
  artifact.sha256 = sha256Hex(artifact.id)
  artifact.updatedAt = Date.now()
  pushLog("info", "artifact", `制品上传完成：${artifact.displayName}`, `size=${artifact.sizeBytes}`)
  return artifact
}

/* ==================== 安装劫持 ==================== */

const PANEL_PREFIX = "/api/panel"

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

let installed = false
let seeded = false

function seedOnce() {
  if (seeded) return
  seeded = true
  seedLogs()
  seedHistory()
}

export function installMockPanelApi() {
  if (typeof window === "undefined" || installed || !isMockPanelEnabled()) return
  installed = true
  seedOnce()
  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let href: string
    if (typeof input === "string") href = input
    else if (input instanceof URL) href = input.href
    else href = input.url

    let url: URL
    try {
      url = new URL(href, window.location.origin)
    } catch {
      return originalFetch(input as RequestInfo, init)
    }
    if (!url.pathname.startsWith(PANEL_PREFIX)) return originalFetch(input as RequestInfo, init)

    const request = input instanceof Request ? input : null
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase()
    let rawBody: string | null = null
    if (typeof init?.body === "string") rawBody = init.body
    else if (request && method !== "GET" && method !== "HEAD") rawBody = await request.clone().text().catch(() => null)

    await delay(90 + Math.random() * 120)
    return handle(method, url.pathname.slice(PANEL_PREFIX.length) || "/", url.searchParams, rawBody)
  }

  console.log("[v0] 模拟控制服务端已启用（NEXT_PUBLIC_NACHO_MOCK=off 可关闭）")
}

/** 制品上传：模拟分片进度后把制品标记为 ready */
export async function mockUploadPanelApi<T>(path: string, file: File, onProgress: (percent: number) => void): Promise<T> {
  const match = /^\/managed-artifacts\/([^/]+)\/content$/.exec(path.split("?")[0])
  const artifact = match ? artifacts.find((item) => item.id === decodeURIComponent(match[1])) : undefined
  if (!artifact) throw new Error("制品不存在")
  artifact.status = "uploading"
  artifact.sizeBytes = file.size || artifact.sizeBytes
  for (let percent = 10; percent < 100; percent += 15) {
    onProgress(percent)
    await delay(120)
  }
  onProgress(100)
  return finishUpload(artifact) as unknown as T
}
