const assert = require("node:assert/strict")
const { createHash, generateKeyPairSync, sign } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
process.env.NACHO_UPDATE_ORIGIN ||= "https://maojiu.cc"
const payload = Buffer.from("agent fixture")
const downloader = require("../src/github-download.cjs")
downloader.downloadFile = async (_url, destination, expected) => {
  assert.equal(expected.sha256, createHash("sha256").update(payload).digest("hex"))
  fs.writeFileSync(destination, payload)
}
const { createUpdater } = require("../src/updates.cjs")

test("桌面传输固定已确认的版本和索引序号，分块完成后才提交", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-transfer-"))
  const originalFetch = global.fetch
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const index = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "release-beta-v3.json"), "utf8"))
  delete index.channel
  index.schemaVersion = 4
  index.sequence = 7
  index.releases.panel.releaseType = "beta"
  index.releases.server.releaseType = "stable"
  index.releases.server.agent.sizeBytes = payload.length
  index.releases.server.agent.sha256 = createHash("sha256").update(payload).digest("hex")
  const bytes = Buffer.from(JSON.stringify(index)), signature = sign(null, bytes, privateKey)
  const calls = [], progress = []
  global.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes("/updates/revisions/7/")) return new Response(url.endsWith(".sig") ? signature : bytes)
    calls.push({ url, body: init.body })
    if (url.endsWith("/stages")) {
      assert.deepEqual(JSON.parse(init.body), { kind: "agent", version: index.releases.server.version, sequence: 7 })
      return Response.json({ ok: true, data: { id: "fixture", offset: 0 } })
    }
    if (url.includes("/chunks?offset=0")) {
      assert.deepEqual(init.body, payload)
      return Response.json({ ok: true, data: { offset: payload.length } })
    }
    assert.ok(url.endsWith("/commit"))
    return Response.json({ ok: true, data: { phase: "ready" } })
  }
  try {
    const updater = createUpdater({ getPath: () => root, getVersion: () => "0.2.4" }, { publicKey })
    const result = await updater.transferRelease("agent", "https://control.example.test", "fixture-key", 7,
      index.releases.server.version, (value) => progress.push(value))
    assert.equal(result.phase, "ready")
    assert.equal(calls.length, 3)
    assert.deepEqual(progress, [100])
    await assert.rejects(updater.transferRelease("agent", "https://control.example.test", "fixture-key", 7, "9.0.0"), /已确认的发布不一致/)
    assert.equal(calls.length, 3)
  } finally {
    global.fetch = originalFetch
    fs.rmSync(root, { recursive: true, force: true })
  }
})
