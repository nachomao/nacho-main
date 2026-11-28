"use strict"

// 同一份 v5 验证器随发布机、面板和控制服务端独立部署。只认固定 GitHub 制品路径。
const { createHash, createPublicKey, verify } = require("node:crypto")

const MAX_MANIFEST_BYTES = 32 * 1024
const MAX_UNLOCK_BYTES = 1024 * 1024
const MAX_ASSET_BYTES = 2 * 1024 ** 3 - 1
const CHANNELS = Object.freeze(["stable", "beta", "alpha"])
const COMPONENTS = Object.freeze(["panel", "server"])
const PRODUCT_FILES = Object.freeze({ manifest: "nacho-release.json", signature: "nacho-release.json.sig" })
const UNLOCK_FILES = Object.freeze({ manifest: "nacho-unlock.json", signature: "nacho-unlock.json.sig", key: "nacho-unlock.key", sealed: "nacho-unlock.age" })
const OFFICIAL_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA2qjcjfU4N2/nMmD9XkemMqqq6P0K6OVfjAnwlBJDU1g=\n-----END PUBLIC KEY-----\n"
const OFFICIAL_SOURCES = Object.freeze({ panel: "nachomao/nacho-main", server: "nachomao/nacho-server" })
const OFFICIAL_REPOS = Object.freeze({
  stable: OFFICIAL_SOURCES,
  beta: Object.freeze({ panel: "nachomao/nacho-beta", server: "nachomao/nacho-beta" }),
  alpha: Object.freeze({ panel: "nachomao/nacho-alpha", server: "nachomao/nacho-alpha" }),
})
const OFFICIAL_PROFILE = Object.freeze({ id: "official", publicKey: OFFICIAL_KEY, sourceRepositories: OFFICIAL_SOURCES, repositories: OFFICIAL_REPOS })

