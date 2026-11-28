import test from "node:test"
import assert from "node:assert/strict"
import { canOfferInstall, installationSourceNotice, type DesktopRelease, type ReleasePart } from "../lib/github-update-ui"

const release = {
  target: { profileId: "fork", channel: "beta", component: "server", version: "2.0.0", digest: "a".repeat(64) },
  repository: "tester/nacho-beta", signerFingerprint: "b".repeat(64), official: false,
} as DesktopRelease

test("only a freshly verified, strictly newer release enables installation", () => {
  const checked: ReleasePart = { status: "available", release }
  assert.equal(canOfferInstall(checked, "1.10.0"), true)
  assert.equal(canOfferInstall(checked, "2.0.0"), false)
  assert.equal(canOfferInstall(checked, "2.0.1"), false)
  assert.equal(canOfferInstall({ ...checked, status: "stale" }, "1.10.0"), false)
  assert.equal(canOfferInstall({ ...checked, status: "locked" }, "1.10.0"), false)
  assert.equal(canOfferInstall({ status: "error", release: null }, "1.10.0"), false)
  assert.equal(canOfferInstall(checked, null, true), true)
  assert.equal(canOfferInstall(checked, null), false)
})
test("the nonofficial warning preserves repository and complete signer fingerprint", () => {
  const warning = installationSourceNotice(release)
  assert.ok(warning?.includes("非官方来源"))
  assert.ok(warning?.includes(release.repository))
  assert.ok(warning?.includes(release.signerFingerprint))
  assert.equal(installationSourceNotice({ ...release, official: true }), null)
})
