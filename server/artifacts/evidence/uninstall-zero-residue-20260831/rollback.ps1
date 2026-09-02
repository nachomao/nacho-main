$ErrorActionPreference = 'Stop'
$original = Join-Path $PSScriptRoot 'original\uninstall.ps1'
$expectedHash = ((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'original\SHA256.txt') -Raw).Trim() -split '\s+')[0]
$actualHash = (Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) { throw "Rollback source hash mismatch: $actualHash" }

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')
$target = Join-Path $repoRoot 'server\deploy\windows\uninstall.ps1'
Copy-Item -LiteralPath $original -Destination $target -Force
foreach ($relative in @('server\src\services\clients.ts', 'server\src\routes\agent.ts', 'server\src\tests\commands.test.ts')) {
  $source = Join-Path $PSScriptRoot (Join-Path 'original-workspace' $relative)
  Copy-Item -LiteralPath $source -Destination (Join-Path $repoRoot $relative) -Force
}
Remove-Item -LiteralPath (Join-Path $repoRoot 'server\src\tests\uninstall-script.test.ts') -Force -ErrorAction SilentlyContinue

$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($target, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -ne 0) { throw "Rolled-back script parse failed: $($errors -join '; ')" }
$restoredHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
if ($restoredHash -ne $expectedHash) { throw "Rollback verification hash mismatch: $restoredHash" }
Write-Output "rollback output: restored=$target; source/tests restored; sha256=$restoredHash; parse=PASS"
Write-Output 'rollback exit: 0'
