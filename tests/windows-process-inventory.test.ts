import assert from "node:assert/strict"
import test from "node:test"
import {
  filterAndSortProcesses,
  formatProcessBytes,
  parseRestartProcessResult,
  parseSetProcessEfficiencyResult,
  parseWindowsProcessListResult,
  processActionRestrictionText,
  processFormSelection,
  processTerminationRestrictionText,
  supportsProcessInventory,
  supportsProcessActions,
  type WindowsProcessItem,
} from "../lib/windows-process-inventory"

const processes: WindowsProcessItem[] = [
  { processId: 42, processName: "Zulu", executablePath: "C:\\Fixtures\\zulu.exe", startedAtUtc: "2026-08-25T01:00:00Z", sessionId: 1, canTerminate: true, terminationRestriction: null, canRestart: true, restartRestriction: null, efficiencyMode: false, canSetEfficiency: true, efficiencyRestriction: null, resources: { cpuPercent: 2, workingSetBytes: 2048, privateMemoryBytes: 1024 } },
  { processId: 4, processName: "System", executablePath: null, startedAtUtc: "2026-08-25T00:00:00Z", sessionId: 0, canTerminate: false, terminationRestriction: "system", canRestart: false, restartRestriction: "system", efficiencyMode: null, canSetEfficiency: false, efficiencyRestriction: "system", resources: null },
  { processId: 7, processName: "alpha", executablePath: "C:\\Fixtures\\alpha.exe", startedAtUtc: "2026-08-25T01:00:00Z", sessionId: 1, canTerminate: false, terminationRestriction: "not-allowlisted", canRestart: false, restartRestriction: "not-allowlisted", efficiencyMode: false, canSetEfficiency: false, efficiencyRestriction: "not-allowlisted", resources: { cpuPercent: null, workingSetBytes: 4096, privateMemoryBytes: 2048 } },
  { processId: 8, processName: "Hidden", executablePath: null, startedAtUtc: null, sessionId: null, canTerminate: false, terminationRestriction: "path-unavailable", canRestart: false, restartRestriction: "path-unavailable", efficiencyMode: null, canSetEfficiency: false, efficiencyRestriction: "path-unavailable", resources: null },
]

test("process inventory requires Agent 1.1.19 or newer", () => {
  assert.equal(supportsProcessInventory("1.1.18"), false)
  assert.equal(supportsProcessInventory("1.1.19"), true)
  assert.equal(supportsProcessInventory("1.2.0"), true)
  assert.equal(supportsProcessInventory("2.0.0"), true)
  assert.equal(supportsProcessInventory("1.1"), false)
})

test("process actions require Agent 1.1.20 or newer", () => {
  assert.equal(supportsProcessActions("1.1.19"), false)
  assert.equal(supportsProcessActions("1.1.20"), true)
  assert.equal(supportsProcessActions("1.2.0"), true)
})

test("process list parser validates counts, resources and restriction invariants", () => {
  const raw = JSON.stringify({ capturedAtUtc: "2026-08-25T01:02:03Z", sampleDurationMs: 751, total: 4, returned: 4, truncated: false, processes, error: null })
  assert.equal(parseWindowsProcessListResult(raw)?.processes.length, 4)
  assert.equal(parseWindowsProcessListResult(JSON.stringify({ ...JSON.parse(raw), returned: 3 })), null)
  assert.equal(parseWindowsProcessListResult(JSON.stringify({ ...JSON.parse(raw), processes: [{ ...processes[0], canTerminate: false }] })), null)
  assert.equal(parseWindowsProcessListResult(JSON.stringify({ ...JSON.parse(raw), processes: [{ ...processes[0], canRestart: false }] })), null)
  assert.equal(parseWindowsProcessListResult(JSON.stringify({ ...JSON.parse(raw), processes: [{ ...processes[0], resources: { cpuPercent: 101, workingSetBytes: 1, privateMemoryBytes: 1 } }] })), null)
})

test("process search, sorting, formatting and selection are deterministic", () => {
  assert.deepEqual(filterAndSortProcesses(processes, "", "cpu").map((item) => item.processId), [42, 7, 8, 4])
  assert.deepEqual(filterAndSortProcesses(processes, "fixtures", "memory").map((item) => item.processId), [7, 42])
  assert.deepEqual(filterAndSortProcesses(processes, "42", "pid").map((item) => item.processId), [42])
  assert.deepEqual(filterAndSortProcesses(processes, "", "name").map((item) => item.processName), ["alpha", "Hidden", "System", "Zulu"])
  assert.equal(formatProcessBytes(1024 * 1024), "1.0 MiB")
  assert.equal(formatProcessBytes(null), "—")
  assert.deepEqual(processFormSelection(processes[0]), { processId: "42", expectedPath: "C:\\Fixtures\\zulu.exe", warning: null })
  assert.deepEqual(processFormSelection(processes[3]), { processId: "8", expectedPath: "", warning: "映像路径不可读，选择后需手工补充" })
  assert.equal(processTerminationRestrictionText(processes[1]), "系统进程由 Agent 拒绝终止")
  assert.equal(processActionRestrictionText("non-interactive-session"), "仅支持当前活动用户会话中的普通进程")
})

test("strictly parses restart and efficiency results", () => {
  const restart = JSON.stringify({ originalProcessId: 42, newProcessId: 84, expectedPath: "C:\\Fixtures\\zulu.exe", expectedStartedAtUtc: "2026-08-25T01:00:00Z", sessionId: 1, phase: "verified", stopped: true, started: true, durationMs: 20, error: null })
  const efficiency = JSON.stringify({ processId: 42, expectedPath: "C:\\Fixtures\\zulu.exe", expectedStartedAtUtc: "2026-08-25T01:00:00Z", requestedEnabled: true, initialEnabled: false, finalEnabled: true, originalPriority: "normal", finalPriority: "idle", priorityRestored: false, durationMs: 5, error: null })
  assert.equal(parseRestartProcessResult(restart)?.newProcessId, 84)
  assert.equal(parseRestartProcessResult(JSON.stringify({ ...JSON.parse(restart), started: false })), null)
  assert.equal(parseSetProcessEfficiencyResult(efficiency)?.finalEnabled, true)
  assert.equal(parseSetProcessEfficiencyResult(JSON.stringify({ ...JSON.parse(efficiency), finalPriority: "invalid" })), null)
})
