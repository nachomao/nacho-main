param([switch]$Purge)
$ErrorActionPreference = 'Stop'
$ServerUrl = '__NACHO_BASE_URL__'
$ServiceName = 'NachoAgent'
$InstallDir = Join-Path $env:ProgramFiles 'Nacho\Agent'
$DataDir = Join-Path $env:ProgramData 'Nacho'
$AgentPath = Join-Path $InstallDir 'nacho-agent.exe'

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
  if ($Purge) {
    $elevatedCommand = "& { & ([scriptblock]::Create((irm '$ServerUrl/uninstall.ps1'))) -Purge }"
  } else {
    $elevatedCommand = "& { irm '$ServerUrl/uninstall.ps1' | iex }"
  }
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($elevatedCommand))
  Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
  exit $LASTEXITCODE
}

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
}
if ($Purge -and (Test-Path $AgentPath) -and (Test-Path (Join-Path $DataDir 'agent.json')) -and (Test-Path (Join-Path $DataDir 'state.dat'))) {
  try {
    $unregister = Start-Process -FilePath $AgentPath -ArgumentList '--unregister' -Wait -PassThru -WindowStyle Hidden
    if ($unregister.ExitCode -ne 0) { Write-Warning "Server client record was not removed (exit $($unregister.ExitCode))." }
  } catch {
    Write-Warning "Server client record removal failed: $($_.Exception.Message)"
  }
}
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  & sc.exe delete $ServiceName | Out-Null
}
if (Test-Path $InstallDir) { Remove-Item -LiteralPath $InstallDir -Recurse -Force }
if ($Purge -and (Test-Path $DataDir)) { Remove-Item -LiteralPath $DataDir -Recurse -Force }
Write-Host 'Nacho Agent removed.'
