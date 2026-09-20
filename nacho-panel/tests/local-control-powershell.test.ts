import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const scriptPath = path.resolve(testDirectory, "../../server/deploy/windows/local-control-server.ps1")
const launcherPath = path.resolve(testDirectory, "../../server/deploy/windows/start-local-control-server.cjs")
const modulePath = path.resolve(testDirectory, "../lib/local-control-server.ts")
const managerPath = path.resolve(testDirectory, "../components/local-control/local-control-server-manager.tsx")

test("Windows manager verifies the project, PID ownership, and configured listener", async () => {
  const scriptBytes = await readFile(scriptPath)
  const script = scriptBytes.toString("utf8")

  assert.deepEqual([...scriptBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  assert.match(script, /\[Console\]::OutputEncoding = \$Utf8NoBom/)
  assert.doesNotMatch(script, /\uFFFD/)
  assert.match(script, /Assert-TrustedProject/)
  assert.match(script, /\[System\.IO\.File\]::ReadAllText\(\$ManifestPath, \[System\.Text\.Encoding\]::UTF8\)/)
  assert.match(script, /Win32_Process/)
  assert.match(script, /CommandLine\.ToLowerInvariant\(\)\.Contains\(\$Expected\)/)
  assert.match(script, /Get-NetTCPConnection -State Listen -LocalPort \$SelectedPort/)
  assert.match(script, /Where-Object \{ \$_\.OwningProcess -eq \$Managed\.ProcessId \}/)
  assert.match(script, /listeningPorts = @\(\$ListeningPorts\)/)
  assert.match(script, /portOwnerPid = if \(\$PortOwner\)/)
  assert.match(script, /function Import-ManagedEnvironment/)
  assert.match(script, /SetEnvironmentVariable\(\$Matches\.key, \$Matches\.value, "Process"\)/)
  assert.match(script, /Import-ManagedEnvironment\s+[\s\S]*& \$Runtime\.nodePath \$LauncherPath/)
  assert.match(script, /本机控制服务启动器未返回有效 PID/)
  assert.match(script, /Write-Output "控制服务进程已启动（PID \$ChildPid）"\s+exit 0/)
})

test("Windows manager launches the service without inheriting the install stream", async () => {
  const launcher = await readFile(launcherPath, "utf8")

  assert.match(launcher, /detached: true/)
  assert.match(launcher, /stdio: \["ignore", stdoutDescriptor, stderrDescriptor\]/)
  assert.match(launcher, /child\.unref\(\)/)
  assert.doesNotMatch(launcher, /shell: true/)
})

test("Windows manager script carries a UTF-8 BOM for Windows PowerShell 5.1", async () => {
  const script = await readFile(scriptPath)

  assert.deepEqual([...script.subarray(0, 3)], [0xef, 0xbb, 0xbf])
})

test("Windows manager aborts occupied-port installs before mutation and cleans failed installs", async () => {
  const [script, module] = await Promise.all([
    readFile(scriptPath, "utf8"),
    readFile(modulePath, "utf8"),
  ])

  assert.match(script, /"AssertPortAvailable"/)
  assert.match(script, /function Assert-PortAvailable/)
  assert.match(script, /端口 \$SelectedPort 已被其他进程占用，请更换监听端口后重试。/)
  const preflight = module.indexOf('await runPowerShell(serverDir, "AssertPortAvailable", port')
  const runtimeInstall = module.indexOf("await ensureRuntimePrerequisites(serverDir, onProgress)", preflight)
  assert.ok(preflight >= 0 && runtimeInstall > preflight)
  assert.match(module, /await runPowerShell\(serverDir, "ForceStop", port\)\.catch/)
  assert.match(module, /rm\(paths\.env, \{ force: true \}\)/)
  assert.match(module, /rm\(path\.dirname\(paths\.distEntry\), \{ recursive: true, force: true \}\)/)
  assert.match(module, /端口 \\d\+ 已被其他进程占用/)
})

test("Windows manager keeps elevation scoped to firewall and autostart uses the selected port", async () => {
  const script = await readFile(scriptPath, "utf8")

  assert.match(script, /-Verb RunAs/)
  assert.match(script, /-RemoteAddress LocalSubnet/)
  assert.match(script, /HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run/)
  assert.match(script, /-Action Start -Port \{1\}/)
  assert.doesNotMatch(script, /Start-Process[^\r\n]+-Verb RunAs[^\r\n]+\$Runtime\.nodePath/)
})

test("Windows manager reuses the panel runtime before installing a verified portable Node.js runtime", async () => {
  const [script, module] = await Promise.all([
    readFile(scriptPath, "utf8"),
    readFile(modulePath, "utf8"),
  ])

  assert.match(module, /args\.push\("-PanelNodePath", process\.execPath\)/)
  assert.match(module, /"-WindowStyle",\s*"Hidden"/)
  assert.doesNotMatch(module, /当前 Windows 架构不支持自动下载/)
  assert.match(script, /\[Environment\]::GetEnvironmentVariable\("Path", "Machine"\)/)
  assert.match(script, /\$PanelNodePath/)
  assert.match(script, /RuntimeInformation\]::OSArchitecture/)
  assert.match(script, /-p "process\.arch"/)
  assert.match(script, /Join-Path \(Split-Path -Parent \$NodePath\) "npm\.cmd"/)
  assert.match(script, /Get-Command where\.exe/)
  assert.match(script, /node_modules\\npm\\bin\\npm-cli\.js/)
  assert.match(script, /& \$NodePath \$NpmCliPath --version/)
  assert.match(script, /\$PreviousErrorActionPreference = \$ErrorActionPreference/)
  assert.match(script, /\$ErrorActionPreference = "Continue"/)
  assert.match(script, /if \(\$Candidate\.ready\)/)
  assert.match(script, /"InstallRuntime"/)
  assert.match(script, /https:\/\/nodejs\.org\/dist\/index\.json/)
  assert.match(script, /SHASUMS256\.txt/)
  assert.match(script, /Get-FileHash -LiteralPath \$ArchivePath -Algorithm SHA256/)
  assert.match(script, /\.nacho-runtime/)
  assert.match(script, /OpenJS\.NodeJS\.LTS/)
  assert.equal(script.match(/function Get-NodeRuntimeInfo/g)?.length, 1)
  assert.doesNotMatch(script, /请先安装 Microsoft App Installer/)
  assert.match(script, /Write-Output '\$ npm ci --no-audit --no-fund'/)
  assert.match(script, /& \$Runtime\.npmPath ci --no-audit --no-fund/)
  assert.match(script, /Write-Output '\$ npm run build'/)
  assert.match(script, /& \$Runtime\.npmPath run build/)
  assert.match(script, /& \$Runtime\.nodePath \$LauncherPath/)
  assert.doesNotMatch(script, /RedirectStandardOutput \$StdoutPath/)
})

test("local control install stages preserve the card transition motion", async () => {
  const manager = await readFile(managerPath, "utf8")
  const setupStage = manager.indexOf('stage="setup"')
  const installStage = manager.indexOf('stage="install"')
  const installedStage = manager.indexOf('stage="installed"')
  const completion = manager.match(/const nextStatus = await installLocalControl[\s\S]*?if \(surface !== "onboarding"/)

  assert.ok(setupStage >= 0 && installStage > setupStage && installedStage > installStage)
  assert.match(manager, /const activeStage: LocalControlStage = showInstallConsole \? "install" : status\.installed \? "installed" : "setup"/)
  assert.match(manager, /grid-template-rows 720ms \$\{LOCAL_CONTROL_STAGE_EASE\}/)
  assert.match(manager, /opacity 440ms ease/)
  assert.match(manager, /filter 520ms ease/)
  assert.match(manager, /transform 620ms \$\{LOCAL_CONTROL_STAGE_EASE\}/)
  assert.match(manager, /translateY\(8px\) scale\(0\.975\)/)
  assert.match(manager, /inert=\{!active\}/)
  assert.ok(completion)
  assert.doesNotMatch(completion[0], /setInstallOutput\(""\)/)
})

test("installed local service exposes validated port migration", async () => {
  const [module, manager] = await Promise.all([
    readFile(modulePath, "utf8"),
    readFile(managerPath, "utf8"),
  ])

  assert.match(module, /export function isLocalControlPortAvailable/)
  assert.match(module, /export function setLocalControlPort/)
  assert.match(module, /端口 \$\{port\} 已被其他进程占用/)
  assert.match(manager, /updateLocalControlPort\(Number\(port\)\)/)
  assert.match(manager, /安装命令实时输出/)
  assert.match(manager, /installLocalControl\(\{ accessMode, autoStart, port: selectedPort \}, appendOutput\)/)
  assert.match(manager, /应用端口/)
})
