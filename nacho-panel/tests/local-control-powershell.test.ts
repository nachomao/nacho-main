import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

// Windows 本机服务管理脚本属于服务端仓库，脚本自身的断言由
// nacho-server/src/tests/windows-local-control.test.ts 维护；
// 面板侧只验证面板如何调用这些脚本与动作。
const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const modulePath = path.resolve(testDirectory, "../lib/local-control-server.ts")
const managerPath = path.resolve(testDirectory, "../components/local-control/local-control-server-manager.tsx")
const progressPath = path.resolve(testDirectory, "../components/local-control/deployment-progress.tsx")

test("Windows manager aborts occupied-port installs before mutation and cleans failed installs", async () => {
  const module = await readFile(modulePath, "utf8")

  assert.match(module, /await runPowerShell\(serverDir, "AssertPortAvailable", port/)
  const preflight = module.indexOf('await runPowerShell(serverDir, "AssertPortAvailable", port')
  const runtimeInstall = module.indexOf("await ensureRuntimePrerequisites(serverDir, onProgress)", preflight)
  assert.ok(preflight >= 0 && runtimeInstall > preflight)
  assert.match(module, /await runPowerShell\(serverDir, "ForceStop", port\)\.catch/)
  assert.match(module, /rm\(paths\.env, \{ force: true \}\)/)
  assert.match(module, /rm\(path\.join\(serverDir, "dist"\), \{ recursive: true, force: true \}\)/)
  assert.match(module, /端口 \\d\+ 已被其他进程占用/)
})

test("Windows manager keeps elevation scoped to firewall and autostart uses the selected port", async () => {
  const module = await readFile(modulePath, "utf8")

  assert.match(module, /"SetFirewall"/)
  assert.match(module, /"RemoveFirewall"/)
  assert.match(module, /"EnableAutostart"/)
  assert.match(module, /"DisableAutostart"/)
  assert.match(module, /await runPowerShell\(serverDir, "SetFirewall", port, POWERSHELL_TIMEOUT_MS, onProgress\)/)
  assert.match(module, /await runPowerShell\(serverDir, "EnableAutostart", port, POWERSHELL_TIMEOUT_MS, onProgress\)/)
  assert.match(module, /await runPowerShell\(serverDir, "DisableAutostart", port\)\.catch/)
  assert.match(module, /await runPowerShell\(serverDir, "RemoveFirewall", port\)\.catch/)
})

test("Windows manager reuses the panel runtime before installing a verified portable Node.js runtime", async () => {
  const module = await readFile(modulePath, "utf8")

  assert.match(module, /args\.push\("-PanelNodePath", process\.execPath\)/)
  assert.match(module, /STATUS_POWERSHELL_TIMEOUT_MS/)
  assert.match(module, /runtimeProbeSucceeded/)
  assert.match(module, /"-WindowStyle",\s*"Hidden"/)
  assert.doesNotMatch(module, /当前 Windows 架构不支持自动下载/)
  assert.match(module, /"InstallRuntime"/)
})

test("local control install stages preserve the card transition motion", async () => {
  const [manager, progress] = await Promise.all([readFile(managerPath, "utf8"), readFile(progressPath, "utf8")])
  const setupStage = manager.indexOf('stage="setup"')
  const installStage = manager.indexOf('stage="install"')
  const installedStage = manager.indexOf('stage="installed"')
  const completion = manager.match(/const nextStatus = await installLocalControl[\s\S]*?if \(surface !== "onboarding"/)

  assert.ok(setupStage >= 0 && installStage > setupStage && installedStage > installStage)
  assert.match(manager, /const activeStage: LocalControlStage = showInstallConsole \? "install" : status\.installed \? "installed" : "setup"/)
  assert.match(manager, /<DeploymentStagePanel stage="install"/)
  assert.match(progress, /grid-template-rows 720ms \$\{DEPLOYMENT_STAGE_EASE\}/)
  assert.match(progress, /opacity 440ms ease/)
  assert.match(progress, /filter 520ms ease/)
  assert.match(progress, /transform 620ms \$\{DEPLOYMENT_STAGE_EASE\}/)
  assert.match(progress, /translateY\(8px\) scale\(0\.975\)/)
  assert.match(progress, /inert=\{!active\}/)
  assert.match(manager, /data-local-control-expandable/)
  assert.match(manager, /grid-template-rows 560ms \$\{LOCAL_CONTROL_STAGE_EASE\}, margin-bottom 560ms/)
  assert.match(manager, /transform: open \? "translateY\(0\)" : "translateY\(-10px\)"/)
  assert.match(manager, /<LocalControlExpandable open=\{runtimeMissing\} compact=\{!onboarding\}>/)
  assert.match(manager, /<LocalControlExpandable open=\{accessMode === "lan"\} compact=\{!onboarding\}>/)
  assert.match(manager, /useState<InstallationOutputChunk\[\]>\(\[\]\)/)
  assert.match(manager, /const id = installOutputIdRef\.current/)
  assert.match(manager, /\{ id, content \}/)
  assert.match(progress, /element\.animate\(/)
  assert.match(progress, /filter: "blur\(8px\)"/)
  assert.match(progress, /transform: "translateY\(7px\)"/)
  assert.match(progress, /setConsoleHeight\(nextHeight\)/)
  assert.match(progress, /transition: reducedMotion \? "none" : `height 460ms \$\{DEPLOYMENT_STAGE_EASE\}`/)
  assert.ok(completion)
  assert.doesNotMatch(completion[0], /setInstallOutput\(""\)/)
})

test("installed local service exposes validated port migration", async () => {
  const [module, manager, progress] = await Promise.all([
    readFile(modulePath, "utf8"),
    readFile(managerPath, "utf8"),
    readFile(progressPath, "utf8"),
  ])

  assert.match(module, /export function isLocalControlPortAvailable/)
  assert.match(module, /export function setLocalControlPort/)
  assert.match(module, /端口 \$\{port\} 已被其他进程占用/)
  assert.match(manager, /updateLocalControlPort\(Number\(port\)\)/)
  assert.match(progress, /安装命令实时输出/)
  assert.match(manager, /installLocalControl\(\{ accessMode, autoStart, port: selectedPort \}, appendOutput\)/)
  assert.match(manager, /应用端口/)
})
