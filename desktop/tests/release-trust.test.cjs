const assert = require("node:assert/strict")
const { generateKeyPairSync } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const { createUpdateSettings } = require("../src/update-settings.cjs")
const { fingerprint, OFFICIAL_PROFILE } = require("../src/release-manifest.cjs")

const publicKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" })
const profile = {
  ...OFFICIAL_PROFILE, id: "test-fork", label: "Test fork", publicKey,
  repositories: {
    stable: { panel: "test/panel", server: "test/server" },
    beta: { panel: "test/beta", server: "test/beta" },
    alpha: { panel: "test/alpha", server: "test/alpha" },
  },
}
function fixture(t, encryption = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-update-trust-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let decrypted = ""
  const settings = createUpdateSettings({
    directory: root,
    safeStorage: {
      isEncryptionAvailable: () => encryption,
      encryptString(input) { decrypted = input; return Buffer.from("protected-by-dpapi-adapter") },
      decryptString() { return decrypted },
    },
  })
  return { root, settings }
}

test("persists explicit channel selection and requires an out-of-band fingerprint for a bound GitHub profile", (t) => {
  const { settings } = fixture(t)
  assert.deepEqual(settings.selection().profile, OFFICIAL_PROFILE)
  assert.equal(settings.selection().channel, "stable")
  assert.throws(() => settings.trustProfile(profile, "ff".repeat(32)), /指纹/)
  const accepted = settings.trustProfile(profile, fingerprint(publicKey))
  assert.equal(accepted.profiles.find((item) => item.id === profile.id).signerFingerprint, fingerprint(publicKey))
  settings.select("test-fork", "beta")
  assert.equal(settings.selection().channel, "beta")
  assert.equal(settings.selection().profile.repositories.beta.panel, "test/beta")
  assert.throws(() => settings.trustProfile({ ...profile, repositories: OFFICIAL_PROFILE.repositories }, fingerprint(publicKey)), /已存在/)
  settings.removeProfile("test-fork")
  assert.equal(settings.selection().profile.id, "official")
  assert.equal(settings.selection().channel, "stable")
})

test("automatically creates and persists machine-layer device identity inside encrypted storage with zero manual key APIs", (t) => {
  const { root, settings } = fixture(t)
  assert.equal("importTesterIdentity" in settings, false)
  assert.equal("removeTesterIdentity" in settings, false)
  assert.equal("hasTesterKey" in settings.read(), false)
  const first = settings.getOrCreateDeviceIdentity()
  assert.match(first.deviceId, /^dev_[a-f0-9]{32}$/)
  assert.equal(settings.read().deviceId, first.deviceId)
  const second = settings.getOrCreateDeviceIdentity()
  assert.equal(second.deviceId, first.deviceId)
  assert.equal(second.auth.publicKey, first.auth.publicKey)
  const records = fs.readdirSync(root).map((name) => fs.readFileSync(path.join(root, name), "utf8"))
  assert.ok(records.some((record) => record.includes("protected-by-dpapi-adapter")))
  assert.ok(records.every((record) => !record.includes("BEGIN PRIVATE KEY")))
})

test("blocks device identity creation when protected storage is unavailable without writing plaintext", (t) => {
  const { root, settings } = fixture(t, false)
  assert.throws(() => settings.getOrCreateDeviceIdentity(), /加密存储/)
  assert.deepEqual(fs.readdirSync(root), [])
})
