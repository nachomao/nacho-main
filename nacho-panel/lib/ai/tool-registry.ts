import { NACHO_TOOL_META } from "./tool-meta"
import type { StoredAIConfig } from "./settings-schema"

export type JsonSchema = Record<string, unknown>

export type NachoToolDefinition = {
  id: string
  mcpName: string
  description: string
  inputSchema: JsonSchema
  risk?: "warn" | "danger"
  danger: boolean
  dangerFor?: (args: Record<string, unknown>) => boolean
  skill?: string
  plugin?: string
  summarize: (args: Record<string, unknown>) => string
}

function obj(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false }
}

function str(description: string, extra: JsonSchema = {}): JsonSchema {
  return { type: "string", description, ...extra }
}

function int(description: string, minimum: number, maximum: number): JsonSchema {
  return { type: "integer", description, minimum, maximum }
}

function bool(description: string): JsonSchema {
  return { type: "boolean", description }
}

function oneOf(description: string, values: string[]): JsonSchema {
  return { type: "string", description, enum: values }
}

const clientId = str("受管客户端 ID。先用 nacho_list_clients 查询，不要猜测。", { maxLength: 128 })

function definition(
  id: string,
  description: string,
  inputSchema: JsonSchema,
  summarize: (args: Record<string, unknown>) => string,
  options: {
    risk?: "warn" | "danger"
    danger?: boolean
    dangerFor?: (args: Record<string, unknown>) => boolean
    skill?: string
    plugin?: string
  } = {},
): NachoToolDefinition {
  const meta = NACHO_TOOL_META[id]
  return {
    id,
    mcpName: id.replace(/^nacho_/, ""),
    description,
    inputSchema,
    risk: options.risk ?? meta?.risk,
    danger: options.danger ?? meta?.danger ?? false,
    dangerFor: options.dangerFor,
    skill: options.skill ?? meta?.skill,
    plugin: options.plugin ?? meta?.plugin,
    summarize,
  }
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

export const NACHO_TOOLS: NachoToolDefinition[] = [
  definition(
    "nacho_list_clients",
    "列出已注册的受管客户端及其在线状态、系统、分组。回答运维问题前先调用它获取真实客户端 ID。",
    obj({}),
    () => "查询客户端列表",
  ),
  definition(
    "nacho_get_client",
    "读取单个客户端的详情（在线状态、系统、分组、最近指标）。",
    obj({ clientId }, ["clientId"]),
    (args) => `读取客户端 ${text(args.clientId)}`,
  ),
  definition(
    "nacho_overview",
    "读取控制服务端总览：客户端在线/离线数量、任务、插件、命令积压与资源汇总。",
    obj({}),
    () => "读取控制服务端总览",
  ),
  definition(
    "nacho_health_stats",
    "读取健康检查统计与最近的健康问题数量。",
    obj({}),
    () => "读取健康统计",
  ),
  definition(
    "nacho_list_commands",
    "读取最近的指令记录及状态；可选按客户端过滤。",
    obj({ clientId: str("可选：只看该客户端的指令", { maxLength: 128 }) }),
    (args) => `读取指令记录${text(args.clientId) ? `（${text(args.clientId)}）` : ""}`,
  ),
  definition(
    "nacho_list_tasks",
    "读取计划任务列表（只读）。",
    obj({}),
    () => "读取计划任务",
  ),
  definition(
    "nacho_list_plugins",
    "读取控制服务端的插件目录与安装状态。",
    obj({}),
    () => "读取插件目录",
  ),
  definition(
    "nacho_list_services",
    "列出客户端上的 Windows 服务及运行状态。",
    obj({ clientId }, ["clientId"]),
    (args) => `列出 ${text(args.clientId)} 的服务`,
    { risk: "warn" },
  ),
  definition(
    "nacho_list_processes",
    "列出客户端上的进程（PID、路径、CPU/内存、是否允许终止/重启）。做进程操作前先用它获取 identity 字段。",
    obj({ clientId }, ["clientId"]),
    (args) => `列出 ${text(args.clientId)} 的进程`,
  ),
  definition(
    "nacho_collect_logs",
    "采集客户端最近的 Windows 事件日志（agent/system/application）。结果可能较大，只总结关键错误。",
    obj({
      clientId,
      sinceMinutes: int("回溯分钟数，默认 60", 1, 1440),
      maxEntries: int("最多返回条数，默认 200", 1, 1000),
      sources: {
        type: "array",
        description: "日志来源，默认全部",
        items: { type: "string", enum: ["agent", "system", "application"] },
        minItems: 1,
        maxItems: 3,
      },
    }, ["clientId"]),
    (args) => `采集 ${text(args.clientId)} 的日志`,
    { risk: "warn" },
  ),
  definition(
    "nacho_run_shell",
    "在受管客户端执行 shell 脚本。危险操作，必须说明目的；优先使用专用工具而不是直接拼命令。",
    obj({
      clientId,
      script: str("要执行的脚本", { maxLength: 32_768 }),
      shell: oneOf("解释器，默认 powershell", ["powershell", "cmd"]),
      timeoutSeconds: int("超时秒数，默认 60", 1, 900),
    }, ["clientId", "script"]),
    (args) => `在 ${text(args.clientId)} 执行 ${text(args.shell, "powershell")}：${text(args.script).slice(0, 160)}`,
    { danger: true },
  ),
  definition(
    "nacho_run_program",
    "在受管客户端启动程序（不经过 shell）。危险操作，必须说明目的。",
    obj({
      clientId,
      program: str("可执行文件路径或名称", { maxLength: 4096 }),
      args: str("命令行参数", { maxLength: 8192 }),
      timeoutSeconds: int("等待秒数，默认 60", 1, 900),
    }, ["clientId", "program"]),
    (args) => `在 ${text(args.clientId)} 启动 ${text(args.program)} ${text(args.args)}`.trim(),
    { danger: true },
  ),
  definition(
    "nacho_manage_service",
    "启动、停止或重启客户端上的 Windows 服务。query 只查询状态；start/stop/restart 危险。先用 nacho_list_services 确认服务名。",
    obj({
      clientId,
      serviceName: str("服务名", { maxLength: 256 }),
      action: oneOf("操作", ["query", "start", "stop", "restart"]),
      timeoutSeconds: int("超时秒数，默认 60", 1, 120),
    }, ["clientId", "serviceName", "action"]),
    (args) => `${text(args.action)} 服务 ${text(args.serviceName)} @ ${text(args.clientId)}`,
    { danger: true, dangerFor: (args) => args.action !== "query" },
  ),
  definition(
    "nacho_terminate_process",
    "终止客户端上的进程。必须提供进程列表中的 PID、可执行文件路径与启动时间，避免误杀。危险操作。",
    obj({
      clientId,
      processId: int("PID", 1, 4_294_967_295),
      expectedPath: str("进程可执行文件路径", { maxLength: 32_767 }),
      expectedStartedAtUtc: str("进程启动时间（ISO 8601，带时区）", { maxLength: 64 }),
      killProcessTree: bool("是否终止进程树"),
      timeoutSeconds: int("超时秒数，默认 30", 1, 120),
    }, ["clientId", "processId", "expectedPath"]),
    (args) => `终止 ${text(args.clientId)} 的 PID ${String(args.processId ?? "")}`,
    { danger: true },
  ),
  definition(
    "nacho_restart_process",
    "重启客户端上的进程。必须提供进程列表中的 PID、路径、启动时间。危险操作。",
    obj({
      clientId,
      processId: int("PID", 1, 4_294_967_295),
      expectedPath: str("进程可执行文件路径", { maxLength: 32_767 }),
      expectedStartedAtUtc: str("进程启动时间（ISO 8601，带时区）", { maxLength: 64 }),
      timeoutSeconds: int("超时秒数，默认 60", 1, 120),
    }, ["clientId", "processId", "expectedPath", "expectedStartedAtUtc"]),
    (args) => `重启 ${text(args.clientId)} 的 PID ${String(args.processId ?? "")}`,
    { danger: true },
  ),
  definition(
    "nacho_set_process_efficiency",
    "开启或关闭客户端进程的效率模式。必须提供进程列表中的 PID、路径、启动时间。会修改进程状态。",
    obj({
      clientId,
      processId: int("PID", 1, 4_294_967_295),
      expectedPath: str("进程可执行文件路径", { maxLength: 32_767 }),
      expectedStartedAtUtc: str("进程启动时间（ISO 8601，带时区）", { maxLength: 64 }),
      enabled: bool("true 开启效率模式，false 关闭"),
    }, ["clientId", "processId", "expectedPath", "expectedStartedAtUtc", "enabled"]),
    (args) => `${args.enabled ? "开启" : "关闭"} ${text(args.clientId)} PID ${String(args.processId ?? "")} 的效率模式`,
    { risk: "warn", danger: true },
  ),
  definition(
    "nacho_set_timer",
    "设置本轮 AI 检查点计时器：到点后面板会把 reminder 发回同一会话，提醒你检查进度并决定继续/调整/停止。长任务启动本地后台 job 后使用。",
    obj({
      afterSeconds: int("多少秒后提醒，10..3600", 10, 3600),
      reminder: str("到点提醒 AI 做什么（含 jobId、日志路径、判断条件）", { maxLength: 500 }),
      label: str("短标签，最多 80 字", { maxLength: 80 }),
      onExpire: oneOf("到期策略，默认 wait；慢编译用 wait", ["wait", "interrupt"]),
    }, ["afterSeconds", "reminder"]),
    (args) => `设置计时器 ${String(args.afterSeconds ?? "")} 秒：${text(args.reminder).slice(0, 80)}`,
  ),
  definition(
    "nacho_cancel_timer",
    "取消本轮 AI 检查点计时器。任务完成或不再需要检查时调用。",
    obj({ reason: str("取消原因", { maxLength: 200 }) }),
    (args) => `取消计时器${text(args.reason) ? `：${text(args.reason)}` : ""}`,
  ),
  definition(
    "nacho_start_local_job",
    "在面板本机启动后台任务（编译、构建、长命令），立即返回 jobId、PID 和日志路径。危险操作，必须先说明目的和日志位置。",
    obj({
      command: str("要执行的本地命令", { maxLength: 32_768 }),
      cwd: str("工作目录，默认 AI 工作区", { maxLength: 4_096 }),
      shell: oneOf("解释器，默认 powershell", ["powershell", "cmd"]),
      label: str("任务标签，最多 80 字", { maxLength: 80 }),
    }, ["command"]),
    (args) => `启动本地后台任务：${text(args.command).slice(0, 160)}`,
    { danger: true },
  ),
  definition(
    "nacho_get_local_job",
    "读取面板本机后台任务的运行状态和日志 tail。计时器到期时先调用它检查编译/构建是否完成。",
    obj({
      jobId: str("本地任务 ID", { maxLength: 128 }),
      tailLines: int("返回日志行数，默认 80", 20, 200),
    }, ["jobId"]),
    (args) => `读取本地任务 ${text(args.jobId)}`,
  ),
  definition(
    "nacho_stop_local_job",
    "终止面板本机后台任务及其子进程。危险操作；仅在确认要放弃/停止长任务时使用。",
    obj({ jobId: str("本地任务 ID", { maxLength: 128 }) }, ["jobId"]),
    (args) => `停止本地任务 ${text(args.jobId)}`,
    { danger: true },
  ),
  definition(
    "nacho_list_local_jobs",
    "列出面板本机最近的后台任务及状态。",
    obj({}),
    () => "列出本地后台任务",
  ),
  definition(
    "nacho_show_message",
    "在客户端弹出提示框并等待用户确认/取消。",
    obj({
      clientId,
      title: str("标题，默认 Nacho AI", { maxLength: 128 }),
      message: str("正文，最多 2000 字符", { maxLength: 2000 }),
      severity: oneOf("级别，默认 info", ["info", "warning", "error"]),
      timeoutSeconds: int("等待秒数，默认 60", 5, 300),
    }, ["clientId", "message"]),
    (args) => `向 ${text(args.clientId)} 推送消息：${text(args.message).slice(0, 80)}`,
    { risk: "warn" },
  ),
  definition(
    "nacho_open_url",
    "在在线客户端用默认浏览器打开 HTTP/HTTPS 网页。",
    obj({ clientId, url: str("绝对 HTTP/HTTPS 地址", { maxLength: 2048 }) }, ["clientId", "url"]),
    (args) => `在 ${text(args.clientId)} 打开 ${text(args.url)}`,
    { risk: "warn" },
  ),
  definition(
    "nacho_docker",
    "Docker 插件预设：查看容器、查看日志或重启容器。避免直接执行 docker 命令。",
    obj({
      clientId,
      action: oneOf("操作", ["ps", "logs", "restart"]),
      container: str("容器名（logs/restart 必填）", { maxLength: 128 }),
    }, ["clientId", "action"]),
    (args) => `Docker ${text(args.action)}${text(args.container) ? ` ${text(args.container)}` : ""} @ ${text(args.clientId)}`,
    { risk: "warn", dangerFor: (args) => args.action === "restart" },
  ),
  definition(
    "nacho_nginx",
    "Nginx 插件预设：测试配置或平滑重载。避免直接执行 nginx 命令。",
    obj({ clientId, action: oneOf("操作", ["test", "reload"]) }, ["clientId", "action"]),
    (args) => `Nginx ${text(args.action)} @ ${text(args.clientId)}`,
    { risk: "warn", dangerFor: (args) => args.action === "reload" },
  ),
  definition(
    "nacho_backup",
    "备份插件预设：查询 Windows 备份版本或启动 wbadmin 备份。",
    obj({ clientId, action: oneOf("操作", ["status", "start"]) }, ["clientId", "action"]),
    (args) => `备份 ${text(args.action)} @ ${text(args.clientId)}`,
    { risk: "warn", dangerFor: (args) => args.action === "start" },
  ),
]

export function listNachoTools(settings: StoredAIConfig) {
  const skills = new Set(settings.skills.filter((skill) => skill.enabled).map((skill) => skill.id))
  const plugins = new Set(settings.plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.id))
  return NACHO_TOOLS.filter((tool) => {
    if (tool.skill && !skills.has(tool.skill)) return false
    if (tool.plugin && !plugins.has(tool.plugin)) return false
    return true
  })
}

