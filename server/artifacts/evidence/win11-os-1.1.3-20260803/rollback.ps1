param(
  [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"
$EvidenceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentBackup = Join-Path $EvidenceRoot "backup\nacho-agent-1.1.1.exe"
$AgentInstall = "C:\Program Files\Nacho\Agent\nacho-agent.exe"
$ExpectedAgentHash = "b3f05f83812900ad31149d924048c12dff707e8e2e2f892d93154cb550a9de8b"
$ServerBackup = "/var/backups/control-server/win11-os-1.1.3-20260803"

function Invoke-WslRoot([string[]]$Command) {
  & wsl.exe -d Debian -u root -- @Command
  if ($LASTEXITCODE -ne 0) {
    throw "WSL command failed ($LASTEXITCODE): $($Command -join ' ')"
  }
}

if (-not (Test-Path -LiteralPath $AgentBackup -PathType Leaf)) {
  throw "Agent rollback artifact is missing: $AgentBackup"
}
$backupHash = (Get-FileHash -LiteralPath $AgentBackup -Algorithm SHA256).Hash.ToLowerInvariant()
if ($backupHash -ne $ExpectedAgentHash) {
  throw "Agent rollback artifact hash mismatch."
}

foreach ($path in @(
  "$ServerBackup/control-server.tar",
  "$ServerBackup/control.db",
  "$ServerBackup/control-server.service"
)) {
  Invoke-WslRoot @("test", "-r", $path)
}

if ($VerifyOnly) {
  [pscustomobject]@{
    ready = $true
    agentBackup = $AgentBackup
    agentSha256 = $backupHash
    serverBackup = $ServerBackup
  } | ConvertTo-Json
  exit 0
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Rollback must run from an elevated PowerShell session."
}

# 先恢复控制服务端和数据库；部署过程不会改写 .env 或 systemd 单元。
Invoke-WslRoot @("systemctl", "stop", "control-server.service")
Invoke-WslRoot @("tar", "-xpf", "$ServerBackup/control-server.tar", "-C", "/opt/control-server")
Invoke-WslRoot @("install", "-o", "control", "-g", "control", "-m", "0644", "$ServerBackup/control.db", "/var/lib/control-server/control.db")
Invoke-WslRoot @("rm", "-f", "/var/lib/control-server/control.db-wal", "/var/lib/control-server/control.db-shm", "/opt/control-server/artifacts/windows/nacho-agent-1.1.3-win-x64.exe")
Invoke-WslRoot @("chown", "-R", "control:control", "/opt/control-server/src", "/opt/control-server/dist", "/opt/control-server/deploy", "/opt/control-server/artifacts")
Invoke-WslRoot @("chown", "control:control", "/opt/control-server/package.json", "/opt/control-server/package-lock.json", "/opt/control-server/tsconfig.json")
Invoke-WslRoot @("systemctl", "start", "control-server.service")
Invoke-WslRoot @("systemctl", "is-active", "control-server.service")
Invoke-WslRoot @("curl", "-fsS", "http://localhost:8443/health")

# 再恢复 Windows Agent 1.1.1，并保持原有服务启动方式不变。
$service = Get-Service -Name "NachoAgent"
$wasRunning = $service.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped
if ($wasRunning) {
  Stop-Service -Name "NachoAgent"
  (Get-Service -Name "NachoAgent").WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
}
try {
  Copy-Item -LiteralPath $AgentBackup -Destination $AgentInstall -Force
}
finally {
  if ($wasRunning) {
    Start-Service -Name "NachoAgent"
    (Get-Service -Name "NachoAgent").WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(30))
  }
}

$restored = Get-Item -LiteralPath $AgentInstall
$restoredHash = (Get-FileHash -LiteralPath $AgentInstall -Algorithm SHA256).Hash.ToLowerInvariant()
if ($restored.VersionInfo.ProductVersion -ne "1.1.1" -or $restoredHash -ne $ExpectedAgentHash) {
  throw "Agent rollback verification failed."
}

[pscustomobject]@{
  rolledBack = $true
  agentVersion = $restored.VersionInfo.ProductVersion
  agentSha256 = $restoredHash
  agentService = (Get-Service -Name "NachoAgent").Status.ToString()
  serverService = "active"
} | ConvertTo-Json
