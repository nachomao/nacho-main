const fs = require("node:fs")
const path = require("node:path")

const desktopDir = path.resolve(__dirname, "..")
const rootDir = path.resolve(desktopDir, "..")
const desktopManifest = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"))
const panelDir = path.join(rootDir, "nacho-panel")
const panelStandaloneDir = path.join(panelDir, ".next", "standalone")
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
copyRequired(path.join(desktopDir, "src", "updates.cjs"), path.join(appDir, "updates.cjs"))
copyRequired(path.join(desktopDir, "src", "panel-runner.cjs"), path.join(stagedPanelDir, "panel-runner.cjs"))

const updateOrigin = process.env.NACHO_UPDATE_ORIGIN
if (updateOrigin) {
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(updateOrigin)) throw new Error("更新服务器必须为无尾斜杠的 HTTPS 根地址")
  fs.writeFileSync(path.join(appDir, "update-source.json"), `${JSON.stringify({ origin: updateOrigin })}\n`, "utf8")
}

fs.writeFileSync(
  path.join(appDir, "package.json"),
  `${JSON.stringify(
    {
      name: "nacho-panel-runtime",
      version: desktopManifest.version,
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
