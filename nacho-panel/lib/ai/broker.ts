import { createControlClient, ControlError, type PanelCommand } from "./control-client"
import { createBrokerApproval } from "./approvals"
import { getLocalJobsManager } from "./local-jobs"
import { redactSecrets, truncateMiddle } from "./redact"
import { normalizeTimerSeconds } from "./task-timer"
import { findNachoTool, validateToolArgs } from "./tool-registry"
import type { StoredAIConfig } from "./settings-schema"
import type { ChatSession } from "./chat-sessions"

const MODEL_OUTPUT_LIMIT = 16 * 1024

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function numberOr(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)))
}

function formatClients(clients: Record<string, unknown>[]) {
  if (clients.length === 0) return "没有已注册的客户端。"
  const rows = clients.slice(0, 80).map((client) => [
    text(client.id),
    text(client.name, "-"),
    text(client.os, "-"),
    text(client.status, "-"),
    text(client.group, "-"),
  ].join("\t"))
  return `共 ${clients.length} 个客户端（id / name / os / status / group）\n${rows.join("\n")}${clients.length > 80 ? "\n…其余已省略" : ""}`
}

function formatCommands(commands: PanelCommand[]) {
  if (commands.length === 0) return "没有指令记录。"
  const rows = commands.slice(0, 40).map((command) =>
    `${command.id}\t${command.type}\t${command.status}\tclient=${command.clientId}\texit=${command.exitCode ?? "-"}\t${new Date(command.createdAt).toISOString()}`)
  return `最近 ${rows.length} 条指令（id / type / status / client / exit / created）\n${rows.join("\n")}`
}

function formatTasks(tasks: Record<string, unknown>[]) {
  if (tasks.length === 0) return "没有计划任务。"
  return tasks.slice(0, 60).map((task) =>
    `${text(task.id)}\t${text(task.name, "-")}\t${task.enabled === true ? "enabled" : "disabled"}`).join("\n")
}

function formatPlugins(plugins: Record<string, unknown>[]) {
  if (plugins.length === 0) return "没有插件记录。"
  return plugins.slice(0, 60).map((plugin) =>
    `${text(plugin.name, text(plugin.id, "-"))}\t${text(plugin.version, "-")}\t${text(plugin.status, "-")}`).join("\n")
}

