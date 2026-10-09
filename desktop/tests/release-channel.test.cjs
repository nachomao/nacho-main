const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
process.env.NACHO_UPDATE_ORIGIN ||= "https://maojiu.cc"
const { createUpdater } = require("../src/updates.cjs")

test("新安装沿用构建频道，升级保留用户已选择的更新频道", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-release-channel-"))
  try {
    fs.writeFileSync(path.join(temporary, "package.json"), JSON.stringify({ releaseChannel: "beta" }))
    const app = { getAppPath: () => temporary, getPath: () => temporary }
    assert.equal(createUpdater(app).getChannel(), "beta")
    fs.writeFileSync(path.join(temporary, "update-channel.json"), JSON.stringify({ channel: "alpha" }))
    assert.equal(createUpdater(app).getChannel(), "alpha")
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

test("频道切换复用已验证索引，重复选择仍返回完整版本信息", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-channel-switch-"))
  const originalFetch = global.fetch
  const index = fs.readFileSync(path.join(__dirname, "fixtures", "release-beta-v3.json"))
  const signature = Buffer.from(fs.readFileSync(path.join(__dirname, "fixtures", "release-beta-v3.sig.base64"), "utf8"), "base64")
  const calls = []
  global.fetch = async (url) => {
    assert.match(String(url), /\/updates\/beta\/index\.json(?:\.sig)?$/)
    calls.push(String(url))
    return new Response(String(url).endsWith(".sig") ? signature : index)
  }
  try {
    const app = { getAppPath: () => temporary, getPath: () => temporary, getVersion: () => "0.1.10" }
    const updater = createUpdater(app)
    assert.equal(updater.getChannel(), "stable")
    const result = await updater.setChannel("beta")
    assert.equal(result.channel, "beta")
    assert.equal(result.index.releases.panel.version, "0.2.1")
    assert.equal(result.currentVersion, "0.1.10")
    assert.equal(result.stale, false)
    assert.equal(calls.length, 2, "切换不应重复请求索引并因第二次网络失败而丢失成功结果")
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temporary, "update-channel.json"), "utf8")), { channel: "beta" })
    assert.equal(updater.cached().channel, "beta")
    const repeated = await updater.setChannel("beta")
    assert.equal(repeated.index.releases.panel.version, "0.2.1")
    assert.equal(repeated.channel, "beta")
  } finally {
    global.fetch = originalFetch
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

test("无效签名不能改变已保存的面板频道", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-channel-invalid-"))
  const originalFetch = global.fetch
  const index = fs.readFileSync(path.join(__dirname, "fixtures", "release-beta-v3.json"))
  fs.writeFileSync(path.join(temporary, "update-channel.json"), JSON.stringify({ channel: "stable" }))
  global.fetch = async (url) => new Response(String(url).endsWith(".sig") ? Buffer.alloc(64) : index)
  try {
    const updater = createUpdater({ getAppPath: () => temporary, getPath: () => temporary, getVersion: () => "0.1.10" })
    await assert.rejects(updater.setChannel("beta"), /发布索引签名无效/)
    assert.equal(updater.getChannel(), "stable")
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temporary, "update-channel.json"), "utf8")), { channel: "stable" })
  } finally {
    global.fetch = originalFetch
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})
