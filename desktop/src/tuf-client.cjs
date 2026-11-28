"use strict"

// 面板与自动化测试共用的 TUF 客户端验签 + 设备自动认证领钥 + 本地信封解密状态机。
// 遵循 TUF 1.0 角色分离验证链路：root（链式轮换跟随）→ timestamp → snapshot → targets → 发布者离线签名。
const { createPublicKey, randomBytes, randomUUID, verify } = require("node:crypto")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const path = require("node:path")
const {
  canonicalJson, decryptFileEnvelope, sha256Hex, signHttpRequest, unwrapDekWithPrivateKey,
} = require("./envelope-crypto.cjs")
const { decodeProof, verifyManifest } = require("./release-manifest.cjs")

const MAX_ROOT_HOPS = 64
const MAX_META_BYTES = 512 * 1024

class TufVerificationError extends Error {
  constructor(message, code = "TUF_VERIFICATION_FAILED") {
    super(message)
    this.code = code
  }
}

class KeyClaimError extends Error {
  constructor(message, code = "KEY_CLAIM_DENIED", status = 403) {
    super(message)
    this.code = code
    this.status = status
  }
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(tmp, content, { flag: "wx", mode: 0o600 })
    fs.renameSync(tmp, file)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

function readCachedJson(file) {
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > MAX_META_BYTES) return null
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

function verifyRoleEnvelope(envelope, expectedType, rootSigned) {
  if (!envelope || typeof envelope !== "object" || !envelope.signed || !Array.isArray(envelope.signatures)) {
    throw new TufVerificationError(`TUF ${expectedType} 元数据格式无效`, "TUF_MALFORMED")
  }
  const { signed, signatures } = envelope
  if (signed._type !== expectedType || !Number.isSafeInteger(signed.version) || signed.version < 1) {
    throw new TufVerificationError(`TUF ${expectedType} 角色类型或版本无效`, "TUF_BAD_TYPE")
  }
  const roleDef = rootSigned?.roles?.[expectedType]
  if (!roleDef || !Array.isArray(roleDef.keyids) || !Number.isSafeInteger(roleDef.threshold) || roleDef.threshold < 1) {
    throw new TufVerificationError(`TUF root 缺少角色定义：${expectedType}`, "TUF_MISSING_ROLE")
  }
  const revoked = new Set((rootSigned.revoked_keyids || []).map((entry) => entry.keyid))
  const allowed = new Set(roleDef.keyids.filter((id) => !revoked.has(id)))
  const payload = canonicalJson(signed)
  const validSigners = new Set()
  for (const sigEntry of signatures) {
    if (!sigEntry || typeof sigEntry.keyid !== "string" || typeof sigEntry.sig !== "string") continue
    if (!allowed.has(sigEntry.keyid) || validSigners.has(sigEntry.keyid)) continue
    const keyMeta = rootSigned.keys?.[sigEntry.keyid]
    if (!keyMeta || keyMeta.keytype !== "ed25519" || typeof keyMeta.keyval?.public !== "string") continue
    try {
      const sigBytes = Buffer.from(sigEntry.sig, "base64")
      if (sigBytes.length !== 64) continue
      if (verify(null, payload, createPublicKey(keyMeta.keyval.public), sigBytes)) {
        validSigners.add(sigEntry.keyid)
      }
    } catch { /* 忽略格式错误签名，继续统计有效签名数 */ }
  }
  if (validSigners.size < roleDef.threshold) {
    throw new TufVerificationError(`TUF ${expectedType} 验签失败（有效签名不足）`, "TUF_BAD_SIGNATURE")
  }
  return envelope
}

function checkNotExpired(signed, role, now) {
  const expires = Date.parse(signed.expires)
  if (!Number.isFinite(expires) || expires <= now) {
    throw new TufVerificationError(`TUF ${role} 元数据已过期`, "TUF_EXPIRED")
  }
}

function normalizeOrigin(origin) {
  const value = String(origin || "").trim().replace(/\/+$/, "")
  if (!/^https?:\/\/[^/\s]+$/i.test(value)) throw new Error("更新服务器地址无效")
  return value
}

/**
 * 创建 TUF + 信封加密客户端。
 * @param {{
 *   origin: string,
 *   pinnedRoot: object,
 *   cacheDir: string,
 *   deviceIdentity?: { deviceId: string, auth: { publicKey: string, privateKey: string }, encryption: { publicKey: string, privateKey: string } },
 *   fetcher?: typeof fetch,
 *   clock?: () => number,
 * }} options
 */
function createTufClient({
  origin, pinnedRoot, cacheDir, deviceIdentity = null, fetcher = (...args) => fetch(...args), clock = Date.now,
}) {
  const baseOrigin = normalizeOrigin(origin)
  const rootCache = path.join(cacheDir, "tuf-root.json")
  const timestampCache = path.join(cacheDir, "tuf-timestamp.json")
  const snapshotCache = path.join(cacheDir, "tuf-snapshot.json")
  const targetsCache = path.join(cacheDir, "tuf-targets.json")

  function initialRoot() {
    if (!pinnedRoot?.signed || pinnedRoot.signed._type !== "root") {
      throw new TufVerificationError("缺少内置初始 TUF 根元数据", "TUF_NO_PINNED_ROOT")
    }
    verifyRoleEnvelope(pinnedRoot, "root", pinnedRoot.signed)
    const cached = readCachedJson(rootCache)
    if (cached?.signed?._type === "root" && cached.signed.version >= pinnedRoot.signed.version) {
      try {
        verifyRoleEnvelope(cached, "root", cached.signed)
        return cached
      } catch { /* 本地缓存损坏时回退内置根 */ }
    }
    return pinnedRoot
  }

  async function fetchRaw(requestPath, { allowMissing = false } = {}) {
    const response = await fetcher(`${baseOrigin}${requestPath}`, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { "User-Agent": "Nacho-TUF-Client" },
    })
    if (allowMissing && response.status === 404) {
      await response.body?.cancel?.().catch(() => {})
      return null
    }
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {})
      throw new TufVerificationError(`拉取 ${requestPath} 失败（HTTP ${response.status}）`, "TUF_FETCH_FAILED")
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_META_BYTES) {
      throw new TufVerificationError(`元数据大小超限：${requestPath}`, "TUF_SIZE_LIMIT")
    }
    return bytes
  }

  async function updateRoot() {
    let current = initialRoot()
    const startingRoot = current
    for (let hops = 0; hops < MAX_ROOT_HOPS; hops++) {
      const nextVersion = current.signed.version + 1
      const bytes = await fetchRaw(`/v1/tuf/${nextVersion}.root.json`, { allowMissing: true })
      if (!bytes) break
      let nextRoot
      try { nextRoot = JSON.parse(bytes.toString("utf8")) } catch {
        throw new TufVerificationError(`root v${nextVersion} JSON 无效`, "TUF_MALFORMED")
      }
      if (nextRoot?.signed?.version !== nextVersion) {
        throw new TufVerificationError(`root 版本不连续：期望 ${nextVersion}`, "TUF_ROOT_CHAIN_BROKEN")
      }
      // 必须同时通过旧根与新根的门限验签（TUF §5.3.4 / §5.3.5）。
      verifyRoleEnvelope(nextRoot, "root", current.signed)
      verifyRoleEnvelope(nextRoot, "root", nextRoot.signed)
      current = nextRoot
      atomicWrite(rootCache, bytes)
    }
    checkNotExpired(current.signed, "root", clock())
    // 若角色密钥发生轮换，清空下级版本缓存以便平滑跟随新角色密钥。
    const keysChanged = ["timestamp", "snapshot", "targets"].some((role) =>
      JSON.stringify(startingRoot.signed.roles?.[role]?.keyids) !== JSON.stringify(current.signed.roles?.[role]?.keyids),
    )
    if (keysChanged) {
      for (const file of [timestampCache, snapshotCache, targetsCache]) fs.rmSync(file, { force: true })
    }
    return current
  }

  async function syncMetadata() {
    const now = clock()
    const root = await updateRoot()

    // 1. 拉取并验签 timestamp.json
    const tsBytes = await fetchRaw("/v1/tuf/timestamp.json")
    let timestamp
    try { timestamp = JSON.parse(tsBytes.toString("utf8")) } catch {
      throw new TufVerificationError("timestamp.json 格式无效", "TUF_MALFORMED")
    }
    verifyRoleEnvelope(timestamp, "timestamp", root.signed)
    const cachedTs = readCachedJson(timestampCache)
    if (cachedTs?.signed?.version > timestamp.signed.version) {
      throw new TufVerificationError("检测到 timestamp 版本回滚", "TUF_ROLLBACK")
    }
    checkNotExpired(timestamp.signed, "timestamp", now)
    const expectedSnap = timestamp.signed.meta?.["snapshot.json"]
    if (!expectedSnap || !Number.isSafeInteger(expectedSnap.version) || !expectedSnap.hashes?.sha256) {
      throw new TufVerificationError("timestamp 缺少 snapshot 摘要", "TUF_MALFORMED")
    }

    // 2. 拉取并核对 snapshot.json 的长度、SHA-256 与签名
    const snapBytes = await fetchRaw(`/v1/tuf/${expectedSnap.version}.snapshot.json`)
    if (snapBytes.length !== expectedSnap.length || sha256Hex(snapBytes) !== expectedSnap.hashes.sha256) {
      throw new TufVerificationError("snapshot.json 已被篡改（哈希或长度与 timestamp 不符）", "TUF_HASH_MISMATCH")
    }
    let snapshot
    try { snapshot = JSON.parse(snapBytes.toString("utf8")) } catch {
      throw new TufVerificationError("snapshot.json 格式无效", "TUF_MALFORMED")
    }
    verifyRoleEnvelope(snapshot, "snapshot", root.signed)
    if (snapshot.signed.version !== expectedSnap.version) {
      throw new TufVerificationError("snapshot 版本与 timestamp 不符", "TUF_VERSION_MISMATCH")
    }
    const cachedSnap = readCachedJson(snapshotCache)
    if (cachedSnap?.signed?.version > snapshot.signed.version) {
      throw new TufVerificationError("检测到 snapshot 版本回滚", "TUF_ROLLBACK")
    }
    checkNotExpired(snapshot.signed, "snapshot", now)
    const expectedTargets = snapshot.signed.meta?.["targets.json"]
    if (!expectedTargets || !Number.isSafeInteger(expectedTargets.version) || !expectedTargets.hashes?.sha256) {
      throw new TufVerificationError("snapshot 缺少 targets 摘要", "TUF_MALFORMED")
    }

    // 3. 拉取并核对 targets.json 的长度、SHA-256 与签名
    const targetsBytes = await fetchRaw(`/v1/tuf/${expectedTargets.version}.targets.json`)
    if (targetsBytes.length !== expectedTargets.length || sha256Hex(targetsBytes) !== expectedTargets.hashes.sha256) {
      throw new TufVerificationError("targets.json 已被篡改（哈希或长度与 snapshot 不符）", "TUF_HASH_MISMATCH")
    }
    let targets
    try { targets = JSON.parse(targetsBytes.toString("utf8")) } catch {
      throw new TufVerificationError("targets.json 格式无效", "TUF_MALFORMED")
    }
    verifyRoleEnvelope(targets, "targets", root.signed)
    if (targets.signed.version !== expectedTargets.version) {
      throw new TufVerificationError("targets 版本与 snapshot 不符", "TUF_VERSION_MISMATCH")
    }
    const cachedTargets = readCachedJson(targetsCache)
    if (cachedTargets?.signed?.version > targets.signed.version) {
      throw new TufVerificationError("检测到 targets 版本回滚", "TUF_ROLLBACK")
    }
    checkNotExpired(targets.signed, "targets", now)

    atomicWrite(timestampCache, tsBytes)
    atomicWrite(snapshotCache, snapBytes)
    atomicWrite(targetsCache, targetsBytes)
    return { root, timestamp, snapshot, targets }
  }

  async function signedDevicePost(requestPath, payload) {
    if (!deviceIdentity?.deviceId || !deviceIdentity?.auth?.privateKey) {
      throw new KeyClaimError("设备身份未初始化", "NO_DEVICE_IDENTITY", 401)
    }
    const bodyBytes = Buffer.from(JSON.stringify(payload), "utf8")
    const timestamp = String(clock())
    const nonce = randomBytes(16).toString("hex")
    const signature = signHttpRequest({
      method: "POST",
      path: requestPath,
      timestamp,
      nonce,
      bodyBytes,
      privateKey: deviceIdentity.auth.privateKey,
    })
    const response = await fetcher(`${baseOrigin}${requestPath}`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Nacho-TUF-Client",
        "X-Nacho-Device-Id": deviceIdentity.deviceId,
        "X-Nacho-Timestamp": timestamp,
        "X-Nacho-Nonce": nonce,
        "X-Nacho-Signature": signature,
      },
      body: bodyBytes,
    })
    const raw = await response.text()
    let parsed = null
    try { parsed = JSON.parse(raw) } catch { /* 非 JSON 响应按错误处理 */ }
    if (!response.ok || parsed?.ok !== true) {
      throw new KeyClaimError(
        parsed?.error || `设备请求失败（HTTP ${response.status}）`,
        parsed?.code || (response.status === 401 ? "DEVICE_AUTH_FAILED" : "KEY_CLAIM_DENIED"),
        response.status,
      )
    }
    return parsed.data
  }

  async function registerDevice({ channel = "stable", platform = process.platform, appVersion = "0.0.0", label = "" } = {}) {
    return signedDevicePost("/v1/devices/register", {
      deviceId: deviceIdentity.deviceId,
      authPublicKey: deviceIdentity.auth.publicKey,
      encPublicKey: deviceIdentity.encryption.publicKey,
      channel,
      platform,
      appVersion,
      ...(label ? { label } : {}),
    })
  }

  function verifyGrantSignature(grantResponse, rootSigned, expectedReleaseId) {
    const { grant, signature } = grantResponse || {}
    if (!grant || !signature || typeof signature.keyid !== "string" || typeof signature.sig !== "string") {
      throw new TufVerificationError("密钥授权回执缺少有效签名", "GRANT_SIGNATURE_MISSING")
    }
    const roleDef = rootSigned.roles?.targets
    const revoked = new Set((rootSigned.revoked_keyids || []).map((entry) => entry.keyid))
    if (!roleDef?.keyids?.includes(signature.keyid) || revoked.has(signature.keyid)) {
      throw new TufVerificationError("密钥授权回执签名密钥不受信任或已吊销", "GRANT_KEY_UNTRUSTED")
    }
    const keyMeta = rootSigned.keys?.[signature.keyid]
    if (!keyMeta?.keyval?.public) throw new TufVerificationError("找不到授权回执签名公钥", "GRANT_KEY_MISSING")
    const ok = verify(null, canonicalJson(grant), createPublicKey(keyMeta.keyval.public), Buffer.from(signature.sig, "base64"))
    if (!ok) throw new TufVerificationError("密钥授权回执签名校验失败", "GRANT_BAD_SIGNATURE")
    if (grant.deviceId !== deviceIdentity.deviceId || grant.releaseId !== expectedReleaseId || grant.manifestSha256 !== expectedReleaseId) {
      throw new TufVerificationError("密钥授权回执与设备或版本不匹配", "GRANT_BINDING_MISMATCH")
    }
    const expiresAt = Date.parse(grant.expiresAt)
    if (!Number.isFinite(expiresAt) || expiresAt <= clock()) {
      throw new TufVerificationError("密钥授权回执已过期", "GRANT_EXPIRED")
    }
    return grant
  }

  async function claimDek(targetEntry, syncedMeta) {
    const revokedDevices = syncedMeta.targets.signed.revoked_devices || []
    if (deviceIdentity && revokedDevices.some((entry) => entry.deviceId === deviceIdentity.deviceId)) {
      throw new KeyClaimError("该设备已被吊销，停止分发密钥并拒绝更新", "DEVICE_REVOKED", 403)
    }
    const grantResponse = await signedDevicePost(targetEntry.keyGrantEndpoint || "/v1/keys/claim", {
      releaseId: targetEntry.releaseId,
      channel: targetEntry.channel,
      component: targetEntry.component,
      version: targetEntry.version,
    })
    const grant = verifyGrantSignature(grantResponse, syncedMeta.root.signed, targetEntry.releaseId)
    const expectedAad = {
      releaseId: grant.releaseId,
      manifestSha256: grant.manifestSha256,
      deviceId: deviceIdentity.deviceId,
      grantVersion: grant.grantVersion,
    }
    const dek = unwrapDekWithPrivateKey(grant.wrappedDek, deviceIdentity.encryption.privateKey, expectedAad)
    return { dek, grant }
  }

  async function checkRelease({ profileId = "official", channel = "stable", component = "panel" } = {}) {
    const meta = await syncMetadata()
    const key = `${profileId}/${channel}/${component}`
    const target = meta.targets.signed.targets?.[key] ?? null
    if (!target) return { status: "not-found", release: null, meta }
    const publisher = meta.root.signed.publishers?.[profileId]
    if (!publisher) throw new TufVerificationError(`TUF 根元数据未信任该发布来源：${profileId}`, "PUBLISHER_UNTRUSTED")
    // 纵深防御：同时校验离线发布者原始 Ed25519 清单签名。
    const proof = decodeProof(target.publisherProof)
    const verified = verifyManifest(proof.bytes, proof.signature, publisher, {
      channel,
      component,
      version: target.version,
      repository: target.release.repository,
      tag: target.release.tag,
    })
    if (verified.digest !== target.releaseId) {
      throw new TufVerificationError("TUF targets 中的 releaseId 与离线签名清单摘要不符", "MANIFEST_DIGEST_MISMATCH")
    }
    if (channel === "stable" && verified.manifest.access !== "public") {
      throw new TufVerificationError("Stable 渠道禁止密钥管控", "INVALID_CHANNEL_POLICY")
    }
    return { status: "available", release: target, verified, meta }
  }

  async function downloadAndVerifyUpdate({
    profileId = "official", channel = "stable", component = "panel", assetKey, outputPath, downloadAsset,
  }) {
    const checked = await checkRelease({ profileId, channel, component })
    if (checked.status !== "available" || !checked.release) {
      throw new TufVerificationError("当前频道暂无可用版本", "NO_RELEASE")
    }
    const { release, verified, meta } = checked
    const plainAsset = verified.manifest.assets[assetKey]
    if (!plainAsset) throw new TufVerificationError(`发布清单缺少制品：${assetKey}`, "MISSING_ASSET")
    const targetAsset = release.assets[assetKey]
    const url = targetAsset?.encrypted?.downloadUrl || targetAsset?.downloadUrl

    if (release.access === "public") {
      await downloadAsset(url, outputPath, plainAsset)
      const actual = await fsp.readFile(outputPath)
      if (actual.length !== plainAsset.sizeBytes || sha256Hex(actual) !== plainAsset.sha256) {
        await fsp.rm(outputPath, { force: true })
        throw new TufVerificationError("公开制品大小或 SHA-256 校验失败", "ASSET_HASH_MISMATCH")
      }
      return { release, verified, access: "public", outputPath }
    }

    // 受控版本：设备认证领钥 → 下载密文并验哈希 → 本地解包解密 → 核对明文哈希 → 清零 DEK。
    const { dek, grant } = await claimDek(release, meta)
    const cipherPath = `${outputPath}.${randomUUID()}.nachoenc`
    try {
      await downloadAsset(url, cipherPath, plainAsset.encrypted)
      const cipherStat = await fsp.stat(cipherPath)
      const cipherDigest = sha256Hex(await fsp.readFile(cipherPath))
      if (cipherStat.size !== plainAsset.encrypted.sizeBytes || cipherDigest !== plainAsset.encrypted.sha256) {
        throw new TufVerificationError("受控密文包大小或 SHA-256 校验失败", "CIPHER_HASH_MISMATCH")
      }
      const context = `${release.channel}:${release.component}:${release.version}:${plainAsset.fileName}`
      await decryptFileEnvelope(cipherPath, outputPath, dek, context, plainAsset)
      return { release, verified, access: "key", grantVersion: grant.grantVersion, outputPath }
    } finally {
      dek.fill(0)
      await fsp.rm(cipherPath, { force: true }).catch(() => {})
    }
  }

  return {
    updateRoot,
    syncMetadata,
    registerDevice,
    claimDek,
    checkRelease,
    downloadAndVerifyUpdate,
  }
}

module.exports = {
  TufVerificationError,
  KeyClaimError,
  verifyRoleEnvelope,
  createTufClient,
}
