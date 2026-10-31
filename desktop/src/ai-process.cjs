const fs = require("node:fs")
const { spawnSync } = require("node:child_process")

/** 面板进程异常退出时，按 runtime 文件清理 opencode 子进程树。 */
function killRuntimeProcess(runtimePath) {
  let state
  try {
    state = JSON.parse(fs.readFileSync(runtimePath, "utf8"))
  } catch {
    return false
  }
  const pid = state?.pid
  if (!Number.isInteger(pid) || pid <= 0) {
    try { fs.unlinkSync(runtimePath) } catch {}
    return false
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
  } else {
    try { process.kill(pid, "SIGTERM") } catch {}
  }
  try { fs.unlinkSync(runtimePath) } catch {}
  return true
}

module.exports = { killRuntimeProcess }
