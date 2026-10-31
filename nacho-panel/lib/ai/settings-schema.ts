import {
  AIModelIds,
  AI_PLUGIN_IDS,
  AI_SKILL_IDS,
  MAX_API_KEY_LENGTH,
  MAX_MCP_SERVERS,
  MAX_MCP_TOKEN_LENGTH,
  MAX_MCP_URL_LENGTH,
  defaultAIConfig,
  type AIConfig,
  type AIModelId,
  type AIPluginBinding,
  type AISkill,
  type MCPServer,
} from "./config-shared"

export class AISettingsValidationError extends Error {}

export type StoredMCPServer = Omit<MCPServer, "hasToken"> & { token: string }

export type StoredAIConfig = Omit<AIConfig, "apiKey" | "hasApiKey" | "mcpServers"> & {
  apiKey: string
  mcpServers: StoredMCPServer[]
}

export type MCPServerPatch = StoredMCPServer & { clearToken?: boolean }

export type AISettingsPatch = Partial<Omit<StoredAIConfig, "mcpServers">> & {
  clearKey?: boolean
  mcpServers?: MCPServerPatch[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length > 0) throw new AISettingsValidationError(`${label} 包含未知字段：${unknown.join(", ")}`)
}

function validateHttpUrl(value: unknown, label: string, allowSearch: boolean) {
  if (typeof value !== "string") throw new AISettingsValidationError(`${label}必须是字符串`)
  const trimmed = value.trim()
  if (!trimmed) throw new AISettingsValidationError(`${label}不能为空`)
  if (trimmed.length > MAX_MCP_URL_LENGTH) throw new AISettingsValidationError(`${label}过长`)
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new AISettingsValidationError(`${label}不是有效地址`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AISettingsValidationError(`${label}必须使用 http 或 https`)
  }
  if (url.username || url.password) throw new AISettingsValidationError(`${label}不得包含用户名或密码`)
  if (url.hash) throw new AISettingsValidationError(`${label}不得包含片段`)
  if (!allowSearch && url.search) throw new AISettingsValidationError(`${label}不得包含查询参数`)
  return trimmed
}

function validateSecret(value: unknown, label: string, maximum: number, allowEmpty = true) {
  if (typeof value !== "string") throw new AISettingsValidationError(`${label}必须是字符串`)
  if (!allowEmpty && !value) throw new AISettingsValidationError(`${label}不能为空`)
  if (value.length > maximum) throw new AISettingsValidationError(`${label}过长`)
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new AISettingsValidationError(`${label}不得包含控制字符`)
  return value
}

function validateModel(value: unknown): AIModelId {
  if (typeof value !== "string" || !AIModelIds.includes(value as AIModelId)) {
    throw new AISettingsValidationError("模型标识无效")
  }
  return value as AIModelId
}

function validateTemperature(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2) {
    throw new AISettingsValidationError("温度必须是 0-2 之间的数值")
  }
  return value
}

function validateSkills(value: unknown): AISkill[] {
  if (!Array.isArray(value)) throw new AISettingsValidationError("skills 必须是数组")
  if (value.length > 32) throw new AISettingsValidationError("skills 数量过多")
  const byId = new Map<string, boolean>()
  for (const item of value) {
    if (!isRecord(item)) throw new AISettingsValidationError("skill 必须是对象")
    assertOnlyKeys(item, new Set(["id", "enabled", "name", "desc", "builtin"]), "skill")
    const id = item.id
    if (typeof id !== "string" || !AI_SKILL_IDS.includes(id as (typeof AI_SKILL_IDS)[number])) {
      throw new AISettingsValidationError("技能标识无效")
    }
    if (typeof item.enabled !== "boolean") throw new AISettingsValidationError("skill.enabled 必须是布尔值")
    if (byId.has(id)) throw new AISettingsValidationError(`技能重复：${id}`)
    byId.set(id, item.enabled)
  }
  // 名称与描述由内置定义决定，避免前端伪造能力说明。
  return defaultAIConfig.skills.map((skill) => ({
    ...skill,
    enabled: byId.get(skill.id) ?? skill.enabled,
  }))
}

