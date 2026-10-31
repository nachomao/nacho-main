import assert from "node:assert/strict"
import http from "node:http"
import type { AddressInfo } from "node:net"
import test from "node:test"
import { listMcpTools, probeMcpServer } from "../lib/ai/mcp-probe"

const TOKEN = "good-token"

function startMcpServer() {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405)
      res.end()
      return
    }
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
      const id = body.id
      if (body.method === "initialize") {
        if (req.headers.authorization !== `Bearer ${TOKEN}`) {
          res.writeHead(401, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32001, message: "unauthorized" } }))
          return
        }
        res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "session-1" })
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "test", version: "1" } },
        }))
        return
      }
      if (body.method === "notifications/initialized") {
        res.writeHead(202)
        res.end()
        return
      }
      if (body.method === "tools/list") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            tools: [
              { name: "echo", description: "Echo", inputSchema: { type: "object" } },
              { name: "ping", description: "Ping", inputSchema: { type: "object" } },
            ],
          },
        }))
        return
      }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result: {} }))
    })
  })
  return new Promise<{ server: http.Server; url: string }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, url: `http://127.0.0.1:${port}/mcp` })
    })
  })
}

test("MCP probe connects, initializes and lists tools", async (t) => {
  const { server, url } = await startMcpServer()
  t.after(() => server.close())
  const tools = await listMcpTools({ url, token: TOKEN })
  assert.deepEqual(tools.map((tool) => tool.name), ["echo", "ping"])
  const result = await probeMcpServer({ id: "m1", url, token: TOKEN })
  assert.equal(result.ok, true)
  assert.equal(result.tools, 2)
})

test("MCP probe rejects a bad token and invalid URL", async (t) => {
  const { server, url } = await startMcpServer()
  t.after(() => server.close())
  const badToken = await probeMcpServer({ id: "m1", url, token: "wrong-token" })
  assert.equal(badToken.ok, false)
  assert.equal(badToken.error?.code, "mcp-unreachable")
  const badUrl = await probeMcpServer({ id: "m2", url: "file:///tmp/mcp" })
  assert.equal(badUrl.ok, false)
})
