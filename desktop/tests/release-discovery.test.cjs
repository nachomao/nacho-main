const assert = require("node:assert/strict")
const { createHash, generateKeyPairSync, sign } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const { createReleaseChecker } = require("../src/release-discovery.cjs")
const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const profile = {
  id: "test", label: "Test source", publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  sourceRepositories: { panel: "test/panel", server: "test/server" },
  repositories: {
    stable: { panel: "test/panel", server: "test/server" },
    beta: { panel: "test/beta-panel", server: "test/beta-server" },
    alpha: { panel: "test/alpha-panel", server: "test/alpha-server" },
  },
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex")
const asset = (fileName, bytes = Buffer.from("test-asset")) => ({ fileName, sizeBytes: bytes.length, sha256: sha(bytes) })

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-release-check-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const releases = new Map(), files = new Map(), hits = []
  let offline = false
  function product(component, version, channel = "stable", { changeTitle, corrupt, missing } = {}) {
    const repository = profile.repositories[channel][component]
    const tag = `${channel}-${component}-v${version}`
    const assets = component === "panel" ? { installer: asset(`NachoPanel-Setup-${version}.exe`) } : {
      source: asset(`nacho-server-source-${version}.tar.gz`), agent: asset(`nacho-agent-${version}-win-x64.exe`),
    }
    if (channel !== "stable") for (const a of Object.values(assets)) a.encrypted = asset(`${a.fileName}.age`)
    const manifest = {
      schemaVersion: 5, component, channel, version, source: { repository: profile.sourceRepositories[component], commit: "a".repeat(40) },
      release: { repository, tag }, access: channel === "beta" ? "key" : "public", title: changeTitle || "Release", notes: "Notes",
      compatibility: { minPanelVersion: "0.0.0", minServerVersion: "0.0.0", minAgentVersion: "0.0.0" }, assets,
    }
    const bytes = Buffer.from(JSON.stringify(manifest)), signature = corrupt ? Buffer.alloc(64) : sign(null, bytes, privateKey)
    const listed = { tag_name: tag, draft: false, prerelease: channel !== "stable", published_at: "2026-01-01T01:00:00Z", assets: [] }
    function add(name, size, data) {
      if (missing === name) return
      listed.assets.push({ name, size, state: "uploaded" })
      if (data) files.set(`https://github.com/${repository}/releases/download/${tag}/${name}`, data)
    }
    add("nacho-release.json", bytes.length, bytes)
    add("nacho-release.json.sig", signature.length, signature)
    for (const plain of Object.values(assets)) {
      const a = plain.encrypted ?? plain
      add(a.fileName, a.sizeBytes)
    }
    releases.set(repository, [listed, ...(releases.get(repository) || []).filter((r) => r.tag_name !== tag)])
    return { manifest, bytes }
  }
  async function fetcher(input, init) {
    assert.equal(init.credentials, "omit")
    assert.equal(init.redirect, "manual")
    const url = new URL(input)
    hits.push(url.href)
    if (offline) throw new TypeError("Offline")
    if (url.hostname === "api.github.com") {
      const repo = url.pathname.match(/^\/repos\/(.+)\/releases$/)?.[1]
      return Response.json(releases.get(repo) ?? [])
    }
    const found = files.get(url.href)
    return found ? new Response(found) : new Response(null, { status: 404 })
  }
  const checker = createReleaseChecker({ directory, fetcher, sleep: async () => {} })
  return { checker, product, hits, files, releases, offline: () => { offline = true } }
}

test("the selected GitHub feed discovers the panel and server independently", async (t) => {
  const f = fixture(t)
  f.product("panel", "2.0.0")
  f.product("server", "3.0.0", "stable", { corrupt: true })
  const result = await f.checker.check(profile, "stable")
  assert.equal(result.components.panel.status, "available")
  assert.equal(result.components.panel.release.target.version, "2.0.0")
  assert.equal(result.components.server.status, "error")
  assert.match(result.components.server.message, /签名/)
  assert.ok(f.hits.every((url) => /^https:\/\/(api\.)?github\.com\//.test(url)))
})

test("offline proof is display-only and confirmation always verifies the fresh manifest", async (t) => {
  const f = fixture(t)
  f.product("panel", "2.0.0")
  const first = await f.checker.check(profile, "stable")
  const target = first.components.panel.release.target
  f.product("panel", "2.0.0", "stable", { changeTitle: "Same version, changed bytes" })
  await assert.rejects(f.checker.confirm(profile, "stable", "panel", target), /同版|变更|变化/)
  f.offline()
  const stale = await f.checker.check(profile, "stable")
  assert.equal(stale.components.panel.status, "stale")
  assert.deepEqual(stale.components.panel.release.target, target)
  await assert.rejects(f.checker.confirm(profile, "stable", "panel", target), /网络|离线/)
})

test("missing required asset and no tester key block installation without looking at other feeds", async (t) => {
  const f = fixture(t)
  f.product("panel", "2.0.0", "stable")
  f.product("panel", "3.0.0", "beta", { missing: "NachoPanel-Setup-3.0.0.exe.age" })
  f.product("server", "4.0.0", "beta")
  const beta = await f.checker.check(profile, "beta")
  assert.equal(beta.components.panel.status, "error")
  assert.match(beta.components.panel.message, /缺少/)
  assert.equal(beta.components.server.status, "locked")
  assert.ok(f.hits.every((url) => url.includes("/test/beta-")))
})

test("out-of-scope redirects are blocked before sending the next request", async (t) => {
  const f = fixture(t)
  const fetchedHosts = []
  const checker = createReleaseChecker({
    directory: path.join(os.tmpdir(), "unused-nacho-release-cache"),
    fetcher: async (input) => {
      fetchedHosts.push(new URL(input).hostname)
      return new Response(null, { status: 302, headers: { location: "https://unexpected.example/path" } })
    },
  })
  const result = await checker.check(profile, "stable")
  assert.equal(result.components.panel.status, "error")
  assert.match(result.components.panel.message, /GitHub/)
  assert.deepEqual(fetchedHosts, ["api.github.com", "api.github.com"])
})
