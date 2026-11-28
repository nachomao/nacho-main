"use strict"

const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const {
  CHANNELS, COMPONENTS, PRODUCT_FILES, MAX_MANIFEST_BYTES,
  validateProfile, compareVersions, verifyManifest, decodeProof,
  downloadUrl, sha256,
} = require("./release-manifest.cjs")
const { createReleaseHttp, ReleaseNetworkError, ReleaseMissingError } = require("./release-http.cjs")
const { KeyClaimError } = require("./tuf-client.cjs")

const MAX_LIST_PAGES = 3
const PER_PAGE = 100
const MAX_LIST_BYTES = 8 * 1024 * 1024

class LockedReleaseError extends Error {}

function listedAsset(release, name, { exact, maximum = exact } = {}) {
  const items = Array.isArray(release.assets) ? release.assets.filter((item) => item?.name === name) : []
  if (items.length !== 1 || items[0].state !== "uploaded") throw new Error(`GitHub 发布缺少制品：${name}`)
  const { size } = items[0]
  if (!Number.isSafeInteger(size) || size < 1 || size > maximum || (exact !== undefined && size !== exact)) {
    throw new Error(`GitHub 发布制品大小不符：${name}`)
  }
  return size
}

function selectProduct(releases, profile, channel, component) {
  const prefix = channel === "stable" && profile.id === "official" ? "v" : `${channel}-${component}-v`
  const valid = new RegExp(`^${prefix}((?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*))$`)
  let latest = null
  for (const release of releases) {
    if (!release || release.draft !== false || (channel === "stable" && release.prerelease !== false)) continue
    const version = typeof release.tag_name === "string" && valid.exec(release.tag_name)?.[1]
    if (!version) continue
    compareVersions(version, version)
    if (!latest || compareVersions(version, latest.version) > 0) latest = { release, version }
  }
  return latest
}

function proofOf(bytes, signature) {
  return { manifest: bytes.toString("base64"), signature: signature.toString("base64") }
}

function publicRelease(verified, profile, publishedAt) {
  const { manifest, digest, signerFingerprint, official } = verified
  return {
    target: { profileId: profile.id, channel: manifest.channel, component: manifest.component, version: manifest.version, digest },
    repository: manifest.release.repository, sourceRepository: manifest.source.repository,
    tag: manifest.release.tag, title: manifest.title, notes: manifest.notes,
    compatibility: manifest.compatibility, access: manifest.access, signerFingerprint,
    official, publishedAt: typeof publishedAt === "string" && Number.isFinite(Date.parse(publishedAt)) ? publishedAt : null,
    sizeBytesByAsset: Object.fromEntries(Object.entries(manifest.assets).map(([key, asset]) => [key, asset.sizeBytes])),
  }
}

