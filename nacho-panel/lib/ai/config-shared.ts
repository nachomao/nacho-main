/* AI Mode 配置模型：客户端设置页与服务端路由共用，不包含任何 Node 依赖。 */

export type AIModelId =
  | "gpt-5.2"
  | "claude-sonnet-4.5"
  | "deepseek-v4"
  | "qwen3-max"
  | "glm-5-plus"
  | "custom"

export type AISkill = {
  id: string
  name: string
  desc: string
  enabled: boolean
  builtin?: boolean
}

export type MCPServer = {
  id: string
  name: string
  url: string
  status: "connected" | "error" | "disabled"
  tools: number
  /** 仅在设置页输入框中短暂存在；服务端永远不会把已保存的 Token 回传。 */
  token?: string
  hasToken?: boolean
  lastCheckedAt?: number
}

export type AIPluginBinding = {
  id: string
  name: string
  desc: string
  enabled: boolean
}

export type AIConfig = {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: AIModelId
  customModel: string
  temperature: number
  /** 执行危险操作（重启/删除/本机 shell）前需要人工确认 */
  confirmDanger: boolean
  skills: AISkill[]
  mcpServers: MCPServer[]
  plugins: AIPluginBinding[]
  hasApiKey?: boolean
}

export const MAX_MCP_SERVERS = 16
export const MAX_MCP_URL_LENGTH = 2048
export const MAX_MCP_TOKEN_LENGTH = 8192
export const MAX_API_KEY_LENGTH = 4096
export const MAX_AI_REQUEST_LENGTH = 64 * 1024
export const MAX_AI_SETTINGS_BYTES = 128 * 1024

export const modelOptions: { id: AIModelId; label: string; vendor: string }[] = [
  { id: "gpt-5.2", label: "GPT-5.2", vendor: "OpenAI" },
  { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", vendor: "Anthropic" },
  { id: "deepseek-v4", label: "DeepSeek V4", vendor: "DeepSeek" },
  { id: "qwen3-max", label: "Qwen3 Max", vendor: "Alibaba" },
  { id: "glm-5-plus", label: "GLM-5 Plus", vendor: "Zhipu" },
  { id: "custom", label: "自定义模型", vendor: "手动填写" },
]

export const AIModelIds = modelOptions.map((option) => option.id)

export const AI_SKILL_IDS = ["s-ops", "s-diag", "s-report", "s-task"] as const
export const AI_PLUGIN_IDS = ["p-docker", "p-nginx", "p-backup"] as const

export const defaultAIConfig: AIConfig = {
  enabled: true,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-5.2",
  customModel: "",
  temperature: 0.3,
  confirmDanger: true,
  skills: [
    { id: "s-ops", name: "运维执行", desc: "在客户端上执行命令、管理服务与进程", enabled: true, builtin: true },
    { id: "s-diag", name: "故障诊断", desc: "分析日志与指标，定位异常原因", enabled: true, builtin: true },
    { id: "s-report", name: "巡检报告", desc: "汇总客户端健康状态，生成巡检摘要", enabled: true },
    { id: "s-task", name: "任务编排", desc: "把自然语言转换成计划任务并登记", enabled: false },
  ],
  mcpServers: [],
  plugins: [
    { id: "p-docker", name: "Docker 管理", desc: "允许 AI 查询与操作容器", enabled: true },
    { id: "p-nginx", name: "Nginx 网关", desc: "允许 AI 读取与重载站点配置", enabled: true },
    { id: "p-backup", name: "备份助手", desc: "允许 AI 触发与校验备份", enabled: false },
  ],
}

export function createDefaultAIConfig(): AIConfig {
  return structuredClone(defaultAIConfig)
}

export function resolveAIModel(config: Pick<AIConfig, "model" | "customModel">): string {
  return config.model === "custom" ? config.customModel.trim() : config.model
}

export function resolveAILabel(config: Pick<AIConfig, "model" | "customModel">): string {
  if (config.model === "custom") return config.customModel.trim() || "自定义模型"
  return modelOptions.find((option) => option.id === config.model)?.label ?? config.model
}
