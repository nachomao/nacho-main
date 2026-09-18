import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const scriptPath = path.resolve(testDirectory, "../../server/deploy/windows/local-control-server.ps1")
const modulePath = path.resolve(testDirectory, "../lib/local-control-server.ts")

test("Windows manager verifies the project, PID ownership, and configured listener", async () => {
  const scriptBytes = await readFile(scriptPath)
  const script = scriptBytes.toString("utf8")

  assert.deepEqual([...scriptBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  assert.match(script, /\[Console\]::OutputEncoding = \$Utf8NoBom/)
  assert.doesNotMatch(script, /\uFFFD/)
  assert.match(script, /Assert-TrustedProject/)
  assert.match(script, /Win32_Process/)
  assert.match(script, /CommandLine\.ToLowerInvariant\(\)\.Contains\(\$Expected\)/)
  assert.match(script, /Get-NetTCPConnection -State Listen -LocalPort \$SelectedPort/)
  assert.match(script, /Where-Object \{ \$_\.OwningProcess -eq \$Managed\.ProcessId \}/)
  assert.match(script, /listeningPorts = @\(\$ListeningPorts\)/)
})

test("Windows manager aborts occupied-port installs before mutation and cleans failed installs", async () => {
  const [script, module] = await Promise.all([
    readFile(scriptPath, "utf8"),
    readFile(modulePath, "utf8"),
  ])

  assert.match(script, /"AssertPortAvailable"/)
  assert.match(script, /function Assert-PortAvailable/)
  assert.match(script, /端口 \$SelectedPort 已被其他进程占用，请更换监听端口后重试。/)
  const preflight = module.indexOf('await runPowerShell(serverDir, "AssertPortAvailable", port)')
  const runtimeInstall = module.indexOf("await ensureRuntimePrerequisites(serverDir)", preflight)
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
  assert.doesNotMatch(module, /当前 Windows 架构不支持自动下载/)
  assert.match(script, /\[Environment\]::GetEnvironmentVariable\("Path", "Machine"\)/)
  assert.match(script, /\$PanelNodePath/)
  assert.match(script, /RuntimeInformation\]::OSArchitecture/)
  assert.match(script, /-p "process\.arch"/)
  assert.match(script, /Join-Path \(Split-Path -Parent \$NodePath\) "npm\.cmd"/)
  assert.match(script, /Get-Command where\.exe/)
  assert.match(script, /& \$NpmPath --version/)
  assert.match(script, /"InstallRuntime"/)
  assert.match(script, /https:\/\/nodejs\.org\/dist\/index\.json/)
  assert.match(script, /SHASUMS256\.txt/)
  assert.match(script, /Get-FileHash -LiteralPath \$ArchivePath -Algorithm SHA256/)
  assert.match(script, /\.nacho-runtime/)
  assert.match(script, /OpenJS\.NodeJS\.LTS/)
  assert.equal(script.match(/function Get-NodeRuntimeInfo/g)?.length, 1)
  assert.doesNotMatch(script, /请先安装 Microsoft App Installer/)
  assert.match(script, /& \$Runtime\.npmPath ci --no-audit --no-fund/)
  assert.match(script, /& \$Runtime\.npmPath run build/)
  assert.match(script, /Start-Process -FilePath \$Runtime\.nodePath/)
})
