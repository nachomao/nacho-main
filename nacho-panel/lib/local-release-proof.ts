import { createHash, timingSafeEqual } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { lstat, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const SHA256 = /^[a-f0-9]{64}$/

type Profile = { id: string }
type Asset = { fileName: string; sizeBytes: number; sha256: string }
type VerifiedRelease = { digest: string; manifest: {
  version: string
  compatibility: { minPanelVersion: string; minAgentVersion: string }
  assets: { source: Asset }
} }
type Verifier = {
  decodeProof: (proof: unknown) => { bytes: Buffer; signature: Buffer }
  verifyManifest: (bytes: Buffer, signature: Buffer, profile: Profile, expected: { channel: string; component: "server"; version: string }) => VerifiedRelease
  compareVersions: (a: string, b: string) => number
}
type LocalRelease = { file: string; asset: Asset; version: string; minAgentVersion: string; compareVersions: Verifier["compareVersions"] }

export function validLocalUpdateToken(received: string | null, expected: string | undefined) {
  return typeof received === "string" && typeof expected === "string" && SHA256.test(received) && SHA256.test(expected) &&
    timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"))
}

export async function readLocalRelease(leaseId: unknown, env: Readonly<Record<string, string | undefined>> = process.env): Promise<LocalRelease> {
  const { NACHO_LOCAL_UPDATE_DIR: root, NACHO_LOCAL_UPDATE_VERIFIER: verifierPath, NACHO_LOCAL_UPDATE_PANEL_VERSION: panelVersion } = env
  if (typeof leaseId !== "string" || !UUID.test(leaseId) || !root || !path.isAbsolute(root) ||
      !verifierPath || !path.isAbsolute(verifierPath) || !panelVersion) throw new Error("桌面升级会话凭据无效")
  const directory = path.join(root, "updates-v5", `local-server-${leaseId}`)
  if (!(await lstat(directory)).isDirectory()) throw new Error("桌面升级会话无效")
  const receiptPath = path.join(directory, "receipt.json")
  const receiptInfo = await lstat(receiptPath)
  if (!receiptInfo.isFile() || receiptInfo.size > 64 * 1024) throw new Error("桌面升级签名证明无效")
  const { target, proof } = JSON.parse(await readFile(receiptPath, "utf8")) as {
    target?: { profileId: string; channel: string; component: string; version: string; digest: string }
    proof?: unknown
  }
  // 在打包后的 Next.js 进程中按部署提供的绝对路径加载原生 CJS 验证器。
  const runtimeRequire = process.getBuiltinModule("module").createRequire(path.join(process.cwd(), "package.json"))
  const verifier = runtimeRequire(verifierPath) as Verifier
  const { selectedProfile } = runtimeRequire(path.join(path.dirname(verifierPath), "update-settings.cjs")) as {
    selectedProfile: (root: string) => { profile: Profile; channel: string }
  }
  // 信任根来自桌面持久化配置，而不是升级请求或证明包。
  const { profile, channel } = selectedProfile(root)
  if (!target || target.profileId !== profile.id || target.channel !== channel || target.component !== "server" ||
      typeof target.version !== "string" || !SHA256.test(target.digest)) throw new Error("升级来源与当前信任设置不符")
  const { bytes, signature } = verifier.decodeProof(proof)
  const { manifest, digest } = verifier.verifyManifest(bytes, signature, profile, { channel, component: "server", version: target.version })
  if (digest !== target.digest) throw new Error("升级清单与确认的 SHA-256 不符")
  if (verifier.compareVersions(panelVersion, manifest.compatibility.minPanelVersion) < 0) throw new Error("请先升级面板")
  const asset = manifest.assets.source
  return { asset, file: path.join(directory, asset.fileName), version: manifest.version,
    minAgentVersion: manifest.compatibility.minAgentVersion, compareVersions: verifier.compareVersions }
}

export async function copyVerifiedLocalAsset({ file, asset }: LocalRelease, destination: string) {
  const info = await lstat(file)
  if (!info.isFile() || info.size !== asset.sizeBytes) throw new Error("本机升级制品大小不符")
  const hash = createHash("sha256")
  let bytes = 0
  try {
    await pipeline(createReadStream(file), new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        if (bytes > asset.sizeBytes) return callback(new Error("本机升级制品超过签名大小"))
        hash.update(chunk)
        callback(null, chunk)
      },
    }), createWriteStream(destination, { flags: "wx", mode: 0o600 }))
    if (bytes !== asset.sizeBytes || hash.digest("hex") !== asset.sha256) throw new Error("本机升级制品大小或 SHA-256 不符")
  } catch (error) {
    await rm(destination, { force: true })
    throw error
  }
}
