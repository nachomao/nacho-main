import assert from "node:assert/strict"
import test from "node:test"
import {
  formatByteSize,
  isTerminalPackageBatch,
  parseArgumentLines,
  parsePackageInstallResult,
  parseSuccessExitCodes,
  validatePackageDraft,
  type PackageDeploymentBatch,
} from "../lib/package-deployment"

const validResult = {
  phase: "success",
  downloadedBytes: 123,
  hashVerified: true,
  installerType: "msi",
  exitCode: 3010,
  rebootRequired: true,
  durationMs: 456,
  timedOut: false,
  error: null,
}

test("parses package arguments and unique success exit codes", () => {
  assert.deepEqual(parseArgumentLines("/S\r\n\r\nvalue with spaces\n"), ["/S", "value with spaces"])
  assert.deepEqual(parseSuccessExitCodes("0, 3010, 7"), [0, 3010, 7])
  assert.equal(parseSuccessExitCodes("0,0"), null)
  assert.equal(parseSuccessExitCodes("-1"), null)
  assert.equal(parseSuccessExitCodes("abc"), null)
})

test("validates MSI and EXE draft metadata boundaries", () => {
  const exe = { name: "fixture.exe", size: 128 } as File
  const msi = { name: "fixture.msi", size: 128 } as File
  assert.equal(validatePackageDraft({ file: exe, displayName: "Fixture", version: "1.0.0", installerType: "exe", arguments: ["/S"], successExitCodes: [0] }), null)
  assert.equal(validatePackageDraft({ file: msi, displayName: "Fixture", version: "1.0.0", installerType: "msi", arguments: ["PROPERTY=value"], successExitCodes: [0, 3010] }), null)
  assert.match(validatePackageDraft({ file: msi, displayName: "Fixture", version: "", installerType: "msi", arguments: ["/quiet"], successExitCodes: [0, 3010] }) ?? "", /PROPERTY=value/)
  assert.match(validatePackageDraft({ file: msi, displayName: "Fixture", version: "", installerType: "msi", arguments: [], successExitCodes: [0] }) ?? "", /3010/)
  assert.match(validatePackageDraft({ file: exe, displayName: "", version: "", installerType: "exe", arguments: [], successExitCodes: [0] }) ?? "", /展示名/)
})

test("strictly parses package install results", () => {
  assert.deepEqual(parsePackageInstallResult(JSON.stringify(validResult)), validResult)
  assert.equal(parsePackageInstallResult(JSON.stringify({ ...validResult, installerType: "zip" })), null)
  assert.equal(parsePackageInstallResult(JSON.stringify({ ...validResult, extra: true })), null)
  const { timedOut: _timedOut, ...missing } = validResult
  assert.equal(parsePackageInstallResult(JSON.stringify(missing)), null)
  assert.equal(parsePackageInstallResult("not-json"), null)
})

test("formats package sizes and recognizes terminal batch states", () => {
  assert.equal(formatByteSize(512), "512 B")
  assert.equal(formatByteSize(1024), "1.0 KiB")
  assert.equal(formatByteSize(1024 * 1024), "1.0 MiB")
  const batch = (status: PackageDeploymentBatch["status"]) => ({ status }) as PackageDeploymentBatch
  assert.equal(isTerminalPackageBatch(batch("pending")), false)
  assert.equal(isTerminalPackageBatch(batch("running")), false)
  assert.equal(isTerminalPackageBatch(batch("success")), true)
  assert.equal(isTerminalPackageBatch(batch("completed-with-failures")), true)
})
