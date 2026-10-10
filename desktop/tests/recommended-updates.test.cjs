const assert = require("node:assert/strict")
const { generateKeyPairSync, sign } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
process.env.NACHO_UPDATE_ORIGIN ||= "https://maojiu.cc"
const { createUpdater } = require("../src/updates.cjs")
const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const origin = process.env.NACHO_UPDATE_ORIGIN
const template = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "release-beta-v3.json"), "utf8"))
function sample(sequence = 1) {
  const index = structuredClone(template)
  index.schemaVersion = 4
  index.sequence = sequence
  delete index.channel
  index.releases.panel.releaseType = "beta"
  index.releases.server.releaseType = "stable"
  return index
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-recommended-"))
  const updater = createUpdater({ getPath: () => root, getVersion: () => "0.1.10" }, { publicKey })
  let current = sample(), corrupt = false, offline = false
  const revisions = new Map()
  const calls = []
  function publish(index) {
    current = index
    const bytes = Buffer.from(JSON.stringify(index))
    revisions.set(index.sequence, { bytes, signature: sign(null, bytes, privateKey) })
  }
  publish(current)
  const original = global.fetch
  global.fetch = async (url) => {
    calls.push(String(url))
    if (offline) throw new TypeError("fetch failed")
    const sequence = String(url) === `${origin}/updates/index.json` ? current.sequence :
      Number(/\/revisions\/(\d+)\//.exec(String(url))?.[1])
    const revision = revisions.get(sequence)
    assert.ok(revision, String(url))
    const signature = String(url).endsWith(".sig")
    const response = new Response(signature ? corrupt ? Buffer.alloc(64) : revision.signature : revision.bytes)
    Object.defineProperty(response, "url", { value: `${origin}/updates/revisions/${sequence}/index.json${signature ? ".sig" : ""}` })
    return response
  }
  return { root, updater, publish, calls,
    corrupt: () => { corrupt = true }, offline: () => { offline = true },
    close() { global.fetch = original; fs.rmSync(root, { recursive: true, force: true }) } }
}

test("忽略构建频道和旧本地频道选择，展示服务器推荐的混合类型", async () => {
  const f = fixture()
  try {
    fs.writeFileSync(path.join(f.root, "package.json"), '{"releaseChannel":"alpha"}')
    fs.writeFileSync(path.join(f.root, "update-channel.json"), '{"channel":"alpha"}')
    const check = await f.updater.check(true)
    assert.equal(check.index.releases.panel.releaseType, "beta")
    assert.equal(check.index.releases.server.releaseType, "stable")
    assert.equal(check.index.releases.agent.releaseType, "stable")
    assert.deepEqual(f.calls, [`${origin}/updates/index.json`, `${origin}/updates/revisions/1/index.json.sig`])
    assert.equal(f.updater.setChannel, undefined)
    assert.equal(fs.readFileSync(path.join(f.root, "update-channel.json"), "utf8"), '{"channel":"alpha"}')
  } finally { f.close() }
})

test("离线缓存只能展示，签名失败不会降级成缓存成功", async () => {
  const f = fixture()
  try {
    await f.updater.check(true)
    f.corrupt()
    await assert.rejects(f.updater.check(true), /签名无效/)
    await assert.rejects(f.updater.check(), /签名无效/, "无效签名后不能从快速缓存恢复为成功")
    f.offline()
    assert.equal((await f.updater.check(true)).stale, true)
    assert.equal((await f.updater.check()).stale, true, "离线刷新仍须明确标为缓存")
  } finally { f.close() }
})

test("拒绝序号回退、组件版本回退、同序号变化及同版本换包", async () => {
  for (const kind of ["sequence", "version", "same-sequence", "same-version"]) {
    const f = fixture()
    try {
      f.publish(sample(4))
      await f.updater.check(true)
      const next = sample(kind === "sequence" ? 3 : kind === "same-sequence" ? 4 : 5)
      if (kind === "version") {
        const panel = next.releases.panel
        panel.version = "0.1.9"
        panel.asset.fileName = "NachoPanel-Setup-0.1.9.exe"
        panel.asset.url = `https://github.com/nachomao/nacho-main/releases/download/v0.1.9/${panel.asset.fileName}`
      }
      if (kind === "same-sequence") next.releases.panel.notes += "\n变化"
      if (kind === "same-version") next.releases.panel.asset.sha256 = "a".repeat(64)
      f.publish(next)
      await assert.rejects(f.updater.check(true), /倒退/)
    } finally { f.close() }
  }
})

test("获取签名时推荐指针变化，仍验证已读取的不可变索引", async () => {
  const f = fixture()
  const fetcher = global.fetch
  global.fetch = async (url) => {
    const response = await fetcher(url)
    if (String(url).endsWith("/updates/index.json")) f.publish(sample(2))
    return response
  }
  try {
    assert.equal((await f.updater.check(true)).index.sequence, 1)
    assert.equal((await f.updater.check(true)).index.sequence, 2)
  } finally { f.close() }
})

test("统一 SSE 通知只触发重新验签，不采用通知中的制品信息", async () => {
  const f = fixture()
  const fetcher = global.fetch
  let notices = 0
  global.fetch = async (url, init) => {
    if (!String(url).endsWith("/updates/events")) return fetcher(url)
    notices++
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('event: release\ndata: {"sequence":1,"releases":{"panel":{"url":"https://example.org/forged.exe"}}}\n\n'))
        init.signal.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true })
      },
    }))
  }
  try {
    const checked = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("更新通知未响应")), 2000)
      f.updater.subscribe((result) => {
        clearTimeout(timeout)
        f.updater.unsubscribe()
        resolve(result)
      })
    })
    assert.equal(checked.index.sequence, 1)
    assert.match(checked.index.releases.panel.url, /^https:\/\/github\.com\/nachomao\/nacho-main\//)
    assert.equal(notices, 1)
  } finally { f.updater.unsubscribe(); f.close() }
})
