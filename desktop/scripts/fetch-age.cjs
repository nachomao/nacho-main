"use strict"

const { execFileSync } = require("node:child_process")
const { createHash } = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const { createReleaseHttp } = require("../src/release-http.cjs")
const lock = require("../age.lock.json")

const cache = path.join(__dirname, "..", "build", "age", lock.version)

function verified(file, descriptor) {
  try {
    return fs.statSync(file).size === descriptor.sizeBytes &&
      createHash("sha256").update(fs.readFileSync(file)).digest("hex") === descriptor.sha256
  } catch { return false }
}

async function main() {
  const output = path.join(cache, "age")
  fs.mkdirSync(output, { recursive: true })
  if (Object.entries(lock.files).every(([name, descriptor]) => verified(path.join(output, name), descriptor))) {
    console.log(`age ${lock.version} 缓存已校验`)
    return
  }
  const archive = path.join(cache, lock.archive.fileName)
  if (!verified(archive, lock.archive)) {
    fs.rmSync(archive, { force: true })
    await createReleaseHttp().download(lock.archive.url, archive, lock.archive)
  }
  for (const [name, descriptor] of Object.entries(lock.files)) {
    const member = `age/${name}`
    const unix = process.platform !== "win32"
    const data = execFileSync(unix ? "unzip" : "tar.exe",
      unix ? ["-p", lock.archive.fileName, member] : ["-xOf", lock.archive.fileName, member],
      { cwd: cache, windowsHide: true, maxBuffer: descriptor.sizeBytes + 1024 })
    if (data.length !== descriptor.sizeBytes || createHash("sha256").update(data).digest("hex") !== descriptor.sha256) {
      throw new Error(`age ${name} 完整性校验失败`)
    }
    fs.writeFileSync(path.join(output, name), data)
  }
  console.log(`age ${lock.version} 构建依赖已校验`)
}

if (require.main === module) main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

module.exports = { cache, verified }