function validatePlugins(value: unknown): AIPluginBinding[] {
  if (!Array.isArray(value)) throw new AISettingsValidationError("plugins 必须是数组")
  if (value.length > 32) throw new AISettingsValidationError("plugins 数量过多")
  const byId = new Map<string, boolean>()
  for (const item of value) {
    if (!isRecord(item)) throw new AISettingsValidationError("plugin 必须是对象")
    assertOnlyKeys(item, new Set(["id", "enabled", "name", "desc"]), "plugin")
    const id = item.id
    if (typeof id !== "string" || !AI_PLUGIN_IDS.includes(id as (typeof AI_PLUGIN_IDS)[number])) {
      throw new AISettingsValidationError("插件标识无效")
    }
    if (typeof item.enabled !== "boolean") throw new AISettingsValidationError("plugin.enabled 必须是布尔值")
    if (byId.has(id)) throw new AISettingsValidationError(`插件重复：${id}`)
    byId.set(id, item.enabled)
  }
  return defaultAIConfig.plugins.map((plugin) => ({
    ...plugin,
    enabled: byId.get(plugin.id) ?? plugin.enabled,
  }))
}

function validateMcpServers(value: unknown): StoredMCPServer[] {
  if (!Array.isArray(value)) throw new AISettingsValidationError("mcpServers 必须是数组")
  if (value.length > MAX_MCP_SERVERS) throw new AISettingsValidationError(`MCP 服务器不能超过 ${MAX_MCP_SERVERS} 个`)
  const ids = new Set<string>()
  return value.map((item) => {
    if (!isRecord(item)) throw new AISettingsValidationError("MCP 服务器必须是对象")
    assertOnlyKeys(item, new Set(["id", "name", "url", "status", "tools", "token", "hasToken", "lastCheckedAt", "clearToken"]), "MCP 服务器")
    const id = item.id
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) {
      throw new AISettingsValidationError("MCP 服务器标识无效")
    }
    if (ids.has(id)) throw new AISettingsValidationError(`MCP 服务器重复：${id}`)
    ids.add(id)
    const name = typeof item.name === "string" ? item.name.trim() : ""
    if (!name || name.length > 64) throw new AISettingsValidationError("MCP 服务器名称必须为 1-64 个字符")
    const url = validateHttpUrl(item.url, "MCP 地址", true)
    const status = item.status === "connected" || item.status === "error" || item.status === "disabled"
      ? item.status
      : "disabled"
    const tools = typeof item.tools === "number" && Number.isInteger(item.tools) && item.tools >= 0 && item.tools <= 10_000
      ? item.tools
      : 0
    const token = item.token === undefined ? "" : validateSecret(item.token, "MCP Token", MAX_MCP_TOKEN_LENGTH)
    const lastCheckedAt = typeof item.lastCheckedAt === "number" && Number.isFinite(item.lastCheckedAt) && item.lastCheckedAt >= 0
      ? item.lastCheckedAt
      : undefined
    if (item.clearToken !== undefined && typeof item.clearToken !== "boolean") {
      throw new AISettingsValidationError("clearToken 必须是布尔值")
    }
    return { id, name, url, status, tools, token, lastCheckedAt }
  })
}