function parseJson(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function formatProcesses(raw: string) {
  const parsed = parseJson(raw)
  const list = Array.isArray(parsed?.processes) ? parsed.processes as Record<string, unknown>[] : null
  if (!list) return raw
  const rows = list.slice(0, 40).map((proc) => [
    `pid=${proc.processId}`,
    text(proc.processName, "-"),
    `path=${text(proc.executablePath, "-")}`,
    `started=${text(proc.startedAtUtc, "-")}`,
    `terminate=${proc.canTerminate === true}`,
    `restart=${proc.canRestart === true}`,
  ].join(" "))
  return `进程 total=${parsed?.total ?? list.length} returned=${parsed?.returned ?? list.length}${parsed?.truncated ? "（已截断）" : ""}\n${rows.join("\n")}`
}

function formatServices(raw: string) {
  const parsed = parseJson(raw)
  const list = Array.isArray(parsed?.services) ? parsed.services as Record<string, unknown>[] : null
  if (!list) return raw
  const rows = list.slice(0, 60).map((service) =>
    `${text(service.name, "-")}\t${text(service.displayName, "-")}\t${text(service.status, "-")}`)
  return `服务 total=${parsed?.total ?? list.length} returned=${parsed?.returned ?? list.length}${parsed?.truncated ? "（已截断）" : ""}\n${rows.join("\n")}`
}

function clampString(value: unknown, maximum: number) {
  const result = text(value)
  return result.length > maximum ? result.slice(0, maximum) : result
}

async function dispatchAndWait(
  control: ReturnType<typeof createControlClient>,
  clientId: string,
  type: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok: boolean; text: string; result?: string }> {
  const command = await control.dispatchCommand(clientId, type, payload)
  const { command: final, timedOut } = await control.waitForCommand(clientId, command.id, timeoutMs)
  if (timedOut) {
    return { ok: true, text: `指令 ${command.id} 仍在执行。可稍后用 nacho_list_commands 查看结果。` }
  }
  if (!final) return { ok: false, text: `指令 ${command.id} 未返回结果。` }
  const result = final.result ? `\n${final.result}` : ""
  return {
    ok: final.status === "success",
    text: `指令 ${type} 状态 ${final.status}${final.exitCode === null ? "" : `，exitCode=${final.exitCode}`}${result}`,
    ...(final.result ? { result: final.result } : {}),
  }
}

function shellPayload(script: string, timeoutSeconds = 120) {
  return { shell: "powershell", script, timeoutSeconds }
}

function safeContainer(value: unknown) {
  const container = text(value)
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(container) ? container : ""
}

export async function executeNachoTool(input: {
  toolName: string
  args: Record<string, unknown>
  chat: ChatSession
  settings: StoredAIConfig
}): Promise<{ ok: boolean; text: string }> {
  const tool = findNachoTool(input.toolName)
  if (!tool) return { ok: false, text: `未知工具：${input.toolName}` }
  if (tool.skill && !input.settings.skills.some((skill) => skill.id === tool.skill && skill.enabled)) {
    return { ok: false, text: `技能 ${tool.skill} 未启用，无法使用 ${tool.id}` }
  }
  if (tool.plugin && !input.settings.plugins.some((plugin) => plugin.id === tool.plugin && plugin.enabled)) {
    return { ok: false, text: `插件 ${tool.plugin} 未启用，无法使用 ${tool.id}` }
  }
  const args = input.args || {}
  const errors = validateToolArgs(tool.inputSchema, args)
  if (errors.length > 0) return { ok: false, text: `参数错误：${errors.join("；")}` }

  const clientId = text(args.clientId)
  const control = createControlClient(input.chat.connection)
  if (clientId) {
    let client: Record<string, unknown>
    try {
      client = await control.getClient(clientId)
    } catch (error) {
      if (error instanceof ControlError && error.status === 404) {
        return { ok: false, text: `客户端 ${clientId} 不存在` }
      }
      return { ok: false, text: error instanceof Error ? error.message : "读取客户端失败" }
    }
    if (client.status !== "online") {
      return { ok: false, text: `客户端 ${clientId} 当前不在线，无法执行` }
    }
  }

  const danger = tool.dangerFor ? tool.dangerFor(args) : tool.danger
  if (danger && input.settings.confirmDanger) {
    const decision = await createBrokerApproval({
      uiSessionId: input.chat.uiSessionId,
      tool: tool.id,
      detail: tool.summarize(args),
      risk: "danger",
      danger: true,
    })
    if (decision === "reject") return { ok: false, text: "用户拒绝执行该操作。" }
  }

  try {
    switch (tool.id) {
      case "nacho_list_clients":
        return { ok: true, text: formatClients(await control.listClients()) }
      case "nacho_get_client": {
        const client = await control.getClient(clientId)
        return { ok: true, text: JSON.stringify(client, null, 2) }
      }
      case "nacho_overview":
        return { ok: true, text: JSON.stringify(await control.getOverview(), null, 2) }
      case "nacho_health_stats":
        return { ok: true, text: JSON.stringify(await control.getHealthStats(), null, 2) }
      case "nacho_list_commands":
        return { ok: true, text: formatCommands(await control.listCommands(clientId || undefined)) }
      case "nacho_list_tasks":
        return { ok: true, text: formatTasks(await control.listTasks()) }
      case "nacho_list_plugins":
        return { ok: true, text: formatPlugins(await control.listPlugins()) }
      case "nacho_list_services": {
        const result = await dispatchAndWait(control, clientId, "manage-service", { action: "list" }, 120_000)
        return { ok: result.ok, text: formatServices(result.result || result.text) }
      }
      case "nacho_list_processes": {
        const result = await dispatchAndWait(control, clientId, "list-processes", {}, 120_000)
        return { ok: result.ok, text: formatProcesses(result.result || result.text) }
      }
      case "nacho_collect_logs": {
        const until = new Date()
        const sinceMinutes = numberOr(args.sinceMinutes, 60, 1, 1440)
        const since = new Date(until.getTime() - sinceMinutes * 60_000)
        const sources = Array.isArray(args.sources) && args.sources.length > 0
          ? args.sources
          : ["agent", "system", "application"]
        const payload = {
          sources,
          sinceUtc: since.toISOString(),
          untilUtc: until.toISOString(),
          maxEntries: numberOr(args.maxEntries, 200, 1, 1000),
        }
        return dispatchAndWait(control, clientId, "collect-logs", payload, 180_000)
      }
      case "nacho_run_shell": {
        const script = text(args.script)
        if (!script) return { ok: false, text: "script 不能为空" }
        const payload = {
          shell: args.shell === "cmd" ? "cmd" : "powershell",
          script,
          timeoutSeconds: numberOr(args.timeoutSeconds, 60, 1, 900),
        }
        return dispatchAndWait(control, clientId, "run-shell", payload, Math.min(payload.timeoutSeconds + 30, 300) * 1000)
      }
      case "nacho_run_program": {
        const program = text(args.program)
        if (!program) return { ok: false, text: "program 不能为空" }
        const payload = {
          program,
          ...(text(args.args) ? { args: text(args.args) } : {}),
          timeoutSeconds: numberOr(args.timeoutSeconds, 60, 1, 900),
        }
        return dispatchAndWait(control, clientId, "run-program", payload, Math.min(payload.timeoutSeconds + 30, 300) * 1000)
      }
      case "nacho_manage_service": {
        const serviceName = text(args.serviceName)
        if (!serviceName) return { ok: false, text: "serviceName 不能为空" }
        const payload = {
          serviceName,
          action: text(args.action),
          ...(args.timeoutSeconds === undefined ? {} : { timeoutSeconds: numberOr(args.timeoutSeconds, 60, 1, 120) }),
        }
        return dispatchAndWait(control, clientId, "manage-service", payload, 180_000)
      }
      case "nacho_terminate_process": {
        const payload = {
          processId: args.processId,
          expectedPath: text(args.expectedPath),
          ...(text(args.expectedStartedAtUtc) ? { expectedStartedAtUtc: text(args.expectedStartedAtUtc) } : {}),
          ...(args.killProcessTree === undefined ? {} : { killProcessTree: args.killProcessTree === true }),
          ...(args.timeoutSeconds === undefined ? {} : { timeoutSeconds: numberOr(args.timeoutSeconds, 30, 1, 120) }),
        }
        return dispatchAndWait(control, clientId, "terminate-process", payload, 120_000)
      }
      case "nacho_restart_process": {
        const payload = {
          processId: args.processId,
          expectedPath: text(args.expectedPath),
          expectedStartedAtUtc: text(args.expectedStartedAtUtc),
          timeoutSeconds: numberOr(args.timeoutSeconds, 60, 1, 120),
        }
        return dispatchAndWait(control, clientId, "restart-process", payload, 180_000)
      }
      case "nacho_set_process_efficiency": {
        const payload = {
          processId: args.processId,
          expectedPath: text(args.expectedPath),
          expectedStartedAtUtc: text(args.expectedStartedAtUtc),
          enabled: args.enabled === true,
        }
        return dispatchAndWait(control, clientId, "set-process-efficiency", payload, 120_000)
      }
      case "nacho_show_message": {
        const message = clampString(args.message, 2000)
        if (!message) return { ok: false, text: "message 不能为空" }
        const timeoutSeconds = numberOr(args.timeoutSeconds, 60, 5, 300)
        const payload = {
          title: clampString(args.title, 128) || "Nacho AI",
          message,
          severity: args.severity === "warning" || args.severity === "error" ? args.severity : "info",
          timeoutSeconds,
        }
        return dispatchAndWait(control, clientId, "show-message", payload, (timeoutSeconds + 30) * 1000)
      }
      case "nacho_set_timer": {
        const seconds = normalizeTimerSeconds(args.afterSeconds)
        if (seconds === null) return { ok: false, text: "afterSeconds 必须是 10..3600 的数字" }
        const reminder = text(args.reminder)
        if (!reminder) return { ok: false, text: "reminder 不能为空" }
        return {
          ok: true,
          text: `计时器已设置：${seconds} 秒后提醒你：${reminder.slice(0, 500)}。任务提前完成或不再需要检查时，请调用 nacho_cancel_timer 取消；到期后会提醒你检查进度并决定继续/停止。`,
        }
      }
      case "nacho_cancel_timer":
        return { ok: true, text: "计时器已取消。" }
      case "nacho_start_local_job": {
        const command = text(args.command)
        if (!command) return { ok: false, text: "command 不能为空" }
        const job = getLocalJobsManager().start({
          uiSessionId: input.chat.uiSessionId,
          command,
          ...(text(args.cwd) ? { cwd: text(args.cwd) } : {}),
          shell: args.shell === "cmd" ? "cmd" : "powershell",
          ...(text(args.label) ? { label: text(args.label) } : {}),
        })
        return {
          ok: true,
          text: `本地后台任务已启动：jobId=${job.id} pid=${job.pid} logPath=${job.logPath}。请立即调用 nacho_set_timer 设置检查点。`,
        }
      }
      case "nacho_get_local_job": {
        const jobId = text(args.jobId)
        if (!jobId) return { ok: false, text: "jobId 不能为空" }
        const description = getLocalJobsManager().describe(jobId, numberOr(args.tailLines, 80, 20, 200))
        return description ? { ok: true, text: description } : { ok: false, text: `本地任务 ${jobId} 不存在` }
      }
      case "nacho_stop_local_job": {
        const jobId = text(args.jobId)
        if (!jobId) return { ok: false, text: "jobId 不能为空" }
        const job = getLocalJobsManager().stop(jobId)
        return job
          ? { ok: true, text: `本地任务 ${job.id} 状态：${job.status}` }
          : { ok: false, text: `本地任务 ${jobId} 不存在` }
      }
      case "nacho_list_local_jobs": {
        const jobs = getLocalJobsManager().list()
        if (jobs.length === 0) return { ok: true, text: "没有本地后台任务。" }
        return {
          ok: true,
          text: jobs.slice(0, 20).map((job) =>
            `${job.id}\t${job.status}\tpid=${job.pid}\t${job.label}\t${new Date(job.startedAt).toISOString()}`).join("\n"),
        }
      }
      case "nacho_open_url":
        return dispatchAndWait(control, clientId, "open-url", { url: text(args.url) }, 60_000)
      case "nacho_docker": {
        const action = text(args.action)
        const container = safeContainer(args.container)
        if ((action === "logs" || action === "restart") && !container) {
          return { ok: false, text: "该 Docker 操作需要合法的 container 名称" }
        }
        const script = action === "ps"
          ? "docker ps"
          : action === "logs"
            ? `docker logs --tail 200 ${container}`
            : `docker restart ${container}`
        return dispatchAndWait(control, clientId, "run-shell", shellPayload(script), 120_000)
      }
      case "nacho_nginx": {
        const script = args.action === "reload" ? "nginx -s reload" : "nginx -t"
        return dispatchAndWait(control, clientId, "run-shell", shellPayload(script), 120_000)
      }
      case "nacho_backup": {
        const script = args.action === "start" ? "wbadmin start backup -quiet" : "wbadmin get versions"
        return dispatchAndWait(control, clientId, "run-shell", shellPayload(script), 300_000)
      }
      default:
        return { ok: false, text: `工具未实现：${tool.id}` }
    }
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : "工具执行失败" }
  }
}

export function finalizeToolText(textValue: string, connectionKey: string) {
  const redacted = redactSecrets(textValue, [connectionKey])
  return truncateMiddle(redacted, MODEL_OUTPUT_LIMIT)
}