export function findNachoTool(name: string) {
  return NACHO_TOOLS.find((tool) => tool.id === name)
    ?? NACHO_TOOLS.find((tool) => tool.mcpName === name)
    ?? null
}

export function validateToolArgs(schema: JsonSchema, value: unknown): string[] {
  const errors: string[] = []
  const type = schema.type
  if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return ["参数必须是对象"]
    const record = value as Record<string, unknown>
    const properties = (schema.properties || {}) as Record<string, JsonSchema>
    const required = Array.isArray(schema.required) ? schema.required as string[] : []
    for (const key of required) {
      if (!(key in record)) errors.push(`缺少参数 ${key}`)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) errors.push(`不支持参数 ${key}`)
      }
    }
    for (const [key, property] of Object.entries(properties)) {
      if (!(key in record)) continue
      errors.push(...validateToolArgs(property, record[key]).map((message) => `${key}: ${message}`))
    }
    return errors
  }
  if (type === "array") {
    if (!Array.isArray(value)) return ["必须是数组"]
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`至少 ${schema.minItems} 项`)
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errors.push(`最多 ${schema.maxItems} 项`)
    const items = schema.items as JsonSchema | undefined
    if (items) value.forEach((item, index) => errors.push(...validateToolArgs(items, item).map((message) => `[${index}]: ${message}`)))
    return errors
  }
  if (type === "string") {
    if (typeof value !== "string") return ["必须是字符串"]
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`长度不能超过 ${schema.maxLength}`)
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`必须是 ${schema.enum.join("/")} 之一`)
    return errors
  }
  if (type === "integer" || type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return ["必须是数字"]
    if (type === "integer" && !Number.isInteger(value)) return ["必须是整数"]
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`不能小于 ${schema.minimum}`)
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`不能大于 ${schema.maximum}`)
    return errors
  }
  if (type === "boolean") return typeof value === "boolean" ? [] : ["必须是布尔值"]
  return []
}
