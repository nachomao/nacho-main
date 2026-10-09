const fs = require("node:fs/promises")
const path = require("node:path")
const { createRequire } = require("node:module")
const { downloadFile, isGitHubFile, hashFile } = require("../src/github-download.cjs")

/** 在工具自己的归档缓存中预取；原工具继续校验并解包，不修改 node_modules。 */
function installBuildDownloader() {
  const builderRequire = createRequire(require.resolve("electron-builder/package.json"))
  const electronGet = builderRequire("app-builder-lib/out/util/electronGet")
  const original = electronGet.downloadBuilderToolset
  electronGet.downloadBuilderToolset = async (options) => {
    const { releaseName, filenameWithExt, checksums, githubOrgRepo = "electron-userland/electron-builder-binaries",
      overrideUrl } = options
    const base = overrideUrl ? `${overrideUrl}/` : electronGet.getBinariesMirrorUrl(githubOrgRepo)
    const url = `${base}${overrideUrl ? "" : `${releaseName}/`}${filenameWithExt}`
    if (isGitHubFile(url)) {
      const sha256 = checksums?.[filenameWithExt]
      const cacheRoot = electronGet.getCacheDirectory({ allowEnvVarOverride: true })
      const archive = path.join(cacheRoot, releaseName, filenameWithExt)
      const valid = sha256 && await hashFile(archive).then((hash) => hash === sha256, () => false)
      if (!valid) await downloadFile(url, archive, { sha256, timeoutMs: 20 * 60_000, onLog: console.info })
    }
    return original(options)
  }
  const binDownload = builderRequire("app-builder-lib/out/binDownload")
  const originalDownload = binDownload.download
  binDownload.download = async (url, output, checksum) => {
    if (!isGitHubFile(url)) return originalDownload(url, output, checksum)
    return downloadFile(url, output, { sha256: checksum, timeoutMs: 20 * 60_000, onLog: console.info })
  }
  return { builderRequire, electronGet }
}

async function main() {
  const { build, Platform, Arch } = require("electron-builder")
  const { builderRequire } = installBuildDownloader()
  const electronDist = await prepareElectronRuntime(builderRequire)
  // 只预取构建器真正请求的工具；各版本和校验值仍由锁定的构建器提供。
  await build({ targets: Platform.WINDOWS.createTarget(process.argv.includes("--dir") ? "dir" : "nsis", Arch.x64),
    config: { electronDist } })
}

async function prepareElectronRuntime(builderRequire) {
  const electronPackage = require.resolve("electron/package.json")
  const electronRoot = path.dirname(electronPackage)
  const { version } = require(electronPackage)
  const installed = path.join(electronRoot, "dist")
  const existingVersion = await fs.readFile(path.join(installed, "version"), "utf8").catch(() => "")
  if (existingVersion.trim().replace(/^v/, "") === version &&
      await fs.access(path.join(installed, "electron.exe")).then(() => true, () => false)) return installed
  const checksums = require(path.join(electronRoot, "checksums.json"))
  const get = builderRequire("@electron/get")
  const zip = await get.downloadArtifact({
    version, artifactName: "electron", platform: "win32", arch: "x64", checksums,
    downloader: {
      async download(url, output) {
        await downloadFile(url, output, { sha256: checksums[path.basename(new URL(url).pathname)],
          timeoutMs: 20 * 60_000, onLog: console.info })
      },
    },
  })
  const electronGet = builderRequire("app-builder-lib/out/util/electronGet")
  const target = path.join(electronGet.getCacheDirectory({ allowEnvVarOverride: true }), `nacho-electron-${version}`)
  await fs.mkdir(target, { recursive: true })
  await electronGet.extractArchive(zip, target)
  return target
}

if (require.main === module) void main().catch((error) => { console.error(error); process.exitCode = 1 })
module.exports = { installBuildDownloader, prepareElectronRuntime }
