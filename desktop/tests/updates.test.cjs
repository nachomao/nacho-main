const assert = require("node:assert/strict")
const { generateKeyPairSync, sign } = require("node:crypto")
const test = require("node:test")
const { OFFICIAL_PROFILE, verifyManifest, assetUrl, compareVersions } = require("../src/release-manifest.cjs")

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const profile = { ...OFFICIAL_PROFILE, id: "test", publicKey: publicKey.export({ type: "spki", format: "pem" }) }
function fixture() {
  return {
    schemaVersion: 5, channel: "stable", component: "panel", version: "2.0.0",
    source: { repository: "nachomao/nacho-main", commit: "c".repeat(40) },
    release: { repository: "nachomao/nacho-main", tag: "stable-panel-v2.0.0" },
    title: "Update", notes: "Notes", access: "public",
    compatibility: { minPanelVersion: "0.0.0", minServerVersion: "0.0.0", minAgentVersion: "0.0.0" },
    assets: { installer: { fileName: "NachoPanel-Setup-2.0.0.exe", sizeBytes: 8, sha256: "e".repeat(64) } },
  }
}
function signed(m) { const bytes = Buffer.from(JSON.stringify(m)); return [bytes, sign(null, bytes, privateKey)] }

test("Electron 发布清单绑定仓库、渠道与目标版本，签名经过篡改立即拒绝", () => {
  const m = fixture()
  const [bytes, signature] = signed(m)
  assert.equal(verifyManifest(bytes, signature, profile).official, false)
  assert.throws(() => verifyManifest(bytes, signature, OFFICIAL_PROFILE), /签名/)
  assert.throws(() => verifyManifest(bytes, signature, profile, { repository: "outside/not-nacho" }), /目标/)
  assert.throws(() => verifyManifest(Buffer.concat([bytes, Buffer.from(" ")]), signature, profile), /签名/)
  assert.throws(() => compareVersions("02.0.0", "2.0.0"), /版本/)
})
test("无 Authenticode 的安装包仍必须通过 Ed25519、固定路径和 SHA-256", () => {
  const m = fixture()
  assert.equal(verifyManifest(...signed(m), profile).manifest.authenticodeThumbprint, undefined)
  assert.equal(assetUrl(m, m.assets.installer), "https://github.com/nachomao/nacho-main/releases/download/stable-panel-v2.0.0/NachoPanel-Setup-2.0.0.exe")
  m.assets.installer.sha256 = "unused"
  assert.throws(() => verifyManifest(...signed(m), profile), /SHA-256/)
})
test("全新的客户端不会将旧更新服务器索引当作 GitHub 清单", () => {
  const incompatible = { schemaVersion: 4, sequence: 7, releases: { panel: fixture() } }
  assert.throws(() => verifyManifest(...signed(incompatible), profile), /字段|协议/)
})
