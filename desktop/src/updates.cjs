"use strict"

const { randomUUID } = require("node:crypto")
const { execFile } = require("node:child_process")
const fs = require("node:fs/promises")
const path = require("node:path")
const { promisify } = require("node:util")
const { assetUrl, compareVersions, fingerprint } = require("./release-manifest.cjs")
const { decryptFileEnvelope } = require("./envelope-crypto.cjs")
const { createReleaseHttp } = require("./release-http.cjs")
const { createReleaseChecker } = require("./release-discovery.cjs")
const { createUpdateSettings } = require("./update-settings.cjs")
const { createStageClient } = require("./release-stage.cjs")
const { startHandoff, waitForHandoff } = require("./update-handoff.cjs")

const execFileAsync = promisify(execFile)
const CHECK_INTERVAL_MS = 30 * 60 * 1000
const TARGET_DIGEST = /^[a-f0-9]{64}$/

async function releaseHandoff(script, installer, appPath, parentPid, statusPath) {
  await waitForHandoff(startHandoff(script, installer, appPath, parentPid, statusPath))
}

function createUpdater(app, {
  dataDirectory, safeStorage, http = createReleaseHttp(),
  platform = process.platform, approveThirdParty = async () => false,
  applyLocal, onPanelInstallProgress, onCheck, handoff = releaseHandoff,
  makeStageClient = createStageClient,
  tufClientFactory = null,
  settings = createUpdateSettings({ directory: dataDirectory, safeStorage }),
  checker = createReleaseChecker({
    directory: path.join(dataDirectory, "updates-v5"),
    http,
    getDeviceIdentity: () => settings.getOrCreateDeviceIdentity?.(),
    tufClientFactory,
  }),
} = {}) {
  const directory = path.join(dataDirectory, "updates-v5")
  let revision = 0
  let checking = null
  let lastCheck = null
  let installing = false
  let panelInstallState = { revision: 0, phase: "idle", version: null, downloadedBytes: 0, totalBytes: null, error: null }
  let progressTimer = null
  let lastProgress = 0

  function getPanelInstallState() { return { ...panelInstallState } }
  function sendProgress() {
    clearTimeout(progressTimer)
    progressTimer = null
    lastProgress = Date.now()
    onPanelInstallProgress?.(getPanelInstallState())
  }
  function report(patch, immediate = true) {
    if (Object.entries(patch).every(([key, value]) => panelInstallState[key] === value)) return
    panelInstallState = { ...panelInstallState, ...patch, revision: panelInstallState.revision + 1 }
    const elapsed = Date.now() - lastProgress
    if (immediate || elapsed >= 200) sendProgress()
    else if (!progressTimer) progressTimer = setTimeout(sendProgress, 200 - elapsed)
  }
  function assertIdle() {
    if (installing) throw new Error("升级已经在执行")
  }
  function invalidate() {
    revision++
    lastCheck = null
  }
  async function check(force = false) {
    const generation = revision
    if (checking?.generation === generation) return checking.promise
    if (!force && lastCheck && Date.now() - lastCheck.at < CHECK_INTERVAL_MS) return lastCheck.result
    const { profile, channel } = settings.selection()
    const promise = checker.check(profile, channel).then((checked) => {
      if (revision !== generation) throw new Error("已切换更新来源或频道")
      const result = { ...checked, profileId: profile.id, channel, currentVersion: app.getVersion() }
      // 出错、未授权或缓存展示不阻止用户下次重新检查。
      if (!Object.values(result.components).some((part) => ["stale", "error", "locked"].includes(part.status))) {
        lastCheck = { at: Date.now(), result }
      } else lastCheck = null
      onCheck?.(result)
      return result
    }).finally(() => { if (checking?.promise === promise) checking = null })
    checking = { generation, promise }
    return promise
  }

  function selected(target, component) {
    const { profile, channel } = settings.selection()
    if (target?.profileId !== profile.id || target.channel !== channel || target.component !== component ||
        typeof target.version !== "string" || !TARGET_DIGEST.test(target.digest)) {
      throw new Error("更新选择已失效，请重新检查并确认")
    }
    compareVersions(target.version, target.version)
    return { profile, channel }
  }
  async function confirm(target, component, kind = component) {
    const { profile, channel } = selected(target, component)
    if (profile.id !== "official") {
      const approved = await approveThirdParty({
        version: target.version, channel, kind, label: profile.label || profile.id,
        repository: profile.repositories[channel][component], fingerprint: fingerprint(profile.publicKey),
      })
      if (!approved) throw new Error("已取消第三方更新")
    }
    return checker.confirm(profile, channel, component, target)
  }
  async function workspace(kind) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    const id = randomUUID()
    const folder = path.join(directory, `${kind}-${id}`)
    await fs.mkdir(folder, { mode: 0o700 })
    return { id, folder }
  }
  async function cleanup(folder, files) {
    await Promise.all(files.map((name) => fs.rm(path.join(folder, name), { force: true }).catch(() => {})))
    await fs.rmdir(folder).catch(() => {})
  }
  async function materialize(pinned, asset, folder, progress) {
    const file = path.join(folder, asset.fileName)
    const incoming = asset.encrypted ?? asset
    try {
      await http.download(assetUrl(pinned.manifest, asset), path.join(folder, incoming.fileName), incoming, progress)
      if (asset.encrypted) {
        if (!Buffer.isBuffer(pinned.dek)) throw new Error("本设备尚未获得该受控版本的自动解密密钥")
        const context = `${pinned.manifest.channel}:${pinned.manifest.component}:${pinned.manifest.version}:${asset.fileName}`
        await decryptFileEnvelope(path.join(folder, incoming.fileName), file, pinned.dek, context, asset)
      }
      return file
    } finally {
      if (Buffer.isBuffer(pinned.dek)) pinned.dek.fill(0)
      if (asset.encrypted) await fs.rm(path.join(folder, incoming.fileName), { force: true })
    }
  }

  async function installPanel(target) {
    assertIdle()
    selected(target, "panel")
    if (platform !== "win32" || !app.isPackaged) throw new Error("仅 Windows 已安装面板支持应用内升级")
    if (compareVersions(target.version, app.getVersion()) <= 0) throw new Error("目标版本必须高于已安装面板")
    installing = true
    report({ phase: "preparing", version: target.version, downloadedBytes: 0, totalBytes: null, error: null })
    let folder, asset
    try {
      const pinned = await confirm(target, "panel")
      asset = pinned.manifest.assets.installer
      ;({ folder } = await workspace("panel"))
      const downloadSize = (asset.encrypted ?? asset).sizeBytes
      report({ totalBytes: downloadSize })
      const installer = await materialize(pinned, asset, folder, {
        onPhase(phase) {
          if (phase === "connecting" && panelInstallState.phase === "retrying") return
          report({ phase, ...(["downloading", "retrying"].includes(phase) ? { downloadedBytes: 0 } : {}) })
        },
        onProgress(downloadedBytes) { report({ downloadedBytes }, downloadedBytes === 0 || downloadedBytes === downloadSize) },
      })
      report({ phase: "verifying", downloadedBytes: downloadSize })
      const thumb = pinned.manifest.authenticodeThumbprint
      if (thumb) {
        const safePath = installer.replaceAll("'", "''")
        const verifySignature = `$s=Get-AuthenticodeSignature -LiteralPath '${safePath}'; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Thumbprint.ToUpperInvariant() -ne '${thumb}') { exit 5 }`
        try {
          await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", verifySignature], { timeout: 30_000, windowsHide: true })
        } catch { throw new Error("安装包发布者签名不匹配") }
      }
      const script = path.join(folder, "finish-update.ps1")
      const statusPath = path.join(directory, "last-result.txt")
      await fs.writeFile(script, [
        "param([string]$Installer, [string]$AppPath, [int]$ParentPid, [string]$StatusPath)",
        "$ErrorActionPreference = 'Stop'",
        "try {",
        "  Wait-Process -Id $ParentPid -Timeout 60 -ErrorAction SilentlyContinue",
        "  if (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) { throw 'Panel did not exit' }",
        `  if ((Get-Item -LiteralPath $Installer).Length -ne ${asset.sizeBytes} -or (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash -ne '${asset.sha256}') { throw 'Installer SHA-256 verification failed' }`,
        ...(thumb ? [`  $s = Get-AuthenticodeSignature -LiteralPath $Installer; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Thumbprint -ne '${thumb}') { throw 'Installer signature invalid' }`] : []),
        "  Set-Content -LiteralPath $StatusPath -Value 'started' -Encoding UTF8",
        "  $p = Start-Process -FilePath $Installer -Verb RunAs -Wait -PassThru",
        "  if ($p.ExitCode -ne 0) { throw \"Installer exit code $($p.ExitCode)\" }",
        "  Set-Content -LiteralPath $StatusPath -Value 'installed' -Encoding UTF8",
        "} catch { Set-Content -LiteralPath $StatusPath -Value $_.Exception.Message -Encoding UTF8 }",
        "Remove-Item -LiteralPath $Installer -Force -ErrorAction SilentlyContinue",
        "Start-Process -FilePath $AppPath",
      ].join("\r\n"), { flag: "wx", mode: 0o600 })
      await handoff(script, installer, app.getPath("exe"), process.pid, statusPath)
      report({ phase: "installing" })
      setTimeout(() => app.quit(), 300).unref()
      return { phase: "installing", version: target.version }
    } catch (error) {
      if (folder) await cleanup(folder, [asset.fileName, "finish-update.ps1"])
      report({ phase: "failed", error: error instanceof Error ? error.message : "面板安装失败" })
      installing = false
      throw error
    }
  }

  async function installLocalServer(target) {
    assertIdle()
    selected(target, "server")
    if (platform !== "win32" || !applyLocal) throw new Error("本机升级需要 Windows 桌面面板")
    installing = true
    let folder, asset
    try {
      const pinned = await confirm(target, "server")
      if (compareVersions(app.getVersion(), pinned.manifest.compatibility.minPanelVersion) < 0) throw new Error("请先升级面板")
      asset = pinned.manifest.assets.source
      const local = await workspace("local-server")
      folder = local.folder
      await materialize(pinned, asset, folder)
      await fs.writeFile(path.join(folder, "receipt.json"), JSON.stringify({ target, proof: pinned.proof }), { flag: "wx", mode: 0o600 })
      return await applyLocal(local.id)
    } finally {
      if (folder) await cleanup(folder, [asset.fileName, "receipt.json"])
      installing = false
    }
  }

  async function transferRelease(kind, serverUrl, apiKey, target, onProgress) {
    assertIdle()
    if (!["server", "agent"].includes(kind)) throw new Error("更新传输组件无效")
    selected(target, "server")
    installing = true
    let folder, asset
    try {
      const pinned = await confirm(target, "server", kind)
      asset = pinned.manifest.assets[kind === "server" ? "source" : "agent"]
      const client = makeStageClient({ serverUrl, apiKey, panelVersion: app.getVersion(), directory })
      const data = { kind, ...pinned, asset, onProgress }
      await client.checkCompatibility(data)
      ;({ folder } = await workspace(kind))
      const file = await materialize(pinned, asset, folder)
      return await client.upload({ ...data, file })
    } finally {
      if (folder) await cleanup(folder, [asset.fileName])
      installing = false
    }
  }

  async function mutate(action, ...args) {
    assertIdle()
    const value = await settings[action](...args)
    invalidate()
    return value
  }
  return {
    check, installPanel, getPanelInstallState, installLocalServer, transferRelease,
    readSettings: settings.read,
    select: (...args) => mutate("select", ...args),
    trustProfile: (...args) => mutate("trustProfile", ...args),
    removeProfile: (...args) => mutate("removeProfile", ...args),
  }
}

module.exports = { createUpdater, CHECK_INTERVAL_MS }
