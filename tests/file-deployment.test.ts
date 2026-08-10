import assert from "node:assert/strict"
import test from "node:test"
import {
  isRollbackEligible,
  isTerminalFileBatch,
  isValidWindowsDestinationPath,
  parseFileDeployResult,
  parseFileRollbackResult,
  validateFileDraft,
  type FileDeployCommand,
  type FileDeploymentBatch,
} from "../lib/file-deployment"

const deployResult = {
  phase: "success",
  downloadedBytes: 12,
  hashVerified: true,
  destinationPath: "C:\\Deploy\\config.json",
  conflictPolicy: "replace",
  replaced: true,
  backupValid: true,
  backupPath: "C:\\ProgramData\\Nacho\\file-deployments\\cmd-0123456789ab\\backup.bin",
  previousSha256: "a".repeat(64),
  finalSha256: "b".repeat(64),
  durationMs: 10,
  error: null,
} as const

test("validates Windows destination path boundaries", () => {
  assert.equal(isValidWindowsDestinationPath("C:\\Deploy\\config.json"), true)
  assert.equal(isValidWindowsDestinationPath("relative\\config.json"), false)
  assert.equal(isValidWindowsDestinationPath("\\\\server\\share\\config.json"), false)
  assert.equal(isValidWindowsDestinationPath("C:\\Deploy\\config.json:stream"), false)
  assert.equal(isValidWindowsDestinationPath("C:\\Deploy\\*.json"), false)
  assert.equal(isValidWindowsDestinationPath("C:\\Deploy\\"), false)
})

test("validates file size, display name, and destination", () => {
  const file = { name: "config.json", size: 12 } as File
  assert.equal(validateFileDraft(file, "config.json", "C:\\Deploy\\config.json"), null)
  assert.match(validateFileDraft(null, "config.json", "C:\\Deploy\\config.json") ?? "", /请选择/)
  assert.match(validateFileDraft({ name: "empty", size: 0 } as File, "empty", "C:\\Deploy\\empty") ?? "", /大小/)
  assert.match(validateFileDraft(file, "", "C:\\Deploy\\config.json") ?? "", /展示名/)
  assert.match(validateFileDraft(file, "config.json", "relative") ?? "", /绝对文件路径/)
})

test("strictly parses deploy and rollback results", () => {
  assert.deepEqual(parseFileDeployResult(JSON.stringify(deployResult)), deployResult)
  assert.equal(parseFileDeployResult(JSON.stringify({ ...deployResult, extra: true })), null)
  assert.equal(parseFileDeployResult(JSON.stringify({ ...deployResult, finalSha256: "bad" })), null)
  const rollback = { phase: "success", originalCommandId: "cmd-0123456789ab", destinationPath: "C:\\Deploy\\config.json", backupValid: false, restoredSha256: "a".repeat(64), error: null }
  assert.deepEqual(parseFileRollbackResult(JSON.stringify(rollback)), rollback)
  assert.equal(parseFileRollbackResult(JSON.stringify({ ...rollback, backupValid: "false" })), null)
})

test("recognizes terminal batches and rollback eligibility", () => {
  const batch = (status: FileDeploymentBatch["status"]) => ({ status }) as FileDeploymentBatch
  assert.equal(isTerminalFileBatch(batch("pending")), false)
  assert.equal(isTerminalFileBatch(batch("running")), false)
  assert.equal(isTerminalFileBatch(batch("success")), true)
  const command = { type: "deploy-file", status: "success" } as FileDeployCommand
  assert.equal(isRollbackEligible(deployResult, command), true)
  assert.equal(isRollbackEligible({ ...deployResult, backupValid: false }, command), false)
  assert.equal(isRollbackEligible(deployResult, { ...command, status: "running" }), false)
})
