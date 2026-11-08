/* 桌面测试运行器：Qoder/Codex 代理终端会限制 Electron Chromium sandbox，
 * 且沙箱进程无法写入 %TEMP%。这里只对测试子进程做适配，不影响产品运行。 */
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")
const tempDir = path.join(root, "build", "tmp-tests")
fs.mkdirSync(tempDir, { recursive: true })

const env = {
  ...process.env,
  TEMP: tempDir,
  TMP: tempDir,
}

const electronPath = path.join(root, "node_modules", "electron", "dist", "electron.exe")
if (process.platform === "win32" && fs.existsSync(electronPath)) {
  const probe = spawnSync(electronPath, ["--version"], {
    env,
    windowsHide: true,
    encoding: "utf8",
    timeout: 8_000,
  })
  if (probe.status !== 0) {
    env.ELECTRON_DISABLE_SANDBOX = "1"
    console.warn("[desktop-tests] 当前终端无法启动 Electron sandbox；测试将设置 ELECTRON_DISABLE_SANDBOX=1 并使用工作区临时目录。")
  }
}

const testsDir = path.join(root, "tests")
const files = fs.readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.cjs"))
  .sort()
  .map((name) => path.join(testsDir, name))

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: root,
  env,
  stdio: "inherit",
  windowsHide: true,
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)
