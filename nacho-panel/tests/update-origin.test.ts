import assert from "node:assert/strict"
import test from "node:test"
import {
  DEFAULT_UPDATE_ORIGIN, isValidUpdateOrigin, normalizeUpdateOriginInput, saveUpdateOrigin,
} from "../lib/update-origin"

test("更新源输入规范化与校验", () => {
  assert.equal(normalizeUpdateOriginInput("  https://maojiu.cc/// "), DEFAULT_UPDATE_ORIGIN)
  assert.equal(isValidUpdateOrigin("https://maojiu.cc"), true)
  assert.equal(isValidUpdateOrigin("https://maojiu.cc:8443/"), true)
  assert.equal(isValidUpdateOrigin("http://maojiu.cc"), false)
  assert.equal(isValidUpdateOrigin("https://maojiu.cc/updates"), false)
  assert.equal(isValidUpdateOrigin("https://updates.example.invalid"), false)
  assert.equal(isValidUpdateOrigin(""), false)
})

test("保存时同时写入面板本地与服务端，并验证发布索引", async () => {
  const events: string[] = []
  const result = await saveUpdateOrigin({
    origin: "https://panel.example.test/",
    previousLocalOrigin: "https://previous.example.test",
    runtime: { capabilities: { updateSourceManagement: true } },
    setLocal: async (origin) => { events.push(`local:${origin}`) },
    saveServer: async (origin) => { events.push(`server:${origin}`) },
    verify: async () => { events.push("verify") },
  })
  assert.deepEqual(events, [
    "local:https://panel.example.test",
    "server:https://panel.example.test",
    "verify",
  ])
  assert.equal(result.origin, "https://panel.example.test")
  assert.equal(result.serverSynced, true)
  assert.equal(result.verified, true)
  assert.equal(result.warning, undefined)
})

test("服务端不支持面板管理时只保存本地并明确提示升级", async () => {
  const events: string[] = []
  const result = await saveUpdateOrigin({
    origin: "https://panel.example.test",
    previousLocalOrigin: "https://previous.example.test",
    runtime: { capabilities: {} },
    setLocal: async (origin) => { events.push(`local:${origin}`) },
    saveServer: async (origin) => { events.push(`server:${origin}`) },
    verify: async () => { events.push("verify") },
  })
  assert.deepEqual(events, ["local:https://panel.example.test"])
  assert.equal(result.serverSynced, false)
  assert.equal(result.verified, false)
  assert.match(result.warning ?? "", /1\.2\.1/)
})

test("未连接控制服务时只保存本地并提示连接后同步", async () => {
  const events: string[] = []
  const result = await saveUpdateOrigin({
    origin: "https://panel.example.test",
    previousLocalOrigin: "https://previous.example.test",
    runtime: null,
    setLocal: async (origin) => { events.push(`local:${origin}`) },
    saveServer: async (origin) => { events.push(`server:${origin}`) },
    verify: async () => { events.push("verify") },
  })
  assert.deepEqual(events, ["local:https://panel.example.test"])
  assert.equal(result.serverSynced, false)
  assert.match(result.warning ?? "", /未连接控制服务/)
})

test("服务端写入失败时恢复面板本地且不执行验证", async () => {
  const events: string[] = []
  await assert.rejects(saveUpdateOrigin({
    origin: "https://panel.example.test",
    previousLocalOrigin: "https://previous.example.test",
    runtime: { capabilities: { updateSourceManagement: true } },
    setLocal: async (origin) => { events.push(`local:${origin}`) },
    saveServer: async () => { throw new Error("服务端拒绝保存") },
    verify: async () => { events.push("verify") },
  }), /服务端拒绝保存；已恢复面板本地更新源/)
  assert.deepEqual(events, [
    "local:https://panel.example.test",
    "local:https://previous.example.test",
  ])
})

test("服务端写入失败且回滚失败时给出明确提示", async () => {
  let calls = 0
  await assert.rejects(saveUpdateOrigin({
    origin: "https://panel.example.test",
    previousLocalOrigin: "https://previous.example.test",
    runtime: { capabilities: { updateSourceManagement: true } },
    setLocal: async () => { calls += 1; if (calls === 2) throw new Error("磁盘不可写") },
    saveServer: async () => { throw new Error("服务端拒绝保存") },
    verify: async () => {},
  }), /恢复失败，请手动改回 https:\/\/previous\.example\.test/)
})

test("服务端已保存但索引验证失败时保留新值并返回警告", async () => {
  const events: string[] = []
  const result = await saveUpdateOrigin({
    origin: "https://panel.example.test",
    previousLocalOrigin: "https://previous.example.test",
    runtime: { capabilities: { updateSourceManagement: true } },
    setLocal: async (origin) => { events.push(`local:${origin}`) },
    saveServer: async (origin) => { events.push(`server:${origin}`) },
    verify: async () => { throw new Error("发布索引读取失败（HTTP 503）") },
  })
  assert.deepEqual(events, [
    "local:https://panel.example.test",
    "server:https://panel.example.test",
  ])
  assert.equal(result.serverSynced, true)
  assert.equal(result.verified, false)
  assert.match(result.warning ?? "", /服务端已保存新更新源.*HTTP 503/)
})