function createReleaseChecker({
  directory, http = createReleaseHttp(), fetcher, sleep,
  getDeviceIdentity = () => null, tufClientFactory = null,
} = {}) {
  if (fetcher) http = createReleaseHttp({ fetcher, sleep })
  function cachePath(profile, channel, component) {
    const profileDigest = sha256(JSON.stringify(profile))
    return path.join(directory, `github-v5-${profileDigest}-${channel}-${component}.json`)
  }
  function readCache(profile, channel, component) {
    try {
      const file = cachePath(profile, channel, component)
      if (fs.statSync(file).size > 64 * 1024) return null
      const { proof, publishedAt } = JSON.parse(fs.readFileSync(file, "utf8"))
      const { bytes, signature } = decodeProof(proof)
      return { verified: verifyManifest(bytes, signature, profile, { channel, component }), publishedAt }
    } catch { return null }
  }
  function pin(profile, channel, component, previous, verified, proof, publishedAt) {
    if (previous) {
      const order = compareVersions(verified.manifest.version, previous.verified.manifest.version)
      if (order < 0) throw new Error("GitHub 发布版本倒退")
      if (order === 0 && previous.verified.digest !== verified.digest) throw new Error("GitHub 同版本发布清单发生变化")
      if (order === 0) return
    }
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const file = cachePath(profile, channel, component)
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify({ proof, publishedAt }), { flag: "wx", mode: 0o600 })
      fs.renameSync(temporary, file)
    } finally { fs.rmSync(temporary, { force: true }) }
  }
  async function list(repository, signal) {
    const releases = []
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
      const url = `https://api.github.com/repos/${repository}/releases?per_page=${PER_PAGE}&page=${page}`
      let bytes
      try { bytes = await http.read(url, { type: "api", maximum: MAX_LIST_BYTES, signal }) } catch (error) {
        if (error instanceof ReleaseMissingError && page === 1) return []
        throw error
      }
      const batch = JSON.parse(bytes.toString("utf8"))
      if (!Array.isArray(batch) || batch.length > PER_PAGE) throw new Error("GitHub 发布列表响应无效")
      releases.push(...batch)
      if (batch.length < PER_PAGE) break
    }
    return releases
  }
  function readAsset(release, repository, name, maximum, signal, exact) {
    const listedSize = listedAsset(release, name, { maximum, exact })
    return http.read(downloadUrl(repository, release.tag_name, name), { maximum, exact: listedSize, signal })
  }

  async function resolveAutomaticDek(verified, profile, channel) {
    const { manifest, digest } = verified
    if (!Object.values(manifest.assets).some((asset) => asset.encrypted)) return null
    if (manifest.access === "public") return null
    if (!tufClientFactory) {
      throw new LockedReleaseError("受控版本需要设备自动向更新服务器领取内容密钥，当前设备尚未授权")
    }
    const deviceIdentity = await getDeviceIdentity()
    const client = tufClientFactory({ profile, channel, deviceIdentity })
    try {
      const synced = await client.syncMetadata()
      const targetEntry = {
        releaseId: digest,
        channel: manifest.channel,
        component: manifest.component,
        version: manifest.version,
        keyGrantEndpoint: "/v1/keys/claim",
      }
      const { dek } = await client.claimDek(targetEntry, synced)
      return dek
    } catch (error) {
      if (error instanceof KeyClaimError) {
        throw new LockedReleaseError(error.message)
      }
      throw error
    }
  }

  async function candidate(profile, channel, component, getList, signal) {
    const previous = readCache(profile, channel, component)
    const repository = profile.repositories[channel][component]
    const releases = await getList(repository)
    const match = selectProduct(releases, profile, channel, component)
    if (!match) {
      if (previous) throw new Error("此前验证的 GitHub 发布已撤回")
      return null
    }
    const { release, version } = match
    const [bytes, signature] = await Promise.all([
      readAsset(release, repository, PRODUCT_FILES.manifest, MAX_MANIFEST_BYTES, signal),
      readAsset(release, repository, PRODUCT_FILES.signature, 64, signal, 64),
    ])
    const verified = verifyManifest(bytes, signature, profile, { channel, component, repository, version, tag: release.tag_name })
    for (const asset of Object.values(verified.manifest.assets)) {
      const file = asset.encrypted ?? asset
      listedAsset(release, file.fileName, { exact: file.sizeBytes })
    }
    const proof = proofOf(bytes, signature)
    pin(profile, channel, component, readCache(profile, channel, component) ?? previous, verified, proof, release.published_at)
    return { verified, proof, releases, repository, release: publicRelease(verified, profile, release.published_at) }
  }
  function begin(profile, channel) {
    profile = validateProfile(profile)
    if (!CHANNELS.includes(channel)) throw new Error("更新频道无效")
    const signal = AbortSignal.timeout(90_000)
    const lists = new Map()
    function getList(repository) {
      if (!lists.has(repository)) lists.set(repository, list(repository, signal))
      return lists.get(repository)
    }
    return { profile, signal, getList }
  }
  async function check(profile, channel) {
    const request = begin(profile, channel)
    const { signal, getList } = request
    const results = await Promise.all(COMPONENTS.map(async (component) => {
      let result
      try {
        result = await candidate(request.profile, channel, component, getList, signal)
        if (!result) return [component, { status: "not-found", release: null }]
        const dek = await resolveAutomaticDek(result.verified, request.profile, channel)
        if (Buffer.isBuffer(dek)) dek.fill(0)
        return [component, { status: "available", release: result.release }]
      } catch (error) {
        if (error instanceof LockedReleaseError && result) {
          return [component, { status: "locked", release: result.release, message: error.message }]
        }
        if (error instanceof ReleaseNetworkError || signal.aborted) {
          const cached = readCache(request.profile, channel, component)
          if (cached) return [component, { status: "stale",
            release: publicRelease(cached.verified, request.profile, cached.publishedAt),
            message: "GitHub 网络不可用；缓存仅供查看" }]
        }
        return [component, { status: "error", release: null, message: error.message || "GitHub 发布验证失败" }]
      }
    }))
    return { components: Object.fromEntries(results), checkedAt: new Date().toISOString() }
  }
  async function confirm(profile, channel, component, target) {
    const request = begin(profile, channel)
    if (!COMPONENTS.includes(component) || target?.profileId !== request.profile.id || target?.channel !== channel ||
        target?.component !== component || typeof target?.version !== "string" || !/^[a-f0-9]{64}$/.test(target?.digest)) {
      throw new Error("更新选择已失效，请重新检查并确认")
    }
    const result = await candidate(request.profile, channel, component, request.getList, request.signal)
    if (!result || result.release.target.version !== target.version || result.release.target.digest !== target.digest) {
      throw new Error("GitHub 发布已变化，请重新检查并确认")
    }
    const dek = await resolveAutomaticDek(result.verified, request.profile, channel)
    return { ...result.verified, proof: result.proof, dek }
  }
  return { check, confirm }
}

module.exports = { createReleaseChecker }
