import assert from "node:assert/strict"
import test from "node:test"
import { buildOpencodeConfig } from "../lib/ai/opencode-config"
import { defaultStoredSettings } from "../lib/ai/settings-schema"

test("opencode config contains no secrets and points at panel proxies", () => {
  const settings = {
    ...defaultStoredSettings(),
    model: "custom" as const,
    customModel: "my-model",
    mcpServers: [{
      id: "m1",
      name: "Test MCP",
      url: "https://mcp.example.com/mcp",
      status: "connected" as const,
      tools: 2,
      token: "mcp-secret-token",
    }],
  }
  const built = buildOpencodeConfig(settings, {
    panelBaseUrl: "http://127.0.0.1:3100",
    brokerToken: "broker-token",
  })
  assert.equal(built.model, "my-model")
  assert.equal(built.config.model, "nacho/my-model")
  const provider = built.config.provider as Record<string, Record<string, unknown>>
  const nacho = provider.nacho as Record<string, unknown>
  assert.equal((nacho.options as Record<string, unknown>).baseURL, "http://127.0.0.1:3100/api/ai/provider/v1")
  assert.equal((nacho.options as Record<string, unknown>).apiKey, "{env:NACHO_PROXY_TOKEN}")
  assert.equal(Boolean((nacho.models as Record<string, unknown>)["my-model"]), true)
  assert.equal(Boolean((nacho.models as Record<string, unknown>)["gpt-5.2"]), true)
  const customModel = (nacho.models as Record<string, Record<string, unknown>>)["my-model"]
  assert.equal(customModel.tool_call, true)
  assert.equal(customModel.attachment, true)
  assert.equal(customModel.reasoning, true)
  assert.equal(customModel.interleaved, "reasoning_content")
  assert.deepEqual(customModel.modalities, { input: ["text", "image"], output: ["text"] })
  const mcp = built.config.mcp as Record<string, Record<string, unknown>>
  assert.equal(mcp.nacho.url, "http://127.0.0.1:3100/api/ai/mcp")
  assert.equal((mcp.nacho.headers as Record<string, string>).Authorization, "Bearer {env:NACHO_BROKER_TOKEN}")
  assert.equal((mcp.m1.headers as Record<string, string>).Authorization, "Bearer {env:NACHO_MCP_0_TOKEN}")
  assert.equal(built.mcpEnv.NACHO_MCP_0_TOKEN, "mcp-secret-token")
  const serialized = JSON.stringify(built.config)
  assert.equal(serialized.includes("mcp-secret-token"), false)
  assert.equal(serialized.includes("broker-token"), false)
  assert.equal(built.config.permission, "ask")
  assert.equal(built.config.share, "disabled")
  assert.equal(built.config.lsp, false)
  assert.equal(built.config.snapshot, false)
  const agent = built.config.agent as Record<string, Record<string, unknown>>
  assert.equal(agent.nacho.mode, "primary")
  assert.equal(typeof agent.nacho.prompt, "string")
  assert.equal(String(agent.nacho.prompt).includes("Nacho AI"), true)
  assert.equal(String(agent.nacho.prompt).includes("You are opencode"), false)
})

test("disabled MCP servers are not included", () => {
  const settings = {
    ...defaultStoredSettings(),
    mcpServers: [{
      id: "m1",
      name: "Disabled",
      url: "https://mcp.example.com/mcp",
      status: "disabled" as const,
      tools: 0,
      token: "",
    }],
  }
  const built = buildOpencodeConfig(settings, { panelBaseUrl: "http://127.0.0.1:3100", brokerToken: "b" })
  const mcp = built.config.mcp as Record<string, unknown>
  assert.equal("m1" in mcp, false)
  assert.equal(Object.keys(built.mcpEnv).length, 0)
})
