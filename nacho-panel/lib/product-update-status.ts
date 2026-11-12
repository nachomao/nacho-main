export type UpdateSourceRuntime = {
  updateMode?: string
  updateSourceConfigured?: boolean
  updateSource?: string | null
  updateSourceOrigin?: "panel" | "env" | "none" | string
  capabilities?: { updateSourceManagement?: boolean }
  updateExecutorProtocol?: number | null
}

export type UpdateSourceState = "panel-local" | "server-env" | "server-panel" | "unsupported" | "disconnected"

export const UPDATE_SOURCE_STATE_LABELS: Record<UpdateSourceState, string> = {
  "panel-local": "仅面板本地",
  "server-env": "服务端 .env",
  "server-panel": "面板已保存",
  "unsupported": "服务端不支持面板管理",
  "disconnected": "服务端未连接",
}

export function updateSourceState(runtime: UpdateSourceRuntime | null | undefined): UpdateSourceState {
  if (!runtime) return "disconnected"
  if (runtime.capabilities?.updateSourceManagement !== true) return "unsupported"
  if (runtime.updateSourceOrigin === "panel") return "server-panel"
  if (runtime.updateSourceOrigin === "env") return "server-env"
  return "panel-local"
}

export function updateSourceServerText(runtime: UpdateSourceRuntime | null | undefined): string {
  const state = updateSourceState(runtime)
  if (state === "disconnected") return "未连接"
  if (state === "unsupported") return "服务端 1.2.1 起支持面板管理"
  if (state === "server-panel") return runtime?.updateSource || "已由面板保存（未配置）"
  if (state === "server-env") return runtime?.updateSource ? `${runtime.updateSource}（来自 .env）` : ".env 未配置"
  return "未配置"
}

export function serverUpdateIssue(runtime: UpdateSourceRuntime, local: boolean, kind: "server" | "agent" = "server") {
  if (local && kind === "server") return null
  if (runtime.updateSourceConfigured === false) {
    return runtime.capabilities?.updateSourceManagement === true
      ? "控制服务尚未配置更新源，请在“更新服务器”中保存更新源后重试。"
      : "控制服务尚未配置更新源；当前服务端不支持面板管理，请升级到 1.2.1 或在服务端配置 NACHO_UPDATE_ORIGIN。"
  }
  if (runtime.updateMode !== "recommended") return "控制服务使用旧更新协议，请先安装迁移版本。"
  if (kind === "server" && runtime.updateExecutorProtocol !== 4) return "独立升级执行器需要迁移，请在服务端安装新版部署组件。"
  return null
}
