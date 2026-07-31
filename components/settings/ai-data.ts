"use client"

/* AI Mode 的数据模型、默认值与跨页面共享存储 */

import { useSyncExternalStore } from "react"

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
  /** 执行危险操作（重启/删除）前需要人工确认 */
  confirmDanger: boolean
  skills: AISkill[]
  mcpServers: MCPServer[]
  plugins: AIPluginBinding[]
}

export const modelOptions: { id: AIModelId; label: string; vendor: string }[] = [
  { id: "gpt-5.2", label: "GPT-5.2", vendor: "OpenAI" },
  { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", vendor: "Anthropic" },
  { id: "deepseek-v4", label: "DeepSeek V4", vendor: "DeepSeek" },
  { id: "qwen3-max", label: "Qwen3 Max", vendor: "Alibaba" },
  { id: "glm-5-plus", label: "GLM-5 Plus", vendor: "Zhipu" },
  { id: "custom", label: "自定义模型", vendor: "手动填写" },
]

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
  mcpServers: [
    { id: "m-fs", name: "文件系统", url: "mcp://localhost/fs", status: "connected", tools: 6 },
    { id: "m-prom", name: "Prometheus", url: "mcp://10.0.0.4:9090", status: "connected", tools: 4 },
    { id: "m-git", name: "Git 仓库", url: "mcp://localhost/git", status: "disabled", tools: 9 },
  ],
  plugins: [
    { id: "p-docker", name: "Docker 管理", desc: "允许 AI 查询与操作容器", enabled: true },
    { id: "p-nginx", name: "Nginx 网关", desc: "允许 AI 读取与重载站点配置", enabled: true },
    { id: "p-backup", name: "备份助手", desc: "允许 AI 触发与校验备份", enabled: false },
  ],
}

/* ---------- 模块级共享存储：设置页与顶栏 AI 面板共用一份配置 ---------- */

let state: AIConfig = defaultAIConfig
const listeners = new Set<() => void>()

export const aiConfigStore = {
  get: () => state,
  set: (patch: Partial<AIConfig>) => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  },
  subscribe: (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

export function useAIConfig() {
  return useSyncExternalStore(aiConfigStore.subscribe, aiConfigStore.get, () => defaultAIConfig)
}
