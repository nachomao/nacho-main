const { createHash, verify } = require("node:crypto")
const { execFile, spawn } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
const { Readable, Transform } = require("node:stream")
const { pipeline } = require("node:stream/promises")
const { promisify } = require("node:util")
const execFileAsync = promisify(execFile)

const UPDATE_ORIGIN = process.env.NACHO_UPDATE_ORIGIN || "https://updates.example.invalid"
const INDEX_URL = `${UPDATE_ORIGIN}/updates/stable/index.json`
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA2qjcjfU4N2/nMmD9XkemMqqq6P0K6OVfjAnwlBJDU1g=
-----END PUBLIC KEY-----`
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const FILES = {
  panel: /^NachoPanel-Setup-\d+\.\d+\.\d+\.exe$/,
  server: /^control-server-\d+\.\d+\.\d+-linux-x64\.tar\.gz$/,
  agent: /^nacho-agent-\d+\.\d+\.\d+-win-x64\.exe$/,
}
const CHANNELS = ["stable", "beta", "alpha"]

function compareVersions(a, b) {
  if (!VERSION.test(a) || !VERSION.test(b)) throw new Error("版本格式无效")
  const left = a.split(".").map(Number), right = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  return 0
}

function verifyIndex(bytes, signature, key = PUBLIC_KEY, channel = "stable") {
  if (!bytes.length || bytes.length > 32768 || signature.length !== 64 ||
      !verify(null, bytes, key, signature)) throw new Error("发布索引签名无效")
  const index = JSON.parse(bytes.toString("utf8"))
  if (index.schemaVersion !== 2 || index.channel !== channel ||
      !Number.isSafeInteger(index.sequence) || index.sequence < 1 ||
      !Number.isFinite(Date.parse(index.publishedAt)) || !index.releases) throw new Error("发布索引结构无效")
  for (const component of ["panel", "server", "agent"]) {
    const item = index.releases[component]
    const expectedName = component === "panel" ? `NachoPanel-Setup-${item?.version}.exe` :
      component === "server" ? `control-server-${item?.version}-linux-x64.tar.gz` :
        `nacho-agent-${item?.version}-win-x64.exe`
    if (!item || !VERSION.test(item.version) || !FILES[component].test(item.fileName) ||
        item.fileName !== expectedName || !/^[a-f0-9]{64}$/.test(item.sha256) ||
        !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1 || item.sizeBytes > 2 * 1024 ** 3 ||
        !Number.isFinite(Date.parse(item.publishedAt)) ||
        item.url !== `${UPDATE_ORIGIN}/artifacts/${component}/${item.version}/${item.sha256}/${item.fileName}` ||
        typeof item.title !== "string" || !item.title.trim() ||
        typeof item.notes !== "string" || !item.notes.trim() ||
        !/^[a-f0-9]{40}$/.test(item.sourceCommit)) {
      throw new Error(`${component} 发布信息无效`)
    }
    if (item.minPanelVersion && !VERSION.test(item.minPanelVersion)) throw new Error("面板兼容版本无效")
    if (item.minServerVersion && !VERSION.test(item.minServerVersion)) throw new Error("服务端兼容版本无效")
    if (component === "server") {
      const win = item.windows, filename = `control-server-${item.version}-win-x64.zip`
      if (!win || win.fileName !== filename ||
          win.url !== `${UPDATE_ORIGIN}/artifacts/server/${item.version}/${win.sha256}/${filename}` ||
          !/^[a-f0-9]{64}$/.test(win.sha256) || !Number.isSafeInteger(win.sizeBytes) ||
          win.sizeBytes < 1 || win.sizeBytes > 2 * 1024 ** 3) throw new Error("Windows 服务端发布信息无效")
    }
    if (component === "panel" && item.authenticodeThumbprint !== undefined &&
        !/^[A-F0-9]{40}$/.test(item.authenticodeThumbprint)) {
      throw new Error("面板签名证书指纹无效")
    }
  }
  return index
}

async function readRemote(url, max) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), cache: "no-store" })
  if (!response.ok) throw new Error(`版本查询 HTTP ${response.status}`)
  if (Number(response.headers.get("content-length")) > max || !response.body) throw new Error("发布索引大小无效")
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > max) throw new Error("发布索引大小无效")
    chunks.push(Buffer.from(chunk))
  }
  const bytes = Buffer.concat(chunks)
  if (!bytes.length || bytes.length > max) throw new Error("发布索引大小无效")
  return bytes
}

function createUpdater(app) {
  const statePath = path.join(app.getPath("userData"), "update-channel.json")
  let channel = "stable"
  try {
    const saved = JSON.parse(fs.readFileSync(statePath, "utf8"))
    if (CHANNELS.includes(saved.channel)) channel = saved.channel
  } catch {}
  const cachePath = () => path.join(app.getPath("userData"), `release-index-cache-${channel}.json`)
  let lastCheck = 0
  let checking = null
  let installing = false

  function cached() {
    try {
      const object = JSON.parse(fs.readFileSync(cachePath(), "utf8"))
      return verifyIndex(Buffer.from(object.bytes, "base64"), Buffer.from(object.signature, "base64"), PUBLIC_KEY, channel)
    } catch { return null }
  }

  async function check(force = false) {
    if (UPDATE_ORIGIN === "https://updates.example.invalid") throw new Error("请先配置独立更新服务器的 NACHO_UPDATE_ORIGIN")
    if (checking) return checking
    if (!force && Date.now() - lastCheck < 24 * 60 * 60 * 1000 && cached()) {
      return { index: cached(), stale: false, currentVersion: app.getVersion(), channel }
    }
    checking = (async () => {
      const previous = cached()
      try {
        if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(UPDATE_ORIGIN)) throw new Error("更新服务器 HTTPS 地址无效")
        const url = `${UPDATE_ORIGIN}/updates/${channel}/index.json`
        const [bytes, signature] = await Promise.all([readRemote(url, 32768), readRemote(`${url}.sig`, 128)])
        const index = verifyIndex(bytes, signature, PUBLIC_KEY, channel)
        if (previous && (index.sequence < previous.sequence ||
            ["panel", "server", "agent"].some((key) =>
              compareVersions(index.releases[key].version, previous.releases[key].version) < 0))) {
          throw new Error("发布索引版本倒退")
        }
        fs.mkdirSync(path.dirname(cachePath()), { recursive: true })
        fs.writeFileSync(`${cachePath()}.tmp`, JSON.stringify({ bytes: bytes.toString("base64"), signature: signature.toString("base64") }))
        fs.renameSync(`${cachePath()}.tmp`, cachePath())
        lastCheck = Date.now()
        return { index, stale: false, currentVersion: app.getVersion(), channel }
      } catch (error) {
        if (previous && /HTTP|fetch|网络|超时|timed out|abort/i.test(String(error))) {
          return { index: previous, stale: true, currentVersion: app.getVersion(), channel }
        }
        throw error
      }
    })().finally(() => { checking = null })
    return checking
  }
  async function setChannel(next) {
    if (UPDATE_ORIGIN === "https://updates.example.invalid") throw new Error("请先配置独立更新服务器的 NACHO_UPDATE_ORIGIN")
    if (!CHANNELS.includes(next)) throw new Error("无效更新频道")
    if (next === channel) return { channel }
    if (installing || checking) throw new Error("升级或检查正在执行")
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(UPDATE_ORIGIN)) throw new Error("更新服务器 HTTPS 地址无效")
    const url = `${UPDATE_ORIGIN}/updates/${next}/index.json`
    const [bytes, signature] = await Promise.all([readRemote(url, 32768), readRemote(`${url}.sig`, 128)])
    const index = verifyIndex(bytes, signature, PUBLIC_KEY, next)
    if (compareVersions(index.releases.panel.version, app.getVersion()) < 0) throw new Error("目标频道面板版本低于当前版本")
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(`${statePath}.tmp`, JSON.stringify({ channel: next }))
    fs.renameSync(`${statePath}.tmp`, statePath)
    channel = next
    lastCheck = 0
    return check(true)
  }

  async function installPanel() {
    if (installing) throw new Error("升级已经在执行")
    if (process.platform !== "win32" || !app.isPackaged) throw new Error("仅 Windows 已安装面板支持应用内升级")
    installing = true
    try {
      const { index, stale } = await check(true)
      if (stale) throw new Error("离线缓存不可用于安装")
      const release = index.releases.panel
      if (compareVersions(release.version, app.getVersion()) <= 0) throw new Error("当前面板已经是最新版本")
      const directory = path.join(app.getPath("userData"), "updates")
      fs.mkdirSync(directory, { recursive: true })
      const installer = path.join(directory, release.fileName)
      const temporary = `${installer}.download`
      const response = await fetch(release.url, { signal: AbortSignal.timeout(20 * 60_000) })
      if (!response.ok || !response.body) throw new Error(`安装包下载 HTTP ${response.status}`)
      let size = 0
      const hash = createHash("sha256")
      try {
        await pipeline(Readable.fromWeb(response.body), new Transform({
          transform(chunk, _encoding, callback) {
            size += chunk.length
            if (size > release.sizeBytes) return callback(new Error("安装包超过发布大小"))
            hash.update(chunk)
            callback(null, chunk)
          },
        }), fs.createWriteStream(temporary, { flags: "w" }))
        if (size !== release.sizeBytes || hash.digest("hex") !== release.sha256) throw new Error("安装包校验失败")
        fs.renameSync(temporary, installer)
      } finally {
        if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true })
      }
      if (release.authenticodeThumbprint) {
        const safePath = installer.replaceAll("'", "''")
        const signatureCheck = `$s=Get-AuthenticodeSignature -LiteralPath '${safePath}'; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Thumbprint.ToUpperInvariant() -ne '${release.authenticodeThumbprint}') { exit 5 }`
        try {
          await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", signatureCheck],
            { timeout: 30_000, windowsHide: true })
        } catch {
          fs.rmSync(installer, { force: true })
          throw new Error("安装包发布者签名不匹配")
        }
      }
      const script = path.join(directory, "finish-update.ps1")
      fs.writeFileSync(script, [
        "param([string]$Installer, [string]$AppPath, [int]$ParentPid, [string]$StatusPath)",
        "$ErrorActionPreference = 'Stop'",
        "try { Wait-Process -Id $ParentPid -Timeout 60 -ErrorAction Stop } catch { Start-Sleep -Seconds 2 }",
        "try {",
        "  $process = Start-Process -FilePath $Installer -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden",
        "  if ($process.ExitCode -ne 0) { throw \"安装程序退出码 $($process.ExitCode)\" }",
        "  Set-Content -LiteralPath $StatusPath -Value 'installed' -Encoding UTF8",
        "  Start-Process -FilePath $AppPath",
        "} catch { Set-Content -LiteralPath $StatusPath -Value $_.Exception.Message -Encoding UTF8 }",
      ].join("\r\n"), "utf8")
      const child = spawn("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
        "-File", script, "-Installer", installer, "-AppPath", app.getPath("exe"),
        "-ParentPid", String(process.pid), "-StatusPath", path.join(directory, "last-result.txt"),
      ], { detached: true, stdio: "ignore", windowsHide: true })
      child.unref()
      setTimeout(() => app.quit(), 300)
      return { phase: "installing", version: release.version }
    } finally {
      installing = false
    }
  }

  return { check, cached, installPanel, setChannel, getChannel: () => channel }
}

module.exports = { createUpdater, verifyIndex, compareVersions, INDEX_URL }
