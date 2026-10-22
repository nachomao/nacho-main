const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const { handoffLaunch } = require("../src/update-handoff.cjs")

// 安装交接脚本必须在面板退出后继续工作：面板自己会退出，不能把安装任务挂在它的生命周期上。
// Windows 上 detached 直接启动的 PowerShell 进程会立刻退出且不执行脚本，
// 因此交接必须走 cmd /c start /b，让脚本脱离父进程独立存活。

test("交接命令通过 cmd start 承载，不使用 detached 启动 PowerShell", () => {
  const launch = handoffLaunch("C:\\tmp\\finish-update.ps1", "C:\\tmp\\setup.exe",
    "C:\\Program Files\\NachoPanel\\NachoPanel.exe", 4321, "C:\\tmp\\last-result.txt")
  assert.equal(launch.file, "cmd.exe")
  assert.equal(launch.args[0], "/c")
  assert.equal(launch.args[1], "start")
  assert.ok(launch.args.includes("/b"), "必须以后台方式启动，cmd 才能立即退出")
  assert.ok(launch.args.includes("powershell.exe"))
  assert.equal(launch.options.detached, undefined, "不得依赖 detached 启动 PowerShell")
  assert.equal(launch.options.windowsHide, true)
  const joined = launch.args.join(" ")
  assert.ok(joined.includes("-File C:\\tmp\\finish-update.ps1"))
  assert.ok(joined.includes("-Installer C:\\tmp\\setup.exe"))
  assert.ok(joined.includes("-ParentPid 4321"))
  assert.ok(joined.includes("-StatusPath C:\\tmp\\last-result.txt"))
})

test("交接脚本在父进程退出后仍能完成工作", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-handoff-"))
  const marker = path.join(work, "done.txt")
  const script = path.join(work, "handoff.ps1")
  fs.writeFileSync(script, [
    "param([int]$ParentPid, [string]$StatusPath)",
    "try { Wait-Process -Id $ParentPid -Timeout 30 -ErrorAction Stop } catch { Start-Sleep -Seconds 1 }",
    "Set-Content -LiteralPath $StatusPath -Value 'started' -Encoding UTF8",
    "Start-Sleep -Milliseconds 300",
    "Set-Content -LiteralPath $StatusPath -Value 'installed' -Encoding UTF8",
  ].join("\r\n"), "utf8")

  try {
    // 面板退出后交接脚本必须继续：用一个会自行退出的父进程来模拟。
    const parent = spawn("powershell.exe",
      ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 500"], { stdio: "ignore", windowsHide: true })
    const launch = handoffLaunch(script, "unused.exe", "unused.exe", parent.pid, marker)
    const child = spawn(launch.file, launch.args, launch.options)
    child.unref()
    // cmd 只是承载者，脚本由 start 另行拉起；交接是否完成以状态文件为准。
    await new Promise((resolve) => parent.once("exit", resolve))

    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8").trim() === "installed") break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    assert.ok(fs.existsSync(marker), "交接脚本必须在父进程退出后写出状态文件")
    assert.equal(fs.readFileSync(marker, "utf8").trim(), "installed")
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})

test("detached 直接启动的 PowerShell 不执行脚本，交接不得依赖该路径", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-detached-"))
  const marker = path.join(work, "ran.txt")
  const script = path.join(work, "probe.ps1")
  fs.writeFileSync(script, `Set-Content -LiteralPath '${marker}' -Value 'ran'`, "utf8")
  try {
    const child = spawn("powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
      { detached: true, stdio: "ignore", windowsHide: true })
    child.unref()
    await new Promise((resolve) => setTimeout(resolve, 6000))
    assert.equal(fs.existsSync(marker), false,
      "detached 启动的 PowerShell 不执行脚本；交接实现必须避开这条路径")
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})
