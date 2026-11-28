const assert = require("node:assert/strict")
const { createHash } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const { createUpdater } = require("../src/updates.cjs")
const { OFFICIAL_PROFILE } = require("../src/release-manifest.cjs")

const content = Buffer.from("installer")
const digest = "4".repeat(64)
const asset = { fileName: "NachoPanel-Setup-2.0.0.exe", sizeBytes: content.length,
  sha256: createHash("sha256").update(content).digest("hex") }
const target = { profileId: "official", channel: "stable", component: "panel", version: "2.0.0", digest }
const release = { official: true, digest,
  manifest: { version: "2.0.0", release: { repository: "nachomao/nacho-main", tag: "v2.0.0" }, assets: { installer: asset } } }

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-install-github-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const phases = [], calls = []
  const app = { isPackaged: true, getVersion: () => "1.0.0", getPath: () => directory, quit() {} }
  const http = { async download(url, file, metadata, { onProgress, onPhase }) {
    calls.push(url)
    assert.deepEqual(metadata, asset)
    onPhase("downloading")
    onProgress(0)
    if (options.badDownload) throw new Error("SHA-256 不符")
    fs.writeFileSync(file, content)
    onProgress(content.length)
    onPhase("verifying")
  } }
  const settings = { selection: () => ({ channel: "stable", profile: options.profile || OFFICIAL_PROFILE }) }
  const checker = { async confirm(_profile, _channel, _component, value) {
    calls.push("fresh-manifest")
    assert.deepEqual(value, options.target || target)
    if (options.failedVerify) throw new Error("签名无效")
    return release
  } }
  const updater = createUpdater(app, {
    dataDirectory: directory, settings, checker, http, platform: "win32",
    onPanelInstallProgress: (state) => phases.push(state.phase),
    handoff: async (script, installer) => {
      calls.push("handoff")
      assert.deepEqual(fs.readFileSync(installer), content)
      assert.match(fs.readFileSync(script, "utf8"), /Get-FileHash/)
    },
    approveThirdParty: async () => { calls.push("warned"); return false },
  })
  return { updater, phases, calls }
}

test("fresh confirmation, checked GitHub download and verified handoff are ordered; no auto-install", async (t) => {
  const f = fixture(t)
  assert.deepEqual(f.calls, [])
  assert.deepEqual(await f.updater.installPanel(target), { phase: "installing", version: "2.0.0" })
  assert.deepEqual(f.calls, ["fresh-manifest", "https://github.com/nachomao/nacho-main/releases/download/v2.0.0/NachoPanel-Setup-2.0.0.exe", "handoff"])
  assert.deepEqual(f.phases.filter((phase, i, all) => !i || phase !== all[i - 1]), ["preparing", "downloading", "verifying", "installing"])
  await assert.rejects(f.updater.installPanel(target), /已经在执行/)
})

test("failed manifest, mismatched SHA and refused third-party warning prevent handoff", async (t) => {
  const invalid = fixture(t, { failedVerify: true })
  await assert.rejects(invalid.updater.installPanel(target), /签名无效/)
  assert.deepEqual(invalid.calls, ["fresh-manifest"])
  const changedPackage = fixture(t, { badDownload: true })
  await assert.rejects(changedPackage.updater.installPanel(target), /SHA-256/)
  assert.equal(changedPackage.updater.getPanelInstallState().phase, "failed")
  assert.ok(!changedPackage.calls.includes("handoff"))
  const thirdPartyTarget = { ...target, profileId: "custom" }
  const untrusted = fixture(t, { profile: { ...OFFICIAL_PROFILE, id: "custom" }, target: thirdPartyTarget })
  await assert.rejects(untrusted.updater.installPanel(thirdPartyTarget), /已取消/)
  assert.deepEqual(untrusted.calls, ["warned"])
})
