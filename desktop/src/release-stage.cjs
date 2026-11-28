"use strict"

const fs = require("node:fs/promises")
const path = require("node:path")
const { compareVersions, sha256 } = require("./release-manifest.cjs")

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const STAGES = "/product-updates/stages"
const CHUNK_BYTES = 4 * 1024 * 1024

function createStageClient({ serverUrl, apiKey, panelVersion, directory, fetcher = (...args) => fetch(...args) }) {
  let url
  try { url = new URL(serverUrl) } catch { /* 连接配置无效 */ }
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || typeof apiKey !== "string" || apiKey.length > 8192 ||
      !apiKey || /[\r\n]/.test(apiKey)) throw new Error("更新传输的服务端连接无效")
  async function api(relative, method = "GET", body, contentType) {
    const result = await fetcher(`${url.origin}/api/panel${relative}`, {
      method, body, cache: "no-store", redirect: "error", credentials: "omit",
      headers: { Authorization: `Bearer ${apiKey}`, "X-Nacho-Panel-Version": panelVersion,
        Accept: "application/json", ...(contentType ? { "Content-Type": contentType } : {}) },
      signal: AbortSignal.timeout(60_000),
    })
    const envelope = await result.json().catch(() => null)
    if (!result.ok || envelope?.ok !== true) {
      const message = typeof envelope?.message === "string" ? envelope.message.replaceAll(apiKey, "[凭据]") : ""
      throw new Error(message.slice(0, 300) || `更新传输失败（HTTP ${result.status}）`)
    }
    return envelope.data
  }
  async function checkCompatibility({ manifest, kind }) {
    const runtime = await api("/runtime-info")
    if (runtime?.capabilities?.productUpdatesV5 !== true ||
        (kind === "server" && (!runtime.updateExecutor || runtime.updateExecutorProtocol !== 5))) {
      throw new Error("控制服务未启用 GitHub 签名更新协议，需先手动迁移")
    }
    if (compareVersions(panelVersion, manifest.compatibility.minPanelVersion) < 0) throw new Error("请先升级面板")
    const installed = kind === "server" ? runtime.version : runtime.agentArtifactVersion
    if (installed && compareVersions(manifest.version, installed) <= 0) throw new Error("目标版本必须高于当前版本")
    if (kind === "agent" && compareVersions(runtime.version, manifest.compatibility.minServerVersion) < 0) {
      throw new Error("请先升级控制服务端")
    }
  }
  async function upload({ kind, manifest, digest, proof, asset, file, onProgress }) {
    if (!["server", "agent"].includes(kind) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("更新传输请求无效")
    const checkpoint = path.join(directory, `stage-${sha256(`${url.origin}\n${kind}\n${digest}`)}.json`)
    function verifyStage(stage, id) {
      if (!stage || !UUID.test(stage.id) || (id && stage.id !== id) || stage.kind !== kind ||
          stage.version !== manifest.version || stage.manifestDigest !== digest || stage.fileName !== asset.fileName ||
          stage.sizeBytes !== asset.sizeBytes || stage.sha256 !== asset.sha256 || !Number.isSafeInteger(stage.offset) ||
          stage.offset < 0 || stage.offset > asset.sizeBytes || !["uploading", "ready"].includes(stage.phase) ||
          (stage.phase === "ready" && stage.offset !== asset.sizeBytes)) throw new Error("服务端上传会话与已确认发布不符")
      return stage
    }
    let stage
    try {
      const saved = JSON.parse(await fs.readFile(checkpoint, "utf8"))
      if (UUID.test(saved.id)) stage = verifyStage(await api(`${STAGES}/${saved.id}`), saved.id)
    } catch { /* 旧会话不可用时创建与同一签名证明绑定的新会话 */ }
    if (!stage) {
      stage = verifyStage(await api(STAGES, "POST", JSON.stringify({ kind, version: manifest.version, proof }), "application/json"))
      await fs.writeFile(checkpoint, JSON.stringify({ id: stage.id }), { mode: 0o600 })
    }
    if (stage.phase === "ready") { onProgress?.(100); return stage }
    const handle = await fs.open(file, "r")
    try {
      let { id, offset } = stage
      onProgress?.(Math.round(offset * 100 / asset.sizeBytes))
      while (offset < asset.sizeBytes) {
        const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, asset.sizeBytes - offset))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
        if (bytesRead !== buffer.length) throw new Error("本地验证制品读取失败")
        const expected = offset + bytesRead
        let next
        try {
          next = await api(`${STAGES}/${id}/chunks?offset=${offset}`, "PUT", buffer, "application/octet-stream")
        } catch (error) {
          next = await api(`${STAGES}/${id}`, "GET")
          if (next?.offset !== expected) throw error
        }
        if (verifyStage(next, id).offset !== expected || next.phase !== "uploading") throw new Error("服务端确认的分块位置不符")
        offset = next.offset
        onProgress?.(Math.round(offset * 100 / asset.sizeBytes))
      }
    } finally { await handle.close() }
    const finished = verifyStage(await api(`${STAGES}/${stage.id}/commit`, "POST",
      JSON.stringify({ panelVersion }), "application/json"), stage.id)
    if (finished.phase !== "ready") throw new Error("服务端尚未接受已签名制品")
    await fs.rm(checkpoint, { force: true })
    return finished
  }
  return { checkCompatibility, upload }
}

module.exports = { createStageClient }
