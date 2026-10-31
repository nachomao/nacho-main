import type { AIChatStepSource } from "./chat-events"

export type NachoToolMeta = {
  source: AIChatStepSource
  risk?: "warn" | "danger"
  danger?: boolean
  skill?: string
  plugin?: string
}

export const NACHO_TOOL_META: Record<string, NachoToolMeta> = {
  nacho_list_clients: { source: "core" },
  nacho_get_client: { source: "core" },
  nacho_overview: { source: "core" },
  nacho_list_commands: { source: "core" },
  nacho_list_plugins: { source: "core" },
  nacho_health_stats: { source: "skill", skill: "s-diag" },
  nacho_list_processes: { source: "skill", skill: "s-diag" },
  nacho_collect_logs: { source: "skill", skill: "s-diag", risk: "warn" },
  nacho_list_services: { source: "skill", skill: "s-ops" },
  nacho_list_tasks: { source: "skill", skill: "s-task" },
  nacho_run_shell: { source: "skill", skill: "s-ops", risk: "danger", danger: true },
  nacho_run_program: { source: "skill", skill: "s-ops", risk: "danger", danger: true },
  nacho_manage_service: { source: "skill", skill: "s-ops", risk: "danger", danger: true },
  nacho_terminate_process: { source: "skill", skill: "s-ops", risk: "danger", danger: true },
  nacho_restart_process: { source: "skill", skill: "s-ops", risk: "danger", danger: true },
  nacho_set_process_efficiency: { source: "skill", skill: "s-ops", risk: "warn" },
  nacho_show_message: { source: "skill", skill: "s-ops", risk: "warn" },
  nacho_open_url: { source: "skill", skill: "s-ops", risk: "warn" },
  nacho_set_timer: { source: "core" },
  nacho_cancel_timer: { source: "core" },
  nacho_start_local_job: { source: "core", risk: "danger", danger: true },
  nacho_get_local_job: { source: "core" },
  nacho_stop_local_job: { source: "core", risk: "danger", danger: true },
  nacho_list_local_jobs: { source: "core" },
  nacho_docker: { source: "plugin", plugin: "p-docker", risk: "warn" },
  nacho_nginx: { source: "plugin", plugin: "p-nginx", risk: "warn" },
  nacho_backup: { source: "plugin", plugin: "p-backup", risk: "warn" },
}

export const NACHO_TOOL_NAMES = Object.keys(NACHO_TOOL_META)

const BUILTIN_TOOLS = new Set([
  "bash", "edit", "write", "read", "grep", "glob", "list", "webfetch", "websearch",
  "question", "task", "skill", "todowrite",
])

export function toolSource(name: string): AIChatStepSource {
  const meta = NACHO_TOOL_META[name]
  if (meta) return meta.source
  if (BUILTIN_TOOLS.has(name)) return "core"
  return "mcp"
}

export function toolDanger(name: string): boolean {
  if (NACHO_TOOL_META[name]?.danger) return true
  return name === "bash" || name === "edit" || name === "write"
}

export function toolRisk(name: string): "warn" | "danger" | undefined {
  const meta = NACHO_TOOL_META[name]
  if (meta?.risk) return meta.risk
  if (toolDanger(name)) return "danger"
  if (name === "webfetch" || name === "websearch") return "warn"
  return undefined
}
