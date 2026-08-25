param([switch]$Apply)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$oldAgent = Join-Path $repo "server\artifacts\windows\nacho-agent-1.1.19-win-x64.exe"
$installedAgent = "C:\Program Files\Nacho\Agent\nacho-agent.exe"
$expectedOldHash = "651ff062833d182cf5e87bcf3b20e380be3393ece8d4ba0dda9fd12818c97688"
$wslBackup = "/opt/control-server/backups/process-actions-1.1.20-20260825-174036"
$serverRollback = "/mnt/c/Users/Administrator/Documents/Codex/Nacho/nacho-main/server/artifacts/evidence/process-actions-1.1.20-20260825/rollback-server.sh"
if (!(Test-Path -LiteralPath $oldAgent)) { throw "Agent 1.1.19 artifact is missing: $oldAgent" }
$oldHash = (Get-FileHash -LiteralPath $oldAgent -Algorithm SHA256).Hash.ToLowerInvariant()
if ($oldHash -ne $expectedOldHash) { throw "Agent 1.1.19 artifact hash mismatch" }
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
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Rollback requires an elevated PowerShell session." }
$service = Get-Service -Name NachoAgent
$wasRunning = $service.Status -eq "Running"
if ($wasRunning) { Stop-Service NachoAgent -Force; (Get-Service NachoAgent).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30)) }
Copy-Item -LiteralPath $oldAgent -Destination $installedAgent -Force
if ($wasRunning) { Start-Service NachoAgent; (Get-Service NachoAgent).WaitForStatus("Running", [TimeSpan]::FromSeconds(30)) }
wsl -d Debian -u root -- bash $serverRollback
if ($LASTEXITCODE -ne 0) { throw "WSL control server rollback failed" }
$installedVersion = (Get-Item -LiteralPath $installedAgent).VersionInfo.FileVersion
if ($installedVersion -ne "1.1.19.0") { throw "Agent rollback version verification failed: $installedVersion" }
Write-Output "ROLLBACK_OK Agent=$installedVersion ServerBackup=$wslBackup"
