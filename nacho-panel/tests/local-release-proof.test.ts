import assert from "node:assert/strict"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { copyVerifiedLocalAsset, readLocalRelease, validLocalUpdateToken } from "../lib/local-release-proof"

const lease = "01234567-1234-4567-8910-987654321012"
const repository = "test/server"
const content = Buffer.from("signed source archive")
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nacho-local-release-"))
  t.after(() => rm(root, { force: true, recursive: true }))
  const directory = path.join(root, "updates-v5", `local-server-${lease}`)
  await mkdir(directory, { recursive: true })
  const key = generateKeyPairSync("ed25519")
  const publicKey = key.publicKey.export({ format: "pem", type: "spki" })
  const repositories = { panel: "test/panel", server: repository }
  const profile = { id: "fixture", publicKey, sourceRepositories: repositories, repositories: { stable: repositories, beta: repositories, alpha: repositories } }
  const signerFingerprint = hash(key.publicKey.export({ format: "der", type: "spki" }))
  await writeFile(path.join(root, "github-update-settings-v5.json"),
    JSON.stringify({ profileId: profile.id, channel: "stable", profiles: [{ profile, signerFingerprint }] }))
  const asset = { fileName: "nacho-server-source-2.0.0.tar.gz", sha256: hash(content), sizeBytes: content.length }
  const bytes = Buffer.from(JSON.stringify({
    schemaVersion: 5, channel: "stable", component: "server", version: "2.0.0",
    source: { repository, commit: "a".repeat(40) },
    release: { repository, tag: "stable-server-v2.0.0" }, access: "public", title: "Test", notes: "Notes",
    compatibility: { minPanelVersion: "1.0.0", minServerVersion: "1.0.0", minAgentVersion: "1.0.0" },
    assets: { source: asset, agent: { ...asset, fileName: "nacho-agent-2.0.0-win-x64.exe" } },
  }))
  const target = { profileId: profile.id, version: "2.0.0", digest: hash(bytes), channel: "stable", component: "server" }
  const proof = { manifest: bytes.toString("base64"), signature: sign(null, bytes, key.privateKey).toString("base64") }
  const receipt = path.join(directory, "receipt.json")
  await writeFile(receipt, JSON.stringify({ target, proof }))
  const source = path.join(directory, asset.fileName)
  await writeFile(source, content)
  return { root, receipt, source, target, proof, env: {
    NACHO_LOCAL_UPDATE_DIR: root,
    NACHO_LOCAL_UPDATE_VERIFIER: path.resolve("..", "desktop", "src", "release-manifest.cjs"),
    NACHO_LOCAL_UPDATE_PANEL_VERSION: "1.0.0",
  } }
}

test("local upgrader authenticates desktop RPC and separately verifies proof and bytes", async (t) => {
  const f = await fixture(t)
  const secret = "a".repeat(64)
  assert.equal(validLocalUpdateToken(secret, secret), true)
  assert.equal(validLocalUpdateToken(secret, "b".repeat(64)), false)
  assert.equal(validLocalUpdateToken(null, undefined), false)
  const release = await readLocalRelease(lease, f.env)
  const copy = path.join(f.root, "private.tar.gz")
  await copyVerifiedLocalAsset(release, copy)
  assert.deepEqual(await readFile(copy), content)
  await writeFile(f.source, Buffer.alloc(content.length))
  await assert.rejects(copyVerifiedLocalAsset(release, `${copy}-bad`), /SHA-256/)
  await assert.rejects(readFile(`${copy}-bad`), /ENOENT/)
})

test("local upgrader refuses untrusted, mismatched, or traversal receipts", async (t) => {
  const f = await fixture(t)
  await assert.rejects(readLocalRelease("../updaters", f.env), /凭据|会话/)
  await writeFile(f.receipt, JSON.stringify({ target: f.target, proof: { ...f.proof, signature: Buffer.alloc(64).toString("base64") } }))
  await assert.rejects(readLocalRelease(lease, f.env), /签名/)
  await writeFile(f.receipt, JSON.stringify({ target: { ...f.target, digest: "b".repeat(64) }, proof: f.proof }))
  await assert.rejects(readLocalRelease(lease, f.env), /不符/)
})
