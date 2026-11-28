"use strict"

const { spawn } = require("node:child_process")
const { createHash } = require("node:crypto")
const { createWriteStream } = require("node:fs")
const fs = require("node:fs/promises")
const path = require("node:path")
const { Transform } = require("node:stream")
const { pipeline } = require("node:stream/promises")

function createAgeTools({ directory, resources, runner = spawn }) {
  function run(binary, args, identity, { maximum = 256, destination, asset, signal } = {}) {
    const deadline = AbortSignal.timeout(destination ? 15 * 60_000 : 15_000)
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
    const filename = path.join(resources, binary)
    const child = runner(filename, args, {
      windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"], signal: combined,
      cwd: resources,
      env: Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP"].filter((key) => process.env[key]).map((key) => [key, process.env[key]])),
    })
    let stderr = ""
    const result = new Promise((resolve, reject) => {
      child.once("error", () => reject(new Error("捆绑的 age 工具无法运行")))
      child.once("close", (code) => {
        if (code === 0) return resolve()
        const noRecipient = /no identity matched any of the recipients/i.test(stderr)
        const error = new Error(noRecipient ? "此 age 测试密钥不在解锁包中" : "age 校验或解密失败")
        if (noRecipient) error.code = "AGE_NO_RECIPIENT"
        reject(error)
      })
    })
    child.stderr.on("data", (chunk) => { if (stderr.length < 2048) stderr += String(chunk).slice(0, 2048 - stderr.length) })
    child.stdin.on("error", () => { /* 错误由子进程退出状态报告，不返回输入或 stderr */ })
    child.stdin.end(`${identity}\n`)
    let size = 0
    const chunks = []
    const hash = destination ? createHash("sha256") : null
    const receive = destination ? pipeline(child.stdout, new Transform({
      transform(chunk, _encoding, cb) {
        size += chunk.length
        if (size > asset.sizeBytes) return cb(new Error("解密后的制品超过签名大小"))
        hash.update(chunk)
        cb(null, chunk)
      },
    }), createWriteStream(destination, { flags: "wx", mode: 0o600 }), { signal: combined }) : (async () => {
      for await (const chunk of child.stdout) {
        size += chunk.length
        if (size > maximum) throw new Error("age 输出超过限制")
        chunks.push(chunk)
      }
    })()
    return Promise.all([receive, result]).then(() => {
      if (!destination) return Buffer.concat(chunks)
      if (size !== asset.sizeBytes || hash.digest("hex") !== asset.sha256) {
        throw new Error("解密后的制品大小或 SHA-256 不符")
      }
    }).catch(async (error) => {
      child.kill()
      await Promise.allSettled([receive, result])
      if (destination) await fs.rm(destination, { force: true })
      throw error
    })
  }
  async function recipientFor(identity) {
    const bytes = await run("age-keygen.exe", ["-y"], identity)
    const recipient = bytes.toString("utf8").trim()
    if (!/^age1[0-9a-z]{58}$/.test(recipient)) throw new Error("请使用 classic age 测试密钥")
    return recipient
  }
  async function decryptUnlock(ciphertext, identity, signal) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = await fs.mkdtemp(path.join(directory, "unlock-"))
    const file = path.join(temporary, "unlock.age")
    try {
      await fs.writeFile(file, ciphertext, { flag: "wx", mode: 0o600 })
      return await run("age.exe", ["-d", "-i", "-", "-o", "-", file], identity, { signal })
    } finally {
      await fs.rm(file, { force: true })
      await fs.rmdir(temporary)
    }
  }
  return {
    recipientFor, decryptUnlock,
    decryptAsset: (source, destination, identity, asset) => run("age.exe", ["-d", "-i", "-", "-o", "-", source], identity, { destination, asset }),
  }
}

module.exports = { createAgeTools }
