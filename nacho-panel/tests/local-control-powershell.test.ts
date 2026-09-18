import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const scriptPath = path.resolve(testDirectory, "../../server/deploy/windows/local-control-server.ps1")
const modulePath = path.resolve(testDirectory, "../lib/local-control-server.ts")
const managerPath = path.resolve(testDirectory, "../components/local-control/local-control-server-manager.tsx")

test("Windows manager verifies the project, PID ownership, and configured listener", async () => {
  const script = await readFile(scriptPath, "utf8")

  assert.match(script, /Assert-TrustedProject/)
  assert.match(script, /\[System\.IO\.File\]::ReadAllText\(\$ManifestPath, \[System\.Text\.Encoding\]::UTF8\)/)
  assert.match(script, /Win32_Process/)
  assert.match(script, /CommandLine\.ToLowerInvariant\(\)\.Contains\(\$Expected\)/)
  assert.match(script, /Get-NetTCPConnection -State Listen -LocalPort \$Port/)
  assert.match(script, /Where-Object \{ \$_\.OwningProcess -eq \$Managed\.ProcessId \}/)
  assert.match(script, /listeningPorts = @\(\$ListeningPorts\)/)
  assert.match(script, /portOwnerPid = if \(\$PortOwner\)/)
  assert.match(script, /Console\]::OutputEncoding = \[System\.Text\.UTF8Encoding\]/)
  assert.match(script, /function Import-ManagedEnvironment/)
  assert.match(script, /SetEnvironmentVariable\(\$Matches\.key, \$Matches\.value, "Process"\)/)
  assert.match(script, /Import-ManagedEnvironment\s+[\s\S]*Start-Process -FilePath \$Runtime\.nodePath/)
})

test("Windows manager script carries a UTF-8 BOM for Windows PowerShell 5.1", async () => {
  const script = await readFile(scriptPath)

  assert.deepEqual([...script.subarray(0, 3)], [0xef, 0xbb, 0xbf])
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
  assert.match(script, /& \$Runtime\.npmPath ci --no-audit --no-fund/)
  assert.match(script, /& \$Runtime\.npmPath run build/)
  assert.match(script, /Start-Process -FilePath \$Runtime\.nodePath/)
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
  assert.match(manager, /应用端口/)
})
