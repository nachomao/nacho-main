const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const { createStageClient } = require("../src/release-stage.cjs")

const id = "11111111-2222-4333-8444-555555555555"
const digest = "d".repeat(64)
const manifest = { version: "2.0.0", compatibility: { minPanelVersion: "1.0.0", minServerVersion: "1.0.0" } }
const proof = { manifest: "bWFuaWZlc3Q=", signature: "c2lnbmF0dXJl" }
const asset = { fileName: "nacho-server-source-2.0.0.tar.gz", sizeBytes: 4, sha256: "a".repeat(64) }

function fixture(t, { badDigest = false, rejectChunkOnce = false, oldServer = false, installed } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-release-stage-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, "source")
  fs.writeFileSync(file, "abcd")
  let stage = { id, kind: "server", version: manifest.version, offset: 0, phase: "uploading",
    manifestDigest: badDigest ? "b".repeat(64) : digest, ...asset }
  const calls = [], progress = []
  const fetcher = async (input, init) => {
    assert.equal(init.redirect, "error")
    assert.equal(init.headers.Authorization, "Bearer test-key")
    const url = new URL(input)
    assert.equal(url.origin, "https://server.example")
    calls.push({ method: init.method, path: url.pathname, body: init.body })
    if (url.pathname === "/api/panel/runtime-info") return Response.json({ ok: true, data: {
      version: installed ?? "1.2.0", capabilities: { productUpdatesV5: !oldServer }, updateExecutor: true, updateExecutorProtocol: 5,
    } })
    if (url.pathname.endsWith("/chunks")) {
      assert.equal(Number(url.searchParams.get("offset")), stage.offset)
      assert.deepEqual(init.body, Buffer.from("abcd"))
      stage = { ...stage, offset: 4 }
      if (rejectChunkOnce) throw new Error("response was lost")
    }
    if (url.pathname.endsWith("/commit")) stage = { ...stage, phase: "ready" }
    return Response.json({ ok: true, data: stage })
  }
  const client = createStageClient({ serverUrl: "https://server.example", apiKey: "test-key", panelVersion: "1.1.0", fetcher, directory })
  const argumentsFor = { kind: "server", manifest, digest, proof, asset, onProgress: (p) => progress.push(p) }
  return { client, argumentsFor, file, calls, progress }
}

test("stages raw v5 proof, resumes a committed chunk after a lost response, and commits using only panel version", async (t) => {
  const f = fixture(t, { rejectChunkOnce: true })
  await f.client.checkCompatibility(f.argumentsFor)
  assert.equal((await f.client.upload({ ...f.argumentsFor, file: f.file })).phase, "ready")
  assert.deepEqual(JSON.parse(f.calls[1].body), { kind: "server", version: "2.0.0", proof })
  assert.deepEqual(JSON.parse(f.calls.at(-1).body), { panelVersion: "1.1.0" })
  assert.deepEqual(f.progress, [0, 100])
})

test("rejects older stage protocols, unbound receipts, and downgrades without uploading bytes", async (t) => {
  const old = fixture(t, { oldServer: true })
  await assert.rejects(old.client.checkCompatibility(old.argumentsFor), /签名更新/)
  assert.equal(old.calls.length, 1)
  const newer = fixture(t, { installed: "3.0.0" })
  await assert.rejects(newer.client.checkCompatibility(newer.argumentsFor), /高于/)
  assert.equal(newer.calls.length, 1)
  const wrong = fixture(t, { badDigest: true })
  await assert.rejects(wrong.client.upload({ ...wrong.argumentsFor, file: wrong.file }), /会话与已确认/)
  assert.equal(wrong.calls.length, 1)
})
