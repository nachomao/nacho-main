import assert from "node:assert/strict"
import test from "node:test"
import {
  defaultStoredSettings,
  mergeSettings,
  redactSettings,
  runtimeModelIds,
  settingsRequireRuntimeRestart,
  validateSettingsPatch,
  validateStoredSettings,
} from "../lib/ai/settings-schema"
import { defaultAIConfig } from "../lib/ai/config-shared"

const baseServer = {
  id: "m-fs",
  name: "文件系统",
  url: "https://mcp.example.com/mcp",
  status: "connected" as const,
  tools: 6,
}

test("validateSettingsPatch accepts a full settings payload and normalizes skills/plugins", () => {
  const patch = validateSettingsPatch({
    enabled: false,
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test-1234567890",
    model: "custom",
    customModel: "my-model",
    temperature: 0.5,
    confirmDanger: false,
    skills: defaultAIConfig.skills.map((skill) => ({ id: skill.id, enabled: skill.id === "s-ops" })),
    mcpServers: [baseServer],
    plugins: defaultAIConfig.plugins.map((plugin) => ({ id: plugin.id, enabled: plugin.id === "p-docker" })),
  })
  assert.equal(patch.enabled, false)
  assert.equal(patch.apiKey, "sk-test-1234567890")
  assert.equal(patch.skills?.find((skill) => skill.id === "s-ops")?.enabled, true)
  assert.equal(patch.skills?.find((skill) => skill.id === "s-diag")?.enabled, false)
  assert.equal(patch.plugins?.find((plugin) => plugin.id === "p-docker")?.enabled, true)
  assert.equal(patch.mcpServers?.[0].tools, 6)
})

test("validateSettingsPatch rejects unknown keys, bad urls, duplicates and invalid models", () => {
  assert.throws(() => validateSettingsPatch({ unknown: true }), /未知字段/)
  assert.throws(() => validateSettingsPatch({ baseUrl: "ftp://example.com" }), /http/)
  assert.throws(() => validateSettingsPatch({ baseUrl: "https://user:pass@example.com/v1" }), /用户名/)
  assert.throws(() => validateSettingsPatch({ baseUrl: "https://example.com/v1?x=1" }), /查询/)
  assert.throws(() => validateSettingsPatch({ model: "not-a-model" }), /模型/)
  assert.throws(() => validateSettingsPatch({
    mcpServers: [baseServer, { ...baseServer }],
  }), /重复/)
  assert.throws(() => validateSettingsPatch({
    mcpServers: [{ ...baseServer, url: "file:///tmp/x" }],
  }), /http/)
})

test("mergeSettings preserves secrets when the patch omits them and clears them explicitly", () => {
  const initial = {
    ...defaultStoredSettings(),
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-existing-1234567890",
    mcpServers: [{ ...baseServer, token: "mcp-token" }],
  }
  const kept = mergeSettings(initial, validateSettingsPatch({
    temperature: 0.8,
    mcpServers: [{ ...baseServer, token: "" }],
  }))
  assert.equal(kept.apiKey, "sk-existing-1234567890")
  assert.equal(kept.temperature, 0.8)
  assert.equal(kept.mcpServers[0].token, "mcp-token")

  const replaced = mergeSettings(kept, validateSettingsPatch({
    apiKey: "sk-new-1234567890",
    mcpServers: [{ ...baseServer, token: "new-mcp-token" }],
  }))
  assert.equal(replaced.apiKey, "sk-new-1234567890")
  assert.equal(replaced.mcpServers[0].token, "new-mcp-token")

  const cleared = mergeSettings(replaced, validateSettingsPatch({
    clearKey: true,
    mcpServers: [{ ...baseServer, clearToken: true }],
  }))
  assert.equal(cleared.apiKey, "")
  assert.equal(cleared.mcpServers[0].token, "")
})

test("redactSettings never returns saved secrets", () => {
  const stored = {
    ...defaultStoredSettings(),
    apiKey: "sk-secret-1234567890",
    mcpServers: [{ ...baseServer, token: "mcp-secret" }],
  }
  const redacted = redactSettings(stored)
  assert.equal(redacted.apiKey, "")
  assert.equal(redacted.hasApiKey, true)
  assert.equal("token" in redacted.mcpServers[0], false)
  assert.equal(redacted.mcpServers[0].hasToken, true)
  assert.equal(JSON.stringify(redacted).includes("sk-secret"), false)
  assert.equal(JSON.stringify(redacted).includes("mcp-secret"), false)
})

test("settingsRequireRuntimeRestart only reacts to runtime-relevant changes", () => {
  const base = defaultStoredSettings()
  assert.equal(settingsRequireRuntimeRestart(base, { ...base, temperature: 1.2 }), false)
  assert.equal(settingsRequireRuntimeRestart(base, { ...base, confirmDanger: false }), false)
  assert.equal(settingsRequireRuntimeRestart(base, { ...base, baseUrl: "https://api.example.com/v1" }), true)
  assert.equal(settingsRequireRuntimeRestart(base, { ...base, mcpServers: [{ ...baseServer, token: "" }] }), true)
  assert.equal(settingsRequireRuntimeRestart(base, {
    ...base,
    skills: base.skills.map((skill) => ({ ...skill, enabled: false })),
  }), true)
})

test("runtimeModelIds includes presets, custom and the active model", () => {
  const base = defaultStoredSettings()
  const custom = runtimeModelIds({ ...base, model: "custom", customModel: "my-model" })
  assert.equal(custom.includes("my-model"), true)
  assert.equal(custom.includes("gpt-5.2"), true)
  assert.equal(runtimeModelIds({ ...base, model: "gpt-5.2", customModel: "my-model" }).includes("my-model"), true)
})

test("validateStoredSettings fills defaults and rejects malformed stored data", () => {
  const stored = validateStoredSettings({ apiKey: "sk-1234567890" })
  assert.equal(stored.model, "gpt-5.2")
  assert.equal(stored.mcpServers.length, 0)
  assert.throws(() => validateStoredSettings({ baseUrl: "not-a-url" }), /地址/)
  assert.throws(() => validateStoredSettings({ mcpServers: [{ ...baseServer, token: "x".repeat(9000) }] }), /Token/)
})
