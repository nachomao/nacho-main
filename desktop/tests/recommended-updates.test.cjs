const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const { createUpdater, CHECK_INTERVAL_MS } = require("../src/updates.cjs")
const { OFFICIAL_PROFILE } = require("../src/release-manifest.cjs")

function setup(test, script) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-v5-refresh-"))
  test.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }))
  const calls = []
  let channel = "stable"
  const updater = createUpdater({ getVersion: () => "1.2.3" }, {
    dataDirectory, onCheck() {},
    settings: {
      selection: () => ({ profile: OFFICIAL_PROFILE, channel }),
      select(_id, next) { channel = next; return { channel } },
    },
    checker: { async check(profile, selected) {
      calls.push([profile.id, selected])
      return await script(selected, calls.length)
    } },
  })
  return { updater, calls }
}

const noRelease = { status: "not-found", release: null }
const successful = { components: { panel: noRelease, server: noRelease } }

test("默认只检查 Stable，手动切换才检查所选预览渠道", async (t) => {
  const f = setup(t, () => successful)
  assert.equal((await f.updater.check()).channel, "stable")
  await f.updater.select("official", "beta")
  assert.equal((await f.updater.check()).channel, "beta")
  assert.deepEqual(f.calls, [["official", "stable"], ["official", "beta"]])
})
test("成功检查缓存只供轮询，手动刷新重新请求", async (t) => {
  const f = setup(t, () => successful)
  assert.equal(CHECK_INTERVAL_MS, 30 * 60 * 1000)
  assert.deepEqual(await f.updater.check(), await f.updater.check())
  assert.equal(f.calls.length, 1)
  await f.updater.check(true)
  assert.equal(f.calls.length, 2)
})
test("失败、离线缓存或尚未放行不伪装为新结果", async (t) => {
  const f = setup(t, () => ({ components: { panel: { status: "stale", release: null }, server: { status: "locked", release: null } } }))
  assert.equal((await f.updater.check()).components.panel.status, "stale")
  assert.equal((await f.updater.check()).components.server.status, "locked")
  assert.equal(f.calls.length, 2)
})
test("并发手动检查合并到同一次 GitHub 请求", async (t) => {
  let finish
  const f = setup(t, () => new Promise(resolve => { finish = resolve }))
  const a = f.updater.check(true), b = f.updater.check(true)
  assert.equal(f.calls.length, 1)
  finish(successful)
  assert.deepEqual(await a, await b)
})
test("切换来源时作废先前频道正等待的刷新", async (t) => {
  let finish
  const f = setup(t, (channel) => channel === "stable" ? new Promise(resolve => { finish = resolve }) : successful)
  const old = f.updater.check()
  await f.updater.select("official", "alpha")
  assert.equal((await f.updater.check()).channel, "alpha")
  finish(successful)
  await assert.rejects(old, /已切换/)
})
