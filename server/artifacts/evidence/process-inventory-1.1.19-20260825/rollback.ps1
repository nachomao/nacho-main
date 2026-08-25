param([switch]$Apply)
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$oldAgent = Join-Path $repo "server\artifacts\windows\nacho-agent-1.1.18-win-x64.exe"
$installedAgent = "C:\Program Files\Nacho\Agent\nacho-agent.exe"
$expectedOldHash = "43b69ff4ca612564d404f48c04df1539e6aa14610bac47318adc866ad878bbd0"
$wslBackup = "/opt/control-server/backups/process-inventory-20260825-161006"
$serverRollback = "/mnt/c/Users/Administrator/Documents/Codex/Nacho/nacho-main/server/artifacts/evidence/process-inventory-1.1.19-20260825/rollback-server.sh"

if (!(Test-Path -LiteralPath $oldAgent)) { throw "Agent 1.1.18 artifact is missing: $oldAgent" }
$oldHash = (Get-FileHash -LiteralPath $oldAgent -Algorithm SHA256).Hash.ToLowerInvariant()
if ($oldHash -ne $expectedOldHash) { throw "Agent 1.1.18 artifact hash mismatch" }

wsl -d Debian -u root -- bash $serverRollback --verify
if ($LASTEXITCODE -ne 0) { throw "WSL rollback backup is incomplete: $wslBackup" }

if (!$Apply) {
  Write-Output "VERIFY_ONLY_OK"
  Write-Output "Agent: $oldAgent ($oldHash)"
  Write-Output "Server backup: $wslBackup"
  Write-Output "Run with -Apply to perform rollback."
  exit 0
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Rollback requires an elevated PowerShell session."
}

$service = Get-Service -Name NachoAgent
$wasRunning = $service.Status -eq "Running"
if ($wasRunning) {
  Stop-Service -Name NachoAgent -Force
  (Get-Service -Name NachoAgent).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
}
Copy-Item -LiteralPath $oldAgent -Destination $installedAgent -Force
if ($wasRunning) {
  Start-Service -Name NachoAgent
  (Get-Service -Name NachoAgent).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
}

wsl -d Debian -u root -- bash $serverRollback
if ($LASTEXITCODE -ne 0) { throw "WSL control server rollback failed" }

$installedVersion = (Get-Item -LiteralPath $installedAgent).VersionInfo.FileVersion
if ($installedVersion -ne "1.1.18.0") { throw "Agent rollback version verification failed: $installedVersion" }
Write-Output "ROLLBACK_OK Agent=$installedVersion ServerBackup=$wslBackup"
