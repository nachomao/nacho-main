import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createProductIndexReader, verifySignedProductIndex } from "../lib/signed-product-index"

const template = JSON.parse(fs.readFileSync(new URL("../../desktop/tests/fixtures/release-beta-v3.json", import.meta.url), "utf8"))
function sample(sequence = 1) {
  const index = structuredClone(template)
  index.schemaVersion = 4
  index.sequence = sequence
  delete index.channel
  index.releases.panel.releaseType = "beta"
  index.releases.server.releaseType = "stable"
  return index
}
test("面板独立验签推荐类型，并拒绝类型缺失和伪造制品", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const verify = (index: unknown) => {
    const bytes = Buffer.from(JSON.stringify(index))
    return verifySignedProductIndex(bytes, sign(null, bytes, privateKey), publicKey)
  }
  const valid = verify(sample())
  assert.equal(valid.releases.panel.releaseType, "beta")
  assert.equal(valid.releases.agent.releaseType, "stable")
  const invalid = sample()
  delete invalid.releases.server.releaseType
  assert.throws(() => verify(invalid), /发布类型无效/)
  const forged = sample()
  forged.releases.server.agent.url = "https://example.org/agent.exe"
  assert.throws(() => verify(forged), /GitHub 制品无效/)
})

test("面板 HTTP 更新读取固定索引签名、忽略旧频道并保持全局版本防倒退", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-panel-index-"))
  const oldCache = process.env.NACHO_PANEL_UPDATE_CACHE_PATH
  const originalFetch = global.fetch
  process.env.NACHO_PANEL_UPDATE_CACHE_PATH = path.join(root, "cache.json")
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const read = createProductIndexReader({ publicKey, origin: "https://updates.example.test" })
  const snapshots = new Map<number, { bytes: Buffer; signature: Buffer }>()
  let current = 1, moved = false
  function publish(index: ReturnType<typeof sample>) {
    const bytes = Buffer.from(JSON.stringify(index))
    snapshots.set(index.sequence, { bytes, signature: sign(null, bytes, privateKey) })
    current = index.sequence
  }
  publish(sample(1))
  const calls: string[] = []
  global.fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    const sequence = url.endsWith("/updates/index.json") ? current : Number(/revisions\/(\d+)\//.exec(url)?.[1])
    const snapshot = snapshots.get(sequence)!
    const signature = url.endsWith(".sig")
    const response = new Response(signature ? snapshot.signature : snapshot.bytes)
    Object.defineProperty(response, "url", { value: `https://updates.example.test/updates/revisions/${sequence}/index.json${signature ? ".sig" : ""}` })
    if (!moved && !signature) { moved = true; publish(sample(2)) }
    return response
  }
  try {
    fs.writeFileSync(path.join(root, "update-channel.json"), '{"channel":"alpha"}')
    assert.equal((await read()).sequence, 1)
    assert.equal((await read()).sequence, 2)
    assert.equal((await read(1)).sequence, 1)
    publish(sample(1))
    await assert.rejects(read(), /倒退/)
    assert.ok(calls.every((url) => !url.includes("/alpha/")))
  } finally {
    global.fetch = originalFetch
    if (oldCache === undefined) delete process.env.NACHO_PANEL_UPDATE_CACHE_PATH
    else process.env.NACHO_PANEL_UPDATE_CACHE_PATH = oldCache
    fs.rmSync(root, { recursive: true, force: true })
  }
})
