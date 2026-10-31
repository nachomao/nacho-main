const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const desktopDir = path.resolve(__dirname, "..")
const lock = JSON.parse(fs.readFileSync(path.join(desktopDir, "opencode.lock.json"), "utf8"))
const cacheDir = path.join(desktopDir, "build", "opencode", lock.version)
const binaryTarget = path.join(cacheDir, "opencode.exe")
const licenseTarget = path.join(cacheDir, "LICENSE")
const tarballTarget = path.join(cacheDir, `opencode-windows-x64-${lock.version}.tgz`)
const licenseTarball = path.join(cacheDir, `opencode-ai-${lock.version}.tgz`)

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}

function sha1(file) {
  return crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex")
}

function verifyBinary(file, strict = true) {
  if (!fs.existsSync(file)) return false
  const size = fs.statSync(file).size
  const digest = sha256(file)
  const valid = size === lock.binary.size && digest === lock.binary.sha256
  if (!valid && strict) {
    throw new Error(`opencode 二进制校验失败：size=${size} sha256=${digest}`)
  }
  return valid
}

async function download(url, target, integrity) {
  console.log(`下载 ${url}`)
  const response = await fetch(url, {
    headers: { "user-agent": "nacho-desktop-build" },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  })
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}：${url}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (integrity) {
    const [algorithm, expected] = integrity.split("-", 2)
    const actual = crypto.createHash(algorithm).update(buffer).digest("base64")
    if (actual !== expected) throw new Error(`下载内容完整性校验失败：${url}`)
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, buffer)
}

function extractMember(tarball, member, target) {
  const archiveDir = path.dirname(tarball)
  const temporaryName = `.extract-${process.pid}-${Date.now()}`
  const temporary = path.join(archiveDir, temporaryName)
  fs.mkdirSync(temporary, { recursive: true })
  try {
    // 相对路径避免 GNU tar 把 Windows 盘符当成远程主机（C:）。
    const result = spawnSync("tar", ["-xzf", path.basename(tarball), "-C", temporaryName], {
      cwd: archiveDir,
      windowsHide: true,
      stdio: "inherit",
    })
    if (result.status !== 0) throw new Error(`解压 opencode 资产失败：${tarball}`)
    const source = path.join(temporary, member)
    if (!fs.existsSync(source)) throw new Error(`压缩包缺少 ${member}`)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

async function ensureBinary() {
  fs.mkdirSync(cacheDir, { recursive: true })
  const override = process.env.NACHO_OPENCODE_BINARY
  if (override) {
    const resolved = path.resolve(override)
    if (!verifyBinary(resolved)) throw new Error("NACHO_OPENCODE_BINARY 与锁定版本哈希不匹配")
    fs.copyFileSync(resolved, binaryTarget)
    return
  }
  if (verifyBinary(binaryTarget, false)) return
  if (!fs.existsSync(tarballTarget) || sha1(tarballTarget) !== lock.source.shasum) {
    await download(lock.source.tarball, tarballTarget, lock.source.integrity)
  }
  if (sha1(tarballTarget) !== lock.source.shasum) throw new Error("opencode npm 包 SHA-1 校验失败")
  extractMember(tarballTarget, lock.binary.path, binaryTarget)
  verifyBinary(binaryTarget)
}

async function ensureLicense() {
  if (fs.existsSync(licenseTarget)) return
  if (!fs.existsSync(licenseTarball)) {
    await download(lock.licenseSource.tarball, licenseTarball, lock.licenseSource.integrity)
  }
  extractMember(licenseTarball, lock.licenseSource.path, licenseTarget)
}

async function main() {
  await ensureBinary()
  await ensureLicense()
  console.log(`opencode ${lock.version} 已就绪：${binaryTarget}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
