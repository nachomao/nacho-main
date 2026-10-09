import assert from "node:assert/strict"
import { test } from "node:test"
import { serverChannelWarning, switchProductUpdateChannel } from "../lib/product-update-channel"

test("控制服务未配置更新地址时，面板仍能切换 Beta 且不回滚", async () => {
  const calls: string[] = []
  const result = await switchProductUpdateChannel("beta", {
    async switchPanel(channel) { calls.push(`panel:${channel}`); return { channel, version: "0.2.2" } },
    async switchServer(channel) { calls.push(`server:${channel}`); throw new Error("请先配置独立更新服务器的 NACHO_UPDATE_ORIGIN") },
  })
  assert.deepEqual(calls, ["panel:beta", "server:beta"])
  assert.equal(result.panel.channel, "beta")
  assert.ok(result.serverError?.includes("NACHO_UPDATE_ORIGIN"))
  assert.match(serverChannelWarning("beta", result.serverError!), /面板已切换到 Beta.*可以检查和安装面板更新.*控制服务尚未配置更新地址/)
})

test("面板频道校验失败时，不改动服务端频道", async () => {
  let serverCalls = 0
  await assert.rejects(switchProductUpdateChannel("beta", {
    async switchPanel() { throw new Error("发布索引签名无效") },
    async switchServer() { serverCalls++ },
  }), /签名无效/)
  assert.equal(serverCalls, 0)
})

test("未连接服务端时可独立切换，成功同步时返回面板检查结果", async () => {
  const panel = { channel: "alpha" as const, currentVersion: "0.2.2" }
  assert.deepEqual(await switchProductUpdateChannel("alpha", {
    async switchPanel() { return panel },
  }), { panel, serverError: null })
  assert.deepEqual(await switchProductUpdateChannel("alpha", {
    async switchPanel() { return panel },
    async switchServer(channel) { assert.equal(channel, "alpha") },
  }), { panel, serverError: null })
})