export function validateStoredSettings(value: unknown): StoredAIConfig {
  if (!isRecord(value)) throw new AISettingsValidationError("AI 设置必须是对象")
  const baseUrl = value.baseUrl === undefined
    ? defaultAIConfig.baseUrl
    : validateHttpUrl(value.baseUrl, "API 地址", false)
  const apiKey = value.apiKey === undefined
    ? ""
    : validateSecret(value.apiKey, "API Key", MAX_API_KEY_LENGTH)
  const model = value.model === undefined ? defaultAIConfig.model : validateModel(value.model)
  const customModel = value.customModel === undefined
    ? ""
    : typeof value.customModel === "string" && value.customModel.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value.customModel)
      ? value.customModel
      : (() => { throw new AISettingsValidationError("自定义模型 ID 无效") })()
  const temperature = value.temperature === undefined ? defaultAIConfig.temperature : validateTemperature(value.temperature)
  const enabled = value.enabled === undefined ? defaultAIConfig.enabled : value.enabled
  const confirmDanger = value.confirmDanger === undefined ? defaultAIConfig.confirmDanger : value.confirmDanger
  if (typeof enabled !== "boolean") throw new AISettingsValidationError("enabled 必须是布尔值")
  if (typeof confirmDanger !== "boolean") throw new AISettingsValidationError("confirmDanger 必须是布尔值")
  const skills = value.skills === undefined ? defaultAIConfig.skills.map((s) => ({ ...s })) : validateSkills(value.skills)
  const mcpServers = value.mcpServers === undefined ? [] : validateMcpServers(value.mcpServers)
  const plugins = value.plugins === undefined ? defaultAIConfig.plugins.map((p) => ({ ...p })) : validatePlugins(value.plugins)
  return {
    enabled,
    baseUrl,
    apiKey,
    model,
    customModel,
    temperature,
    confirmDanger,
    skills,
    mcpServers,
    plugins,
  }
}

export function validateSettingsPatch(value: unknown): AISettingsPatch {
  if (!isRecord(value)) throw new AISettingsValidationError("请求体必须是对象")
  assertOnlyKeys(value, new Set([
    "enabled", "baseUrl", "apiKey", "clearKey", "model", "customModel", "temperature",
    "confirmDanger", "skills", "mcpServers", "plugins",
  ]), "请求体")
  const patch: AISettingsPatch = {}
  if (Object.hasOwn(value, "enabled")) {
    if (typeof value.enabled !== "boolean") throw new AISettingsValidationError("enabled 必须是布尔值")
    patch.enabled = value.enabled
  }
  if (Object.hasOwn(value, "baseUrl")) patch.baseUrl = validateHttpUrl(value.baseUrl, "API 地址", false)
  if (Object.hasOwn(value, "apiKey")) patch.apiKey = validateSecret(value.apiKey, "API Key", MAX_API_KEY_LENGTH)
  if (Object.hasOwn(value, "clearKey")) {
    if (typeof value.clearKey !== "boolean") throw new AISettingsValidationError("clearKey 必须是布尔值")
    patch.clearKey = value.clearKey
  }
  if (Object.hasOwn(value, "model")) patch.model = validateModel(value.model)
  if (Object.hasOwn(value, "customModel")) {
    if (typeof value.customModel !== "string" || value.customModel.length > 128 || /[\u0000-\u001f\u007f]/.test(value.customModel)) {
      throw new AISettingsValidationError("自定义模型 ID 无效")
    }
    patch.customModel = value.customModel
  }
  if (Object.hasOwn(value, "temperature")) patch.temperature = validateTemperature(value.temperature)
  if (Object.hasOwn(value, "confirmDanger")) {
    if (typeof value.confirmDanger !== "boolean") throw new AISettingsValidationError("confirmDanger 必须是布尔值")
    patch.confirmDanger = value.confirmDanger
  }
  if (Object.hasOwn(value, "skills")) patch.skills = validateSkills(value.skills)
  if (Object.hasOwn(value, "mcpServers")) {
    const servers = validateMcpServers(value.mcpServers)
    patch.mcpServers = servers.map((server, index) => {
      const raw = (value.mcpServers as unknown[])[index]
      const clearToken = isRecord(raw) && raw.clearToken === true
      return { ...server, clearToken }
    })
  }
  if (Object.hasOwn(value, "plugins")) patch.plugins = validatePlugins(value.plugins)
  return patch
}

