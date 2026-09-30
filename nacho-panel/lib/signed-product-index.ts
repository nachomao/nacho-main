import { verify } from "node:crypto"

export const UPDATE_ORIGIN = process.env.NACHO_UPDATE_ORIGIN || "https://updates.example.invalid"
export const PRODUCT_INDEX_URL = `${UPDATE_ORIGIN}/updates/stable/index.json`
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA2qjcjfU4N2/nMmD9XkemMqqq6P0K6OVfjAnwlBJDU1g=
-----END PUBLIC KEY-----`

export type SignedProductIndex = {
  schemaVersion: 2 | 3
  channel: "stable" | "beta" | "alpha"
  sequence: number
  publishedAt: string
  releases: {
    panel: { version: string; fileName: string; sha256: string; sizeBytes: number; url: string; publishedAt: string; authenticodeThumbprint?: string; title: string; notes: string }
    server: {
      version: string
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
    agent: { version: string; fileName: string; sha256: string; sizeBytes: number; url: string; publishedAt: string; title: string; notes: string }
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

export async function fetchSignedProductIndex(channel: "stable" | "beta" | "alpha" = "stable"): Promise<SignedProductIndex> {
  if (UPDATE_ORIGIN === "https://updates.example.invalid") throw new Error("请先配置独立更新服务器的 NACHO_UPDATE_ORIGIN")
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(UPDATE_ORIGIN)) throw new Error("更新服务器 HTTPS 地址无效")
  const url = `${UPDATE_ORIGIN}/updates/${channel}/index.json`
  const [indexResponse, signatureResponse] = await Promise.all([
    fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) }),
    fetch(`${url}.sig`, { cache: "no-store", signal: AbortSignal.timeout(15_000) }),
  ])
  if (!indexResponse.ok || !signatureResponse.ok) throw new Error("发布索引暂不可用")
  const bytes = Buffer.from(await indexResponse.arrayBuffer())
  const signature = Buffer.from(await signatureResponse.arrayBuffer())
  if (!bytes.length || bytes.length > 32 * 1024 || signature.length !== 64 || !verify(null, bytes, PUBLIC_KEY, signature)) {
    throw new Error("发布索引签名无效")
  }
  const index = JSON.parse(bytes.toString("utf8")) as SignedProductIndex
  const server = index.releases?.server
  const panel = index.releases?.panel
  if (index.schemaVersion === 3) {
    if (index.channel !== channel || !Number.isSafeInteger(index.sequence) || index.sequence < 1) {
      throw new Error("签名索引频道或序号无效")
    }
    return normalizeV3(index)
  }
  if (index.schemaVersion !== 2 || index.channel !== channel || !Number.isSafeInteger(index.sequence) || index.sequence < 1 ||
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
