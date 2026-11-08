const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

function parseTasklistCsv(output) {
  const rows = []
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("INFO:")) continue
    const match = /^"([^"]*)","(\d+)"/.exec(trimmed)
    if (!match) continue
    const pid = Number(match[2])
    if (!Number.isInteger(pid) || pid <= 0) continue
    rows.push({ imageName: match[1], pid })
  }
  return rows
}

function imageNameMatches(actual, expected) {
  if (!actual || !expected) return false
  return String(actual).trim().toLowerCase() === String(expected).trim().toLowerCase()
}

function processImageName(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  if (process.platform !== "win32") {
    try {
      return fs.readlinkSync(`/proc/${pid}/exe`).split(/[\\/]/).pop() || null
    } catch {
      return null
    }
  }
  const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
    windowsHide: true,
    encoding: "utf8",
    timeout: 5_000,
  })
  if (result.status !== 0 || !result.stdout) return null
  return parseTasklistCsv(result.stdout).find((row) => row.pid === pid)?.imageName ?? null
}

function expectedImageName(state, fallbackBinaryPath) {
  if (state && typeof state.binaryName === "string" && state.binaryName.trim()) return state.binaryName.trim()
  if (fallbackBinaryPath) return path.basename(fallbackBinaryPath)
  return ""
}

/** 面板进程异常退出时，只清理确认仍属于 opencode 的 runtime 子进程树。 */
function killRuntimeProcess(runtimePath, fallbackBinaryPath) {
  let state
  try {
    state = JSON.parse(fs.readFileSync(runtimePath, "utf8"))
  } catch {
    try { fs.unlinkSync(runtimePath) } catch {}
    return false
  }
  const pid = state?.pid
  const expected = expectedImageName(state, fallbackBinaryPath)
  const verified = Number.isInteger(pid) && pid > 0 && expected && imageNameMatches(processImageName(pid), expected)
  if (verified) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
    } else {
      try { process.kill(pid, "SIGTERM") } catch {}
    }
  }
  try { fs.unlinkSync(runtimePath) } catch {}
  return Boolean(verified)
}

module.exports = { killRuntimeProcess, parseTasklistCsv, imageNameMatches }
