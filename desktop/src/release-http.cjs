"use strict"

const { createHash } = require("node:crypto")
const { createWriteStream } = require("node:fs")
const fs = require("node:fs/promises")
const { Transform } = require("node:stream")
const { pipeline } = require("node:stream/promises")

const ASSET_HOSTS = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"])
const REDIRECTS = new Set([301, 302, 303, 307, 308])

class ReleaseNetworkError extends Error {}
class ReleaseMissingError extends Error {}

function githubUrl(value, hosts) {
  let url
  try { url = new URL(value) } catch { /* 地址解析失败 */ }
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port ||
      !hosts.has(url.hostname) || url.hash) throw new Error("GitHub 发布响应跳转到未授权地址")
  return url
}

function createReleaseHttp({
  fetcher = (...args) => fetch(...args),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  async function request(raw, type, signal) {
    const hosts = type === "api" ? new Set(["api.github.com"]) : ASSET_HOSTS
    let url = githubUrl(raw, new Set([type === "api" ? "api.github.com" : "github.com"]))
    for (let hops = 0; hops <= 3; hops++) {
      let response
      try {
        response = await fetcher(url.href, {
          method: "GET", credentials: "omit", redirect: "manual", cache: "no-store", signal,
          headers: { "User-Agent": "NachoPanel", Accept: type === "api" ? "application/vnd.github+json" : "application/octet-stream",
            ...(type === "api" ? { "X-GitHub-Api-Version": "2022-11-28" } : {}) },
        })
      } catch {
        throw new ReleaseNetworkError("GitHub 发布网络不可用或连接超时")
      }
      if (REDIRECTS.has(response.status)) {
        const location = response.headers.get("location")
        await response.body?.cancel().catch(() => {})
        // API 仓库更名/转移不能悄悄重定向到另一个来源。只允许制品走 GitHub CDN。
        if (type !== "asset" || !location) throw new Error("GitHub 发布 API 返回未授权跳转")
        url = githubUrl(new URL(location, url), hosts)
        continue
      }
      if (response.ok && response.status === 200 && response.body) return response
      await response.body?.cancel().catch(() => {})
      if (response.status === 404 || response.status === 410) throw new ReleaseMissingError("GitHub 发布仓库或制品不存在")
      if ([403, 408, 429].includes(response.status) || response.status >= 500) {
        const error = new ReleaseNetworkError(`GitHub 发布暂不可用（HTTP ${response.status}）`)
        error.rateLimited = [403, 429].includes(response.status)
        throw error
      }
      throw new Error(`GitHub 发布响应无效（HTTP ${response.status}）`)
    }
    throw new Error("GitHub 发布制品跳转次数过多")
  }

  async function retry(operation) {
    try { return await operation() } catch (error) {
      if (!(error instanceof ReleaseNetworkError) || error.rateLimited) throw error
      await sleep(400)
      return operation()
    }
  }

  function enforceLength(response, maximum, exact) {
    // fetch 会解压响应；解压后的字节仍受流式大小和签名校验约束。
    const length = Number(response.headers.get("content-length"))
    if (response.headers.has("content-length") && !response.headers.has("content-encoding") &&
        (length > maximum || (exact !== undefined && length !== exact))) {
      throw new Error("GitHub 发布制品大小不符")
    }
  }

  function read(raw, { type = "asset", maximum, exact, signal }) {
    return retry(async () => {
      const deadline = AbortSignal.timeout(12_000)
      const response = await request(raw, type, signal ? AbortSignal.any([signal, deadline]) : deadline)
      let size = 0
      const buffers = []
      try {
        enforceLength(response, maximum, exact)
        try {
          for await (const chunk of response.body) {
            size += chunk.length
            if (size > maximum) throw new Error("GitHub 发布制品大小超过限制")
            buffers.push(Buffer.from(chunk))
          }
        } catch (error) {
          if (error.name === "AbortError" || error instanceof TypeError) throw new ReleaseNetworkError("GitHub 发布响应中断或超时")
          throw error
        }
        if (!size || (exact !== undefined && size !== exact)) throw new Error("GitHub 发布制品大小不符")
        return Buffer.concat(buffers)
      } finally {
        if (!response.body.locked) await response.body.cancel().catch(() => {})
      }
    })
  }

  function download(raw, destination, asset, { onPhase, onProgress, signal } = {}) {
    return retry(async () => {
      const deadline = AbortSignal.timeout(10 * 60_000)
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
      let complete = false
      try {
        const response = await request(raw, "asset", combined)
        try { enforceLength(response, asset.sizeBytes, asset.sizeBytes) } catch (error) {
          await response.body.cancel().catch(() => {})
          throw error
        }
        let size = 0
        const hash = createHash("sha256")
        onPhase?.("downloading")
        onProgress?.(0, asset.sizeBytes)
        const validateChunk = new Transform({
          transform(chunk, _encoding, callback) {
            size += chunk.length
            if (size > asset.sizeBytes) return callback(new Error("GitHub 发布制品大小超过限制"))
            hash.update(chunk)
            onProgress?.(size, asset.sizeBytes)
            callback(null, chunk)
          },
        })
        try {
          await pipeline(response.body, validateChunk, createWriteStream(destination, { flags: "wx", mode: 0o600 }), { signal: combined })
        } catch (error) {
          if (!signal?.aborted && (deadline.aborted || error instanceof TypeError)) {
            onPhase?.("retrying")
            throw new ReleaseNetworkError("GitHub 制品下载中断或超时")
          }
          throw error
        }
        onPhase?.("verifying")
        if (size !== asset.sizeBytes || hash.digest("hex") !== asset.sha256) throw new Error("GitHub 发布制品大小或 SHA-256 不符")
        complete = true
      } finally {
        if (!complete) await fs.rm(destination, { force: true })
      }
    })
  }

  return { read, download }
}

module.exports = { createReleaseHttp, ReleaseNetworkError, ReleaseMissingError }
