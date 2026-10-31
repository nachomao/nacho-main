import assert from "node:assert/strict"
import http from "node:http"
import type { AddressInfo } from "node:net"
import test from "node:test"
import { finalizeToolText, executeNachoTool } from "../lib/ai/broker"
import { resolveBrokerApproval } from "../lib/ai/approvals"
import { subscribeApprovals } from "../lib/ai/approval-bus"
import { defaultStoredSettings } from "../lib/ai/settings-schema"
import type { ChatSession } from "../lib/ai/chat-sessions"

const KEY = "test-panel-key"

type Recorded = { type: string; payload: Record<string, unknown> }

function startControl() {
  const commands: Recorded[] = []
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${KEY}`) {
      res.writeHead(401, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, message: "bad key" }))
      return
    }
    const url = new URL(req.url || "/", "http://127.0.0.1")
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" })
        res.end(JSON.stringify(body))
      }
      if (req.method === "GET" && url.pathname === "/api/panel/clients") {
        send(200, {
          ok: true,
          data: [
            { id: "c1", name: "在线客户端", os: "windows", status: "online", group: "default" },
            { id: "c2", name: "离线客户端", os: "windows", status: "offline", group: "default" },
          ],
        })
        return
      }
      if (req.method === "GET" && url.pathname === "/api/panel/clients/c1") {
        send(200, { ok: true, data: { id: "c1", name: "在线客户端", os: "windows", status: "online" } })
        return
      }
      if (req.method === "GET" && url.pathname === "/api/panel/clients/c2") {
        send(200, { ok: true, data: { id: "c2", name: "离线客户端", os: "windows", status: "offline" } })
        return
      }
      if (req.method === "POST" && url.pathname === "/api/panel/clients/c1/commands") {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Recorded
        commands.push(body)
        const command = {
          id: `cmd-${commands.length}`,
          clientId: "c1",
          type: body.type,
          payload: body.payload,
          status: "success",
          result: "command-ok",
          exitCode: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        send(201, { ok: true, data: command })
        return
      }
      if (req.method === "GET" && url.pathname === "/api/panel/commands") {
        const last = commands.length
        send(200, {
          ok: true,
          data: last > 0 ? [{
            id: `cmd-${last}`,
            clientId: "c1",
            type: commands[last - 1].type,
            payload: commands[last - 1].payload,
            status: "success",
            result: "command-ok",
            exitCode: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }] : [],
        })
        return
      }
      send(404, { ok: false, message: "not found" })
    })
  })
  return new Promise<{ server: http.Server; baseUrl: string; commands: Recorded[] }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, commands })
    })
  })
}

function sessionFor(baseUrl: string, uiSessionId: string): ChatSession {
  return {
    uiSessionId,
    opencodeSessionId: "ses_test",
    connection: { baseUrl, key: KEY },
    model: "fake-model",
    mode: "agent",
    confirmDanger: true,
    permissionKey: "ask",
    createdAt: Date.now(),
    lastUsed: Date.now(),
  }
}

test("read tool calls control server directly", async (t) => {
  const { server, baseUrl } = await startControl()
  t.after(() => server.close())
  const settings = defaultStoredSettings()
  const chat = sessionFor(baseUrl, `u-read-${Date.now()}`)
  const result = await executeNachoTool({ toolName: "list_clients", args: {}, chat, settings })
  assert.equal(result.ok, true)
  assert.match(result.text, /c1/)
  assert.match(result.text, /在线客户端/)
})

test("danger tool executes after broker approval", async (t) => {
  const { server, baseUrl, commands } = await startControl()
  t.after(() => server.close())
  const settings = defaultStoredSettings()
  const chat = sessionFor(baseUrl, `u-approve-${Date.now()}`)
  const events: string[] = []
  const unsubscribe = subscribeApprovals(chat.uiSessionId, (event) => {
    events.push(event.type)
    if (event.type === "approval") {
      assert.match(event.detail, /echo broker-hello/)
      void resolveBrokerApproval(chat.uiSessionId, event.approvalId, "once")
    }
  })
  t.after(unsubscribe)
  const result = await executeNachoTool({
    toolName: "run_shell",
    args: { clientId: "c1", script: "echo broker-hello", timeoutSeconds: 30 },
    chat,
    settings,
  })
  assert.equal(result.ok, true)
  assert.match(result.text, /command-ok/)
  assert.deepEqual(events, ["approval", "approval-resolved"])
  assert.equal(commands.length, 1)
  assert.equal(commands[0].type, "run-shell")
})

test("rejected danger tool does not dispatch a command", async (t) => {
  const { server, baseUrl, commands } = await startControl()
  t.after(() => server.close())
  const settings = defaultStoredSettings()
  const chat = sessionFor(baseUrl, `u-reject-${Date.now()}`)
  const unsubscribe = subscribeApprovals(chat.uiSessionId, (event) => {
    if (event.type === "approval") void resolveBrokerApproval(chat.uiSessionId, event.approvalId, "reject")
  })
  t.after(unsubscribe)
  const result = await executeNachoTool({
    toolName: "run_shell",
    args: { clientId: "c1", script: "echo broker-hello" },
    chat,
    settings,
  })
  assert.equal(result.ok, false)
  assert.match(result.text, /拒绝/)
  assert.equal(commands.length, 0)
})

test("offline client and disabled plugin are rejected before execution", async (t) => {
  const { server, baseUrl } = await startControl()
  t.after(() => server.close())
  const settings = defaultStoredSettings()
  const chat = sessionFor(baseUrl, `u-guard-${Date.now()}`)
  const offline = await executeNachoTool({
    toolName: "list_services",
    args: { clientId: "c2" },
    chat,
    settings,
  })
  assert.equal(offline.ok, false)
  assert.match(offline.text, /不在线/)

  const noDocker = {
    ...settings,
    plugins: settings.plugins.map((plugin) => ({ ...plugin, enabled: false })),
  }
  const plugin = await executeNachoTool({
    toolName: "docker",
    args: { clientId: "c1", action: "ps" },
    chat,
    settings: noDocker,
  })
  assert.equal(plugin.ok, false)
  assert.match(plugin.text, /插件/)
})

test("timer tools are handled locally without a control-server call", async () => {
  const settings = defaultStoredSettings()
  const chat = sessionFor("http://127.0.0.1:1", `u-timer-${Date.now()}`)
  const set = await executeNachoTool({
    toolName: "set_timer",
    args: { afterSeconds: 1800, reminder: "检查构建日志" },
    chat,
    settings,
  })
  assert.equal(set.ok, true)
  assert.match(set.text, /1800/)
  assert.match(set.text, /检查构建日志/)
  const cancel = await executeNachoTool({
    toolName: "cancel_timer",
    args: { reason: "完成" },
    chat,
    settings,
  })
  assert.equal(cancel.ok, true)
  assert.match(cancel.text, /取消/)
})

test("finalizeToolText redacts the panel key and truncates", () => {
  const output = `key=${KEY} sk-abcdefghijklmnop ${"x".repeat(40_000)}`
  const result = finalizeToolText(output, KEY)
  assert.equal(result.text.includes(KEY), false)
  assert.equal(result.text.includes("sk-abcdefghijklmnop"), false)
  assert.equal(result.truncated, true)
  assert.ok(Buffer.byteLength(result.text, "utf8") < 20_000)
})
