import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const scriptPath = path.resolve(testDirectory, "../../server/deploy/windows/local-control-server.ps1")

test("Windows manager verifies the project, PID ownership, and configured listener", async () => {
  const script = await readFile(scriptPath, "utf8")

  assert.match(script, /Assert-TrustedProject/)
  assert.match(script, /Win32_Process/)
  assert.match(script, /CommandLine\.ToLowerInvariant\(\)\.Contains\(\$Expected\)/)
  assert.match(script, /Get-NetTCPConnection -State Listen -LocalPort \$Port/)
  assert.match(script, /Where-Object \{ \$_\.OwningProcess -eq \$Managed\.ProcessId \}/)
  assert.match(script, /listeningPorts = @\(\$ListeningPorts\)/)
})

test("Windows manager keeps elevation scoped to firewall and autostart uses the selected port", async () => {
  const script = await readFile(scriptPath, "utf8")

  assert.match(script, /-Verb RunAs/)
  assert.match(script, /-RemoteAddress LocalSubnet/)
  assert.match(script, /HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run/)
  assert.match(script, /-Action Start -Port \{1\}/)
  assert.doesNotMatch(script, /Start-Process[^\r\n]+-Verb RunAs[^\r\n]+\$Node/)
})
