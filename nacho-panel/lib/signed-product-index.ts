import { verify, type KeyObject } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const UPDATE_ORIGIN = process.env.NACHO_UPDATE_ORIGIN || "https://updates.example.invalid"
export const PRODUCT_INDEX_URL = `${UPDATE_ORIGIN}/updates/index.json`
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA2qjcjfU4N2/nMmD9XkemMqqq6P0K6OVfjAnwlBJDU1g=
-----END PUBLIC KEY-----`

export type SignedProductIndex = {
  schemaVersion: 2 | 3 | 4
  channel?: "stable" | "beta" | "alpha"
  sequence: number
  publishedAt: string
  releases: {
    panel: { version: string; releaseType?: string; fileName: string; sha256: string; sizeBytes: number; url: string; publishedAt: string; authenticodeThumbprint?: string; title: string; notes: string }
    server: {
      version: string
      releaseType?: string
      fileName: string
      sha256: string
      sizeBytes: number
      url: string
      publishedAt: string
      minPanelVersion: string
      minAgentVersion: string
      title: string
      notes: string
      windows?: { fileName: string; url: string; sha256: string; sizeBytes: number }
      source?: { fileName: string; url: string; sha256: string; sizeBytes: number }
      agent?: { fileName: string; url: string; sha256: string; sizeBytes: number }
    }
    agent: { version: string; releaseType?: string; fileName: string; sha256: string; sizeBytes: number; url: string; publishedAt: string; title: string; notes: string }
  }
}
function githubAsset(repo: string, version: string, name: string, asset: any) {
  if (asset?.fileName !== name || asset.url !== `https://github.com/nachomao/${repo}/releases/download/v${version}/${name}` ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.sizeBytes) ||
      asset.sizeBytes < 1 || asset.sizeBytes > 2 * 1024 ** 3) throw new Error("GitHub 制品无效")
  return asset
}
function normalizeV3(raw: any): SignedProductIndex {
  const panel = raw.releases?.panel, server = raw.releases?.server
  if (Object.keys(raw.releases || {}).sort().join(",") !== "panel,server" ||
      !/^\d+\.\d+\.\d+$/.test(panel?.version) || !/^\d+\.\d+\.\d+$/.test(server?.version)) {
    throw new Error("双仓签名索引格式无效")
  }
  for (const item of [panel, server]) {
    if (!/^[a-f0-9]{40}$/.test(item.sourceCommit) || !item.title?.trim() ||
        !item.notes?.trim() || !Number.isFinite(Date.parse(item.publishedAt))) {
      throw new Error("双仓发布说明或源码提交无效")
    }
    if (raw.schemaVersion === 4 && (typeof item.releaseType !== "string" ||
        !/^[a-z][a-z0-9-]{0,31}$/.test(item.releaseType))) throw new Error("发布类型无效")
  }
  const exe = githubAsset("nacho-main", panel.version, `NachoPanel-Setup-${panel.version}.exe`, panel.asset)
  const source = githubAsset("nacho-server", server.version,
    `nacho-server-source-${server.version}.tar.gz`, server.source)
  const agent = githubAsset("nacho-server", server.version,
    `nacho-agent-${server.version}-win-x64.exe`, server.agent)
  if (panel.authenticodeThumbprint !== undefined && !/^[A-F0-9]{40}$/.test(panel.authenticodeThumbprint)) {
    throw new Error("面板证书指纹无效")
  }
  for (const key of ["minPanelVersion", "minAgentVersion", "minServerVersion"]) {
    if (!/^\d+\.\d+\.\d+$/.test(server[key])) throw new Error("兼容版本无效")
  }
  return { ...raw, releases: {
    panel: { ...panel, ...exe },
    server: { ...server, ...source, source, agent },
    agent: { ...server, ...agent, minServerVersion: server.minServerVersion },
  } } as SignedProductIndex
}

export function verifySignedProductIndex(bytes: Buffer, signature: Buffer, key: string | KeyObject = PUBLIC_KEY): SignedProductIndex {
  if (!bytes.length || bytes.length > 32 * 1024 || signature.length !== 64 || !verify(null, bytes, key, signature)) {
    throw new Error("发布索引签名无效")
  }
  const index = JSON.parse(bytes.toString("utf8")) as SignedProductIndex
  if (!Number.isSafeInteger(index.sequence) || index.sequence < 1 || !Number.isFinite(Date.parse(index.publishedAt)) ||
      (index.schemaVersion === 4 ? index.channel !== undefined : !["stable", "beta", "alpha"].includes(index.channel || ""))) {
    throw new Error("签名索引类型或序号无效")
  }
  const server = index.releases?.server
  const panel = index.releases?.panel
  if (index.schemaVersion === 3 || index.schemaVersion === 4) {
    return normalizeV3(index)
  }
  if (index.schemaVersion !== 2 ||
      !panel || (panel.authenticodeThumbprint !== undefined && !/^[A-F0-9]{40}$/.test(panel.authenticodeThumbprint)) ||
      !server || !/^\d+\.\d+\.\d+$/.test(server.version) || !/^\d+\.\d+\.\d+$/.test(server.minPanelVersion) ||
      !/^\d+\.\d+\.\d+$/.test(server.minAgentVersion) ||
      server.windows?.fileName !== `control-server-${server.version}-win-x64.zip` ||
      server.windows.url !== `${UPDATE_ORIGIN}/artifacts/server/${server.version}/${server.windows.sha256}/${server.windows.fileName}` ||
      !/^[a-f0-9]{64}$/.test(server.windows.sha256) ||
      !Number.isSafeInteger(server.windows.sizeBytes) || server.windows.sizeBytes < 1 || server.windows.sizeBytes > 2 * 1024 ** 3) {
    throw new Error("Windows 服务端发布信息无效")
  }
  for (const [component, item] of Object.entries(index.releases)) {
    if (!["panel", "server", "agent"].includes(component) || !item ||
        !/^[a-f0-9]{64}$/.test(item.sha256) || item.url !==
        `${UPDATE_ORIGIN}/artifacts/${component}/${item.version}/${item.sha256}/${item.fileName}` ||
        !item.title?.trim() || !item.notes?.trim()) throw new Error("发布制品或说明无效")
  }
  return index
}

