$ErrorActionPreference = 'Stop'

$dataDirectory = Join-Path $env:ProgramData 'Nacho'
$configPath = Join-Path $dataDirectory 'agent.json'
$backupPath = Join-Path $dataDirectory 'agent.json.before-message-push-enable.bak'
$resultPath = 'C:\Users\Administrator\Documents\Codex\Nacho\nacho-main\server\artifacts\evidence\stage6-message-push-20260807\production-policy-rollback-result.json'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this rollback from an elevated PowerShell session.'
}
if (-not (Test-Path -LiteralPath $backupPath)) {
    throw 'The original message-push policy backup was not found.'
}

$service = Get-Service -Name 'NachoAgent' -ErrorAction Stop
$serviceWasRunning = $service.Status -eq 'Running'
if ($service.Status -ne 'Stopped') {
    Stop-Service -Name 'NachoAgent' -Force -ErrorAction Stop
    (Get-Service -Name 'NachoAgent').WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
}

Copy-Item -LiteralPath $backupPath -Destination $configPath -Force
if ($serviceWasRunning) {
    Start-Service -Name 'NachoAgent' -ErrorAction Stop
    (Get-Service -Name 'NachoAgent').WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
}

$restored = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$restoredHash = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLowerInvariant()
$backupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($restoredHash -ne $backupHash) {
    throw 'The restored configuration hash does not match the protected backup.'
}

[ordered]@{
    ok = $true
    restoredPolicy = [bool]$restored.allowMessagePush
    restoredHash = $restoredHash
    backupHash = $backupHash
    service = (Get-Service -Name 'NachoAgent').Status.ToString()
    verifiedAt = [DateTimeOffset]::UtcNow.ToString('O')
} | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
