const fs = require("node:fs")
const path = require("node:path")

const desktopDir = path.resolve(__dirname, "..")
const manifestPath = path.join(desktopDir, "package.json")
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.version)

if (!match) {
  throw new Error(`桌面版本号必须是三段式 SemVer：${manifest.version}`)
}

const nextVersion = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
manifest.version = nextVersion
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
console.log(`桌面版本已递增：${nextVersion}`)
