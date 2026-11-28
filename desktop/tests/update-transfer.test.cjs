const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const { createUpdater } = require("../src/updates.cjs")
const { OFFICIAL_PROFILE } = require("../src/release-manifest.cjs")

const target = { profileId: "official", channel: "stable", component: "server", version: "2.0.0", digest: "e".repeat(64) }
const proof = { manifest: "proof-bytes", signature: "detached-signature" }
const asset = { fileName: "nacho-server-source-2.0.0.tar.gz", sizeBytes: 4, sha256: "a".repeat(64) }
function fixture(t, options = {}) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-v5-transfer-"))
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }))
  const trace = []
  const updater = createUpdater({ getVersion: () => "1.2.0" }, {
    platform: "win32", dataDirectory,
    settings: { selection: () => ({ channel: "stable", profile: OFFICIAL_PROFILE }) },
    checker: { async confirm(_profile, _channel, _component, requested) {
      trace.push("fresh")
      assert.deepEqual(requested, target)
      return { proof, digest: target.digest, manifest: { version: target.version,
        release: { repository: "nachomao/nacho-server", tag: "v2.0.0" },
        assets: { source: asset }, compatibility: { minPanelVersion: "1.0.0" } } }
    } },
    http: { async download(url, file) {
      trace.push("download")
      assert.match(url, /github\.com\/nachomao\/nacho-server/)
      fs.writeFileSync(file, "data")
    } },
    makeStageClient: credentials => ({
      async checkCompatibility() {
        trace.push("target-compatibility")
        assert.equal(credentials.serverUrl, "https://test-control.example")
        if (options.oldServer) throw new Error("target does not support GitHub proof")
      },
      async upload(data) {
        trace.push("remote-commit")
        assert.deepEqual(data.proof, proof)
        assert.equal(data.digest, target.digest)
        assert.equal(fs.readFileSync(data.file, "utf8"), "data")
        return { phase: "ready" }
      },
    }),
    applyLocal: async (id) => {
      trace.push("local-verify")
      const folder = path.join(dataDirectory, "updates-v5", "local-server-" + id)
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, "receipt.json"))), { target, proof })
      assert.equal(fs.readFileSync(path.join(folder, asset.fileName), "utf8"), "data")
      return { phase: "healthy" }
    },
  })
  return { updater, trace }
}
test("桌面远程升级在下载前确认目标兼容，再发送原始签名证明", async (t) => {
  const f = fixture(t)
  assert.deepEqual(await f.updater.transferRelease("server", "https://test-control.example", "fixture", target), { phase: "ready" })
  assert.deepEqual(f.trace, ["fresh", "target-compatibility", "download", "remote-commit"])
  const old = fixture(t, { oldServer: true })
  await assert.rejects(old.updater.transferRelease("server", "https://test-control.example", "fixture", target), /does not support/)
  assert.deepEqual(old.trace, ["fresh", "target-compatibility"])
})
test("Windows 本机升级只传暂存凭据给独立执行器，原签名与制品同目录", async (t) => {
  const f = fixture(t)
  assert.deepEqual(await f.updater.installLocalServer(target), { phase: "healthy" })
  assert.deepEqual(f.trace, ["fresh", "download", "local-verify"])
})
