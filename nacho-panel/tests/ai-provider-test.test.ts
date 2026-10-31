import assert from "node:assert/strict"
import http from "node:http"
import type { AddressInfo } from "node:net"
import test from "node:test"
import { defaultStoredSettings } from "../lib/ai/settings-schema"
import { testProvider } from "../lib/ai/provider-test"

function startProvider(handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void) {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    req.on("end", () => handler(req, res, Buffer.concat(chunks).toString("utf8")))
  })
  return new Promise<{ server: http.Server; baseUrl: string }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/v1` })
    })
  })
}

function configFor(baseUrl: string, apiKey: string) {
  return {
    ...defaultStoredSettings(),
    baseUrl,
    apiKey,
    model: "custom" as const,
    customModel: "fake-model",
  }
}

test("provider test succeeds through /models", async (t) => {
  const { server, baseUrl } = await startProvider((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }))
      return
    }
    res.writeHead(404)
    res.end()
  })
  t.after(() => server.close())
  const result = await testProvider(configFor(baseUrl, "sk-test-1234567890"))
  assert.equal(result.ok, true)
  assert.equal(result.models, 2)
})

test("provider test falls back to chat completions when /models is unavailable", async (t) => {
  const { server, baseUrl } = await startProvider((req, res, body) => {
    if (req.url === "/v1/models") {
      res.writeHead(404)
      res.end()
      return
    }
    assert.match(body, /fake-model/)
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "pong" } }] }))
  })
  t.after(() => server.close())
  const result = await testProvider(configFor(baseUrl, "sk-test-1234567890"))
  assert.equal(result.ok, true)
  assert.equal(result.model, "fake-model")
})

test("provider test reports auth errors without leaking the key", async (t) => {
  const { server, baseUrl } = await startProvider((_req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: { message: "bad key sk-test-1234567890" } }))
  })
  t.after(() => server.close())
  const result = await testProvider(configFor(baseUrl, "sk-test-1234567890"))
  assert.equal(result.ok, false)
  assert.equal(result.error?.code, "auth")
  assert.equal(result.error?.message.includes("sk-test-1234567890"), false)
})

test("provider test requires a saved key", async () => {
  const result = await testProvider(configFor("https://api.example.com/v1", ""))
  assert.equal(result.ok, false)
  assert.equal(result.error?.code, "missing-key")
})
