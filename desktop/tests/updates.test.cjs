const assert = require("node:assert/strict")
const { generateKeyPairSync, sign } = require("node:crypto")
const test = require("node:test")
const { compareVersions, verifyIndex } = require("../src/updates.cjs")
const ORIGIN = process.env.NACHO_UPDATE_ORIGIN || "https://updates.example.invalid"

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const releases = Object.fromEntries([
  ["panel", "nacho-main", "0.1.3", "NachoPanel-Setup-0.1.3.exe"],
  ["server", "nacho-server", "1.0.1", "control-server-1.0.1-linux-x64.tar.gz"],
  ["agent", "nacho-server", "1.1.22", "nacho-agent-1.1.22-win-x64.exe"],
].map(([name, repo, version, fileName]) =>
  [name, { version, fileName, sha256: "a".repeat(64), sizeBytes: 123, publishedAt: "2026-09-29T00:00:00Z",
    url: `${ORIGIN}/artifacts/${name}/${version}/${"a".repeat(64)}/${fileName}`,
    title: "更新", notes: "改进", sourceCommit: "f".repeat(40) }]))
releases.server.windows = {
  fileName: "control-server-1.0.1-win-x64.zip",
  url: `${ORIGIN}/artifacts/server/1.0.1/${"b".repeat(64)}/control-server-1.0.1-win-x64.zip`,
  sha256: "b".repeat(64), sizeBytes: 123,
}
releases.panel.authenticodeThumbprint = "A".repeat(40)

test("Electron 拒绝篡改、错误地址及版本格式", () => {
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 2, channel: "stable", sequence: 1, publishedAt: "2026-09-29T00:00:00Z", releases }))
  const signature = sign(null, bytes, privateKey)
  assert.equal(verifyIndex(bytes, signature, publicKey).releases.panel.version, "0.1.3")
  assert.throws(() => verifyIndex(Buffer.concat([bytes, Buffer.from(" ")]), signature, publicKey), /签名/)
  assert.equal(compareVersions("0.1.2", "0.1.3"), -1)
  assert.throws(() => compareVersions("0.1", "0.1.3"))
  const malformed = Buffer.from(JSON.stringify({ schemaVersion: 2, channel: "stable", sequence: 2, publishedAt: "2026-09-29T00:00:00Z",
    releases: { ...releases, panel: { ...releases.panel, url: "https://example.com/installer.exe" } } }))
  assert.throws(() => verifyIndex(malformed, sign(null, malformed, privateKey), publicKey), /发布信息无效/)
})

test("未签名面板制品仍要求发布索引签名、固定地址和 SHA-256", () => {
  const unsigned = structuredClone(releases)
  delete unsigned.panel.authenticodeThumbprint
  const bytes = Buffer.from(JSON.stringify({
    schemaVersion: 2, channel: "stable", sequence: 2,
    publishedAt: "2026-09-29T00:00:00Z", releases: unsigned,
  }))
  const signature = sign(null, bytes, privateKey)
  assert.equal(verifyIndex(bytes, signature, publicKey).releases.panel.authenticodeThumbprint, undefined)
  assert.throws(() => verifyIndex(bytes, Buffer.alloc(64), publicKey), /签名无效/)
  const invalid = structuredClone(unsigned)
  invalid.panel.authenticodeThumbprint = null
  const invalidBytes = Buffer.from(JSON.stringify({
    schemaVersion: 2, channel: "stable", sequence: 2,
    publishedAt: "2026-09-29T00:00:00Z", releases: invalid,
  }))
  assert.throws(() => verifyIndex(invalidBytes, sign(null, invalidBytes, privateKey), publicKey), /指纹无效/)
  invalid.panel.authenticodeThumbprint = undefined
  invalid.panel.sha256 = "0".repeat(64)
  const changed = Buffer.from(JSON.stringify({
    schemaVersion: 2, channel: "stable", sequence: 2,
    publishedAt: "2026-09-29T00:00:00Z", releases: invalid,
  }))
  assert.throws(() => verifyIndex(changed, signature, publicKey), /签名无效/)
})
