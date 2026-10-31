import { resolveAIModel } from "./config-shared"
import { redactSecrets, sanitizeErrorMessage } from "./redact"
import type { StoredAIConfig } from "./settings-schema"

export type ProviderTestResult = {
  ok: boolean
  latencyMs: number
  models?: number
  model?: string
  error?: { code: string; message: string }
}

const TEST_TIMEOUT_MS = 15_000

function baseUrl(config: StoredAIConfig) {
  return config.baseUrl.replace(/\/+$/, "")
}

async function parseError(response: Response, secret: string) {
  let detail = ""
  try {
    const text = await response.text()
    if (text) {
      try {
        const body = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
        detail = typeof body.error === "string"
          ? body.error
          : body.error?.message || body.message || text
      } catch {
        detail = text
      }
    }
  } catch {
    // ignore body read failures
  }
  const message = redactSecrets(detail, [secret]).trim().slice(0, 300)
  const code = response.status === 401 || response.status === 403
    ? "auth"
    : response.status === 404
      ? "not-found"
      : `http-${response.status}`
  return { code, message: message || `HTTP ${response.status}` }
}

async function probeChat(config: StoredAIConfig, key: string) {
  const model = resolveAIModel(config)
  const response = await fetch(`${baseUrl(config)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 8,
      stream: false,
    }),
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
  })
  if (!response.ok) return { ok: false as const, error: await parseError(response, key) }
  const body = await response.json().catch(() => null) as { choices?: unknown[] } | null
  if (!body || !Array.isArray(body.choices)) {
    return { ok: false as const, error: { code: "provider", message: "上游未返回 chat completions 结构" } }
  }
  return { ok: true as const, model }
}

export async function testProvider(config: StoredAIConfig): Promise<ProviderTestResult> {
  const started = Date.now()
  if (!config.apiKey) {
    return { ok: false, latencyMs: 0, error: { code: "missing-key", message: "尚未保存 API Key" } }
  }
  if (!resolveAIModel(config)) {
    return { ok: false, latencyMs: 0, error: { code: "missing-model", message: "尚未选择模型" } }
  }
  try {
    const modelsResponse = await fetch(`${baseUrl(config)}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    })
    if (modelsResponse.ok) {
      const body = await modelsResponse.json().catch(() => null) as { data?: unknown[] } | null
      return {
        ok: true,
        latencyMs: Date.now() - started,
        models: Array.isArray(body?.data) ? body.data.length : undefined,
        model: resolveAIModel(config),
      }
    }
    if (modelsResponse.status === 401 || modelsResponse.status === 403) {
      return { ok: false, latencyMs: Date.now() - started, error: await parseError(modelsResponse, config.apiKey) }
    }
    const fallback = await probeChat(config, config.apiKey)
    return fallback.ok
      ? { ok: true, latencyMs: Date.now() - started, model: fallback.model }
      : { ok: false, latencyMs: Date.now() - started, error: fallback.error }
  } catch (error) {
    const message = sanitizeErrorMessage(error, [config.apiKey])
    const code = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network"
    return { ok: false, latencyMs: Date.now() - started, error: { code, message } }
  }
}
