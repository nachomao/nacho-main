const fs = require("node:fs")
const path = require("node:path")

const desktopDir = path.resolve(__dirname, "..")
const rootDir = path.resolve(desktopDir, "..")
const desktopManifest = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"))
const panelDir = path.join(rootDir, "nacho-panel")
const standaloneRoot = path.join(panelDir, ".next", "standalone")
const panelStandaloneDir = fs.existsSync(path.join(standaloneRoot, "server.js"))
  ? standaloneRoot : path.join(standaloneRoot, "nacho-panel")
const appDir = path.join(desktopDir, "app")
const stagedPanelDir = path.join(appDir, "panel")
const stagedDependenciesDir = path.join(appDir, "panel-deps")

function removeIfExists(target) {
  fs.rmSync(target, { recursive: true, force: true })
}

function copyRequired(source, target) {
  if (!fs.existsSync(source)) {
    throw new Error(`找不到构建输入：${source}`)
  }
  fs.cpSync(source, target, { recursive: true })
}

removeIfExists(appDir)
fs.mkdirSync(stagedPanelDir, { recursive: true })

copyRequired(path.join(panelStandaloneDir, "server.js"), path.join(stagedPanelDir, "server.js"))
copyRequired(path.join(panelStandaloneDir, ".next"), path.join(stagedPanelDir, ".next"))
copyRequired(path.join(panelStandaloneDir, "package.json"), path.join(stagedPanelDir, "package.json"))
copyRequired(path.join(panelStandaloneDir, "node_modules"), stagedDependenciesDir)
copyRequired(path.join(panelDir, ".next", "static"), path.join(stagedPanelDir, ".next", "static"))
copyRequired(path.join(panelDir, "public"), path.join(stagedPanelDir, "public"))

copyRequired(path.join(desktopDir, "src", "main.cjs"), path.join(appDir, "main.cjs"))
copyRequired(path.join(desktopDir, "src", "preload.cjs"), path.join(appDir, "preload.cjs"))
copyRequired(path.join(desktopDir, "src", "email-oauth-browser.cjs"), path.join(appDir, "email-oauth-browser.cjs"))
copyRequired(path.join(desktopDir, "src", "connection-store.cjs"), path.join(appDir, "connection-store.cjs"))
copyRequired(path.join(desktopDir, "src", "window-resize.cjs"), path.join(appDir, "window-resize.cjs"))
copyRequired(path.join(desktopDir, "src", "connection-context.cjs"), path.join(appDir, "connection-context.cjs"))
copyRequired(path.join(desktopDir, "src", "credential-protector.cjs"), path.join(appDir, "credential-protector.cjs"))
copyRequired(path.join(desktopDir, "src", "ai-process.cjs"), path.join(appDir, "ai-process.cjs"))
copyRequired(path.join(desktopDir, "build", "credential-protector", "nacho-credential-protector.exe"),
  path.join(appDir, "nacho-credential-protector.exe"))
copyRequired(path.join(desktopDir, "src", "updates.cjs"), path.join(appDir, "updates.cjs"))
copyRequired(path.join(desktopDir, "src", "update-handoff.cjs"), path.join(appDir, "update-handoff.cjs"))
for (const filename of ["release-manifest.cjs", "envelope-crypto.cjs", "tuf-client.cjs", "release-http.cjs", "release-discovery.cjs", "release-age.cjs", "release-stage.cjs", "update-settings.cjs"]) {
  copyRequired(path.join(desktopDir, "src", filename), path.join(appDir, filename))
}
const localVerifierDir = path.join(stagedPanelDir, "update-verifier")
fs.mkdirSync(localVerifierDir, { recursive: true })
for (const filename of ["release-manifest.cjs", "envelope-crypto.cjs", "update-settings.cjs"]) {
  copyRequired(path.join(desktopDir, "src", filename), path.join(localVerifierDir, filename))
}
copyRequired(path.join(desktopDir, "src", "github-download.cjs"), path.join(appDir, "github-download.cjs"))
copyRequired(path.join(desktopDir, "src", "panel-runner.cjs"), path.join(stagedPanelDir, "panel-runner.cjs"))

const opencodeLock = JSON.parse(fs.readFileSync(path.join(desktopDir, "opencode.lock.json"), "utf8"))
const opencodeCache = path.join(desktopDir, "build", "opencode", opencodeLock.version)
const stagedOpencode = path.join(appDir, "opencode")
fs.mkdirSync(stagedOpencode, { recursive: true })
const opencodeBinary = path.join(opencodeCache, "opencode.exe")
const opencodeLicense = path.join(opencodeCache, "LICENSE")
if (!fs.existsSync(opencodeBinary)) {
  throw new Error(`找不到 opencode 缓存：${opencodeBinary}。请先运行 pnpm run build:opencode`)
}
if (!fs.existsSync(opencodeLicense)) {
  throw new Error(`找不到 opencode 许可证：${opencodeLicense}。请先运行 pnpm run build:opencode`)
}
fs.copyFileSync(opencodeBinary, path.join(stagedOpencode, "opencode.exe"))
fs.copyFileSync(opencodeLicense, path.join(stagedOpencode, "LICENSE"))

if (fs.existsSync(path.join(desktopDir, "installer.nsh"))) {
  fs.mkdirSync(path.join(desktopDir, "build"), { recursive: true })
  fs.copyFileSync(path.join(desktopDir, "installer.nsh"), path.join(desktopDir, "build", "installer.nsh"))
}

const ageLock = require("../age.lock.json")
const { cache: ageCache, verified: verifyAgeFile } = require("./fetch-age.cjs")
const stagedAge = path.join(appDir, "age")
fs.mkdirSync(stagedAge, { recursive: true })
for (const [file, metadata] of Object.entries(ageLock.files)) {
  const cached = path.join(ageCache, "age", file)
  if (!verifyAgeFile(cached, metadata)) throw new Error(`缺少已校验的 age 构建依赖：${file}`)
  fs.copyFileSync(cached, path.join(stagedAge, file))
}

fs.writeFileSync(
  path.join(appDir, "package.json"),
  `${JSON.stringify(
    {
      name: "nacho-panel-runtime",
      version: desktopManifest.version,
      releaseChannel: desktopManifest.releaseChannel,
      private: true,
      main: "main.cjs",
      description: "Nacho 面板桌面运行时",
      author: "Nacho",
    },
    null,
    2,
  )}\n`,
  "utf8",
)

console.log(`已生成桌面运行目录：${appDir}`)
console.log(`已复制面板运行时：${stagedPanelDir}`)
