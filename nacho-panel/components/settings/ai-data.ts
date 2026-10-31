"use client"

/* AI Mode 的数据模型、默认值与跨页面共享存储 */

import { useSyncExternalStore } from "react"
import {
  createDefaultAIConfig,
  defaultAIConfig,
  modelOptions,
  type AIConfig,
} from "@/lib/ai/config-shared"

export {
  defaultAIConfig,
  modelOptions,
  type AIConfig,
  type AIModelId,
  type AIPluginBinding,
  type AISkill,
  type MCPServer,
} from "@/lib/ai/config-shared"

let state: AIConfig = createDefaultAIConfig()
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

export const aiConfigStore = {
  get: () => state,
  set: (patch: Partial<AIConfig>) => {
    state = { ...state, ...patch }
    notify()
  },
  hydrate: (next: AIConfig) => {
    state = next
    notify()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

/** 服务端只返回脱敏配置；合并时保留当前输入框中尚未保存的密钥与 Token。 */
export function mergeRedactedConfig(redacted: AIConfig, current: AIConfig): AIConfig {
  const currentServers = new Map(current.mcpServers.map((server) => [server.id, server]))
  return {
    ...redacted,
    apiKey: current.apiKey,
    hasApiKey: redacted.hasApiKey,
    mcpServers: redacted.mcpServers.map((server) => ({
      ...server,
      token: currentServers.get(server.id)?.token,
    })),
  }
}

export function useAIConfig() {
  return useSyncExternalStore(aiConfigStore.subscribe, aiConfigStore.get, () => defaultAIConfig)
}
