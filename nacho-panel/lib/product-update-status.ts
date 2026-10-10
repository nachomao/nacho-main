export function serverUpdateIssue(runtime: {
  updateMode?: string
  updateSourceConfigured?: boolean
  updateExecutorProtocol?: number | null
}, local: boolean, kind: "server" | "agent" = "server") {
  if (local && kind === "server") return null
  if (runtime.updateSourceConfigured === false) return "控制服务尚未配置更新源，请在服务端配置后重试。"
  if (runtime.updateMode !== "recommended") return "控制服务使用旧更新协议，请先安装迁移版本。"
  if (kind === "server" && runtime.updateExecutorProtocol !== 4) return "独立升级执行器需要迁移，请在服务端安装新版部署组件。"
  return null
}