export function defaultStoredSettings(): StoredAIConfig {
  const defaults = defaultAIConfig
  return {
    enabled: defaults.enabled,
    baseUrl: defaults.baseUrl,
    apiKey: "",
    model: defaults.model,
    customModel: defaults.customModel,
    temperature: defaults.temperature,
    confirmDanger: defaults.confirmDanger,
    skills: defaults.skills.map((s) => ({ ...s })),
    mcpServers: [],
    plugins: defaults.plugins.map((p) => ({ ...p })),
  }
}

export function mergeSettings(current: StoredAIConfig, patch: AISettingsPatch): StoredAIConfig {
  const next: StoredAIConfig = {
    ...current,
    ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
    ...(patch.baseUrl === undefined ? {} : { baseUrl: patch.baseUrl }),
    ...(patch.model === undefined ? {} : { model: patch.model }),
    ...(patch.customModel === undefined ? {} : { customModel: patch.customModel }),
    ...(patch.temperature === undefined ? {} : { temperature: patch.temperature }),
    ...(patch.confirmDanger === undefined ? {} : { confirmDanger: patch.confirmDanger }),
    ...(patch.skills === undefined ? {} : { skills: patch.skills }),
    ...(patch.plugins === undefined ? {} : { plugins: patch.plugins }),
    apiKey: patch.clearKey ? "" : patch.apiKey ? patch.apiKey : current.apiKey,
  }
  if (patch.mcpServers !== undefined) {
    const currentById = new Map(current.mcpServers.map((server) => [server.id, server]))
    next.mcpServers = patch.mcpServers.map((server) => {
      const previous = currentById.get(server.id)
      const token = server.clearToken ? "" : server.token ? server.token : previous?.token ?? ""
      return {
        id: server.id,
        name: server.name,
        url: server.url,
        status: server.status,
        tools: server.tools,
        token,
        lastCheckedAt: server.lastCheckedAt ?? previous?.lastCheckedAt,
      }
    })
  }
  return next
}

export function redactSettings(config: StoredAIConfig): AIConfig {
  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    apiKey: "",
    hasApiKey: Boolean(config.apiKey),
    model: config.model,
    customModel: config.customModel,
    temperature: config.temperature,
    confirmDanger: config.confirmDanger,
    skills: config.skills.map((skill) => ({ ...skill })),
    mcpServers: config.mcpServers.map((server) => ({
      id: server.id,
      name: server.name,
      url: server.url,
      status: server.status,
      tools: server.tools,
      hasToken: Boolean(server.token),
      lastCheckedAt: server.lastCheckedAt,
    })),
    plugins: config.plugins.map((plugin) => ({ ...plugin })),
  }
}

export function runtimeModelIds(config: Pick<StoredAIConfig, "model" | "customModel">): string[] {
  const ids: string[] = AIModelIds.filter((id) => id !== "custom")
  const custom = config.customModel.trim()
  if (custom) ids.push(custom)
  const current: string = config.model === "custom" ? custom : config.model
  if (current && !ids.includes(current)) ids.unshift(current)
  return [...new Set(ids)]
}

function enabledIds(items: { id: string; enabled: boolean }[]) {
  return items.filter((item) => item.enabled).map((item) => item.id).sort()
}

export function settingsRequireRuntimeRestart(a: StoredAIConfig, b: StoredAIConfig): boolean {
  if (a.baseUrl !== b.baseUrl) return true
  if (a.model !== b.model || a.customModel !== b.customModel) return true
  if (JSON.stringify(enabledIds(a.skills)) !== JSON.stringify(enabledIds(b.skills))) return true
  if (JSON.stringify(enabledIds(a.plugins)) !== JSON.stringify(enabledIds(b.plugins))) return true
  const servers = (value: StoredAIConfig) => value.mcpServers
    .map((server) => `${server.id}\u0000${server.url}\u0000${server.status}\u0000${server.token}`)
    .sort()
  return JSON.stringify(servers(a)) !== JSON.stringify(servers(b))
}