function check(condition, message) {
  if (!condition) throw new Error(message)
}
function record(value, required, optional = []) {
  check(value && typeof value === "object" && !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key)), "签名数据字段无效")
  return value
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}
function repository(value) {
  check(typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/i.test(value), "GitHub 仓库格式无效")
  const name = value.split("/")[1]
  check(name !== "." && name !== "..", "GitHub 仓库格式无效")
  return value.toLowerCase()
}
function publicKey(value) {
  if (value?.type === "public") {
    check(value.asymmetricKeyType === "ed25519", "发布公钥必须是 Ed25519")
    return value
  }
  check(typeof value === "string" && value.length < 256 &&
    /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----(?:\r?\n)?$/.test(value.trim()), "发布公钥格式无效")
  const key = createPublicKey(value)
  check(key.asymmetricKeyType === "ed25519", "发布公钥必须是 Ed25519")
  return key
}
function fingerprint(key) {
  return sha256(publicKey(key).export({ type: "spki", format: "der" }))
}
function validateProfile(input) {
  check(input && typeof input.id === "string" && /^[a-z0-9][a-z0-9-]{0,31}$/.test(input.id), "更新来源配置名无效")
  const normalized = {
    id: input.id,
    publicKey: publicKey(input.publicKey).export({ type: "spki", format: "pem" }),
    sourceRepositories: Object.fromEntries(COMPONENTS.map((c) => [c, repository(input.sourceRepositories?.[c])])),
    repositories: Object.fromEntries(CHANNELS.map((ch) => [ch,
      Object.fromEntries(COMPONENTS.map((c) => [c, repository(input.repositories?.[ch]?.[c])]))])),
  }
  if (input.label !== undefined) {
    check(typeof input.label === "string" && input.label.trim() && input.label.length <= 80 && !/[\u0000-\u001f\u007f]/.test(input.label), "更新来源名称无效")
    normalized.label = input.label.trim()
  }
  if (normalized.id === "official") {
    check(normalized.publicKey === OFFICIAL_KEY &&
      JSON.stringify(normalized.repositories) === JSON.stringify(OFFICIAL_REPOS) &&
      JSON.stringify(normalized.sourceRepositories) === JSON.stringify(OFFICIAL_SOURCES), "官方更新来源不得覆盖")
  }
  return normalized
}
function version(value) {
  check(typeof value === "string" && value.length <= 48 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) &&
    value.split(".").every((n) => Number.isSafeInteger(Number(n))), "版本号无效")
  return value
}
function compareVersions(left, right) {
  const a = version(left).split(".").map(Number), b = version(right).split(".").map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  return 0
}
function releaseTag(channel, component, releaseVersion, profile = OFFICIAL_PROFILE) {
  check(CHANNELS.includes(channel) && COMPONENTS.includes(component), "发布频道或组件无效")
  version(releaseVersion)
  return channel === "stable" && profile.id === "official" ? "v" + releaseVersion :
    channel + "-" + component + "-v" + releaseVersion
}
function unlockTag(manifest, batch) {
  check(CHANNELS.includes(manifest.channel) && COMPONENTS.includes(manifest.component), "解锁频道或组件无效")
  version(manifest.version)
  check(Number.isInteger(batch) && batch >= 1 && batch <= 101, "解锁批次无效")
  return "unlock-" + manifest.channel + "-" + manifest.component + "-v" + manifest.version + "-b" + String(batch).padStart(3, "0")
}
function assetNames(component, v) {
  version(v)
  if (component === "panel") return { installer: "NachoPanel-Setup-" + v + ".exe" }
  check(component === "server", "发布组件无效")
  return { source: "nacho-server-source-" + v + ".tar.gz", agent: "nacho-agent-" + v + "-win-x64.exe" }
}
function metadata(asset, name, limit, optional = []) {
  record(asset, ["fileName", "sizeBytes", "sha256"], optional)
  check(asset.fileName === name && Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes > 0 && asset.sizeBytes <= limit &&
    typeof asset.sha256 === "string" && /^[a-f0-9]{64}$/.test(asset.sha256), "制品名称、大小或 SHA-256 无效")
}
function assertAssetBytes(asset, bytes) {
  check(Buffer.isBuffer(bytes) && asset.sizeBytes === bytes.length && asset.sha256 === sha256(bytes), "制品大小或 SHA-256 不符")
  return bytes
}
function exactSignature(bytes, signature, key) {
  check(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_MANIFEST_BYTES &&
    Buffer.isBuffer(signature) && signature.length === 64 &&
    verify(null, bytes, publicKey(key), signature), "发布签名无效")
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) }
  catch { throw new Error("签名 JSON 无效") }
}
function verifyManifest(bytes, signature, profile = OFFICIAL_PROFILE, expected = {}) {
  const trust = validateProfile(profile)
  const manifest = record(exactSignature(bytes, signature, trust.publicKey),
    ["schemaVersion", "channel", "component", "version", "source", "release", "access", "title", "notes", "compatibility", "assets"], ["authenticodeThumbprint"])
  const { channel, component, access, source, release, compatibility, assets } = manifest
  check((manifest.schemaVersion === 5 || manifest.schemaVersion === 6) && CHANNELS.includes(channel) && COMPONENTS.includes(component), "发布协议、频道或组件无效")
  const v = version(manifest.version)
  check(access === "public" || (access === "key" && channel !== "stable"), "发布密钥策略无效")
  record(source, ["repository", "commit"])
  record(release, ["repository", "tag"])
  check(repository(source.repository) === trust.sourceRepositories[component] &&
    typeof source.commit === "string" && /^[a-f0-9]{40}$/.test(source.commit), "发布源码来源不匹配")
  check(repository(release.repository) === trust.repositories[channel][component] &&
    release.tag === releaseTag(channel, component, v, trust), "制品仓库或发布标签不匹配")
  check((expected.channel === undefined || expected.channel === channel) &&
    (expected.component === undefined || expected.component === component) &&
    (expected.version === undefined || expected.version === v) &&
    (expected.repository === undefined || repository(expected.repository) === repository(release.repository)) &&
    (expected.tag === undefined || expected.tag === release.tag), "发布清单与所选目标不匹配")
  check(typeof manifest.title === "string" && manifest.title.trim() && manifest.title.length <= 120 && !/[\u0000-\u001f\u007f]/.test(manifest.title) &&
    typeof manifest.notes === "string" && manifest.notes.trim() && manifest.notes.length <= 8000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(manifest.notes), "发布公告无效")
  if (manifest.authenticodeThumbprint !== undefined) {
    check(component === "panel" && typeof manifest.authenticodeThumbprint === "string" &&
      /^[A-F0-9]{40}$/.test(manifest.authenticodeThumbprint), "面板证书指纹无效")
  }
  const minima = ["minPanelVersion", "minServerVersion", "minAgentVersion"]
  record(compatibility, minima)
  for (const key of minima) version(compatibility[key])
  const names = assetNames(component, v)
  record(assets, Object.keys(names))
  const isV6 = manifest.schemaVersion === 6
  const encrypted = isV6 ? access === "key" : (channel === "alpha" || access === "key")
  for (const [id, name] of Object.entries(names)) {
    const a = assets[id]
    metadata(a, name, MAX_ASSET_BYTES, encrypted ? ["encrypted"] : [])
    if (encrypted) {
      if (isV6) {
        metadata(a.encrypted, name + ".nachoenc", MAX_ASSET_BYTES, ["cipher"])
        check(a.encrypted.cipher === "nacho-aes-256-gcm-v1", "受控版本信封加密算法无效")
      } else {
        metadata(a.encrypted, name + ".age", MAX_ASSET_BYTES)
      }
    }
  }
  return { manifest, digest: sha256(bytes), signerFingerprint: fingerprint(trust.publicKey), official: trust.id === "official" }
}
function verifyUnlock(bytes, signature, verified, profile = OFFICIAL_PROFILE) {
  const trust = validateProfile(profile)
  const m = verified.manifest
  check(verified.signerFingerprint === fingerprint(trust.publicKey), "解锁签名公钥不匹配")
  const u = record(exactSignature(bytes, signature, trust.publicKey),
    ["schemaVersion", "channel", "component", "version", "manifestSha256", "batch", "access", "keyFile"])
  check(u.schemaVersion === 5 && (m.channel === "alpha" || m.access === "key") &&
    u.channel === m.channel && u.component === m.component && u.version === m.version &&
    u.manifestSha256 === verified.digest && u.access === m.access &&
    Number.isInteger(u.batch) && u.batch >= 1 && u.batch <= (m.channel === "alpha" && m.access === "key" ? 101 : 1),
    "解锁包与已验签发布或批次不匹配")
  metadata(u.keyFile, u.access === "key" ? UNLOCK_FILES.sealed : UNLOCK_FILES.key,
    u.access === "key" ? MAX_UNLOCK_BYTES : 256)
  return u
}
function downloadUrl(repo, tag, name) {
  const remote = repository(repo)
  check(typeof tag === "string" && /^[a-z0-9][a-z0-9.-]{0,127}$/.test(tag) &&
    typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$/.test(name), "GitHub 制品路径无效")
  return "https://github.com/" + remote + "/releases/download/" + tag + "/" + name
}
function assetUrl(manifest, asset) {
  return downloadUrl(manifest.release.repository, manifest.release.tag, (asset.encrypted ?? asset).fileName)
}
function decodeProof(proof) {
  record(proof, ["manifest", "signature"])
  const decode = (value, limit) => {
    check(typeof value === "string" && value.length > 0 && value.length <= 4 * Math.ceil(limit / 3) &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value), "发布证明编码无效")
    const bytes = Buffer.from(value, "base64")
    check(bytes.length <= limit && bytes.toString("base64") === value, "发布证明编码无效")
    return bytes
  }
  return { bytes: decode(proof.manifest, MAX_MANIFEST_BYTES), signature: decode(proof.signature, 64) }
}

exports.OFFICIAL_PROFILE = OFFICIAL_PROFILE
exports.CHANNELS = CHANNELS
exports.COMPONENTS = COMPONENTS
exports.PRODUCT_FILES = PRODUCT_FILES
exports.UNLOCK_FILES = UNLOCK_FILES
exports.MAX_MANIFEST_BYTES = MAX_MANIFEST_BYTES
exports.MAX_UNLOCK_BYTES = MAX_UNLOCK_BYTES
exports.MAX_ASSET_BYTES = MAX_ASSET_BYTES
exports.validateProfile = validateProfile
exports.verifyManifest = verifyManifest
exports.verifyUnlock = verifyUnlock
exports.decodeProof = decodeProof
exports.releaseTag = releaseTag
exports.unlockTag = unlockTag
exports.assetNames = assetNames
exports.assetUrl = assetUrl
exports.downloadUrl = downloadUrl
exports.assertAssetBytes = assertAssetBytes
exports.compareVersions = compareVersions
exports.fingerprint = fingerprint
exports.repository = repository
exports.sha256 = sha256
