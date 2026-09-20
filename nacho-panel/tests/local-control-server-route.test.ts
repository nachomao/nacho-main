import assert from "node:assert/strict"
import { test } from "node:test"
import { NextRequest } from "next/server"
import { DELETE, GET, PATCH, POST } from "../app/api/local-control-server/route"

function mutationRequest(method: "POST" | "PATCH" | "DELETE", body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://panel.local/api/local-control-server", {
    method,
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "http://panel.local",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
  })
}

test("status endpoint rejects cross-site reads before returning local credentials", async () => {
  const response = await GET(new NextRequest("http://panel.local/api/local-control-server", {
    headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  }))

  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { ok: false, message: "仅允许面板同源请求" })
})

test("mutation endpoints require JSON requests", async () => {
  const response = await POST(mutationRequest("POST", { action: "start" }, { "content-type": "text/plain" }))
  assert.equal(response.status, 415)
})

test("actions reject unknown fields before invoking Windows management", async () => {
  const response = await POST(mutationRequest("POST", { action: "start", injected: true }))
  assert.equal(response.status, 400)
  assert.match((await response.json()).message, /不支持的字段/)
})

test("install rejects coerced option types", async () => {
  const response = await POST(mutationRequest("POST", {
    action: "install",
    accessMode: "loopback",
    autoStart: "true",
    port: "8443",
  }))
  assert.equal(response.status, 400)
  assert.match((await response.json()).message, /autoStart/)
})

test("install can stream command output as NDJSON", async () => {
  const response = await POST(mutationRequest("POST", {
    action: "install",
    accessMode: "loopback",
    autoStart: true,
    port: 8443,
  }, { accept: "application/x-ndjson" }))

  assert.equal(response.status, 200)
  assert.match(response.headers.get("content-type") || "", /application\/x-ndjson/)
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; message?: string })
  assert.equal(events.at(-1)?.type, "error")
  assert.match(events.at(-1)?.message || "", /Windows/)
})

test("settings reject non-boolean auto-start values", async () => {
  const response = await PATCH(mutationRequest("PATCH", { autoStart: "false" }))
  assert.equal(response.status, 400)
  assert.match((await response.json()).message, /布尔值/)
})

test("settings reject non-numeric port values", async () => {
  const response = await PATCH(mutationRequest("PATCH", { port: "8444" }))
  assert.equal(response.status, 400)
  assert.match((await response.json()).message, /端口必须是数字/)
})

test("uninstall rejects extra fields and non-string confirmations", async () => {
  const extraField = await DELETE(mutationRequest("DELETE", { confirmation: "x", deleteSource: true }))
  assert.equal(extraField.status, 400)

  const invalidConfirmation = await DELETE(mutationRequest("DELETE", { confirmation: 123 }))
  assert.equal(invalidConfirmation.status, 400)
})
