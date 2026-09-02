param(
  [string]$Baseline = (Join-Path $PSScriptRoot 'original\uninstall.ps1'),
  [string]$Modified = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')) 'server\deploy\windows\uninstall.ps1')
)

$ErrorActionPreference = 'Stop'

function Test-Script([string]$Label, [string]$Path, [bool]$ExpectZeroResidue) {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $Path), [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count -ne 0) { throw "$Label parse failed: $($errors -join '; ')" }

  $content = Get-Content -LiteralPath $Path -Raw
  $checks = [ordered]@{
    historicalBackupCleanup = $content.Contains('$HistoricalBackupDir')
    serviceDeletionWait = $content.Contains("still registered after deletion")
    finalResidueAssertion = $content.Contains('uninstall left residue')
  }
  $actual = -not ($checks.Values -contains $false)
  if ($actual -ne $ExpectZeroResidue) { throw "$Label zero-residue contract mismatch: $($checks | ConvertTo-Json -Compress)" }

  Write-Output "$Label command: powershell Parser::ParseFile + managed-path contract checks"
  Write-Output "$Label input: $Path"
  Write-Output "$Label output: parse=PASS; zeroResidueContract=$actual; checks=$($checks | ConvertTo-Json -Compress)"
  Write-Output "$Label exit: 0"
}

Test-Script -Label 'baseline' -Path $Baseline -ExpectZeroResidue $false
Test-Script -Label 'modified' -Path $Modified -ExpectZeroResidue $true

