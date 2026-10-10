const path = require("node:path")
const { spawnSync } = require("node:child_process")

function createCredentialProtector(executable = path.join(
  __dirname.replace(/app\.asar(?=$|[\\/])/, "app.asar.unpacked"), "nacho-credential-protector.exe",
)) {
  function run(action, input) {
    const result = spawnSync(executable, [action], {
      input, timeout: 15000, maxBuffer: 128 * 1024, windowsHide: true,
    })
    if (result.error || result.status !== 0 || !result.stdout?.length) {
      throw new Error("Windows 用户凭据保护操作失败")
    }
    return result.stdout
  }
  return {
    protect: (plaintext) => run("protect", Buffer.from(plaintext, "utf8")),
    unprotect: (ciphertext) => run("unprotect", ciphertext).toString("utf8"),
  }
}
module.exports = { createCredentialProtector }