const cachePath = () => process.env.NACHO_PANEL_UPDATE_CACHE_PATH ||
  path.join(process.env.LOCALAPPDATA || os.homedir(), "NachoPanel", "release-index-cache-recommended.json")
export function cachedSignedProductIndex(key: string | KeyObject = PUBLIC_KEY): SignedProductIndex | null {
  try {
    const saved = JSON.parse(fs.readFileSync(cachePath(), "utf8"))
    const index = verifySignedProductIndex(Buffer.from(saved.bytes, "base64"), Buffer.from(saved.signature, "base64"), key)
    return index.schemaVersion === 4 ? index : null
  } catch { return null }
}
async function readRemote(url: string, max: number) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) })
  if (response.status === 404) throw new Error("更新服务器尚未提供推荐索引，请先迁移更新服务")
  if (!response.ok) throw new Error(`发布索引读取失败（HTTP ${response.status}）`)
  if (!response.body || Number(response.headers.get("content-length")) > max) throw new Error("发布索引大小无效")
  const chunks: Buffer[] = []
  let size = 0
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > max) { await reader.cancel(); throw new Error("发布索引大小无效") }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  return { bytes: Buffer.concat(chunks), url: response.url || url }
}
export function createProductIndexReader({ publicKey = PUBLIC_KEY, origin = UPDATE_ORIGIN }: {
  publicKey?: string | KeyObject; origin?: string
} = {}) {
  let checking: Promise<SignedProductIndex> | null = null
  function fetchSignedProductIndex(sequence?: number): Promise<SignedProductIndex> {
    if (sequence !== undefined) return loadSignedProductIndex(sequence)
    if (checking) return checking
    checking = loadSignedProductIndex().finally(() => { checking = null })
    return checking
  }
  async function loadSignedProductIndex(sequence?: number): Promise<SignedProductIndex> {
    if (origin === "https://updates.example.invalid") throw new Error("请先配置独立更新服务器的 NACHO_UPDATE_ORIGIN")
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin) ||
        (sequence !== undefined && (!Number.isSafeInteger(sequence) || sequence < 1))) throw new Error("推荐索引请求无效")
    const url = sequence === undefined ? `${origin}/updates/index.json` : `${origin}/updates/revisions/${sequence}/index.json`
    const remote = await readRemote(url, 32 * 1024)
    const match = /^\/updates\/revisions\/([1-9]\d*)\/index\.json$/.exec(new URL(remote.url).pathname)
    if (new URL(remote.url).origin !== origin || !match ||
        (sequence !== undefined && Number(match[1]) !== sequence)) throw new Error("推荐索引固定地址无效")
    const { bytes: signature } = await readRemote(`${remote.url}.sig`, 128)
    const index = verifySignedProductIndex(remote.bytes, signature, publicKey)
    if (index.schemaVersion !== 4 || index.sequence !== Number(match[1])) throw new Error("推荐索引序号或协议无效")
    if (sequence !== undefined) return index
    const old = cachedSignedProductIndex(publicKey)
    if (old && (index.sequence < old.sequence || (index.sequence === old.sequence && JSON.stringify(index) !== JSON.stringify(old)) ||
        (["panel", "server", "agent"] as const).some((component) => {
          const current = index.releases[component], previous = old.releases[component]
          const a = current.version.split(".").map(Number), b = previous.version.split(".").map(Number)
          const difference = a.map((n, i) => n - b[i]).find((n) => n !== 0) || 0
          return difference < 0 || (difference === 0 && (current.sha256 !== previous.sha256 || current.sizeBytes !== previous.sizeBytes))
        }))) throw new Error("推荐索引版本倒退或同版本内容变化")
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true })
    fs.writeFileSync(`${cachePath()}.tmp`, JSON.stringify({ bytes: remote.bytes.toString("base64"), signature: signature.toString("base64") }))
    fs.renameSync(`${cachePath()}.tmp`, cachePath())
    return index
  }
  return fetchSignedProductIndex
}
export const fetchSignedProductIndex = createProductIndexReader()
