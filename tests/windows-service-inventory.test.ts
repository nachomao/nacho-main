import assert from "node:assert/strict"
import test from "node:test"
import {
  filterAndSortServices,
  formatServiceBytes,
  parseWindowsServiceListResult,
  serviceControlRestrictionText,
  supportsServiceInventory,
  type WindowsServiceItem,
} from "../lib/windows-service-inventory"

const services: WindowsServiceItem[] = [
  { serviceName: "Zulu", displayName: "后端", status: "running", processId: 20, canControl: true, controlRestriction: null, sharedProcess: false, sharedServiceCount: 1, resources: { cpuPercent: 1, workingSetBytes: 4096, privateMemoryBytes: 2048 } },
  { serviceName: "Alpha", displayName: "前端", status: "running", processId: 10, canControl: false, controlRestriction: "not-allowlisted", sharedProcess: true, sharedServiceCount: 2, resources: { cpuPercent: 5, workingSetBytes: 2048, privateMemoryBytes: 1024 } },
  { serviceName: "Stopped", displayName: "停止项", status: "stopped", processId: null, canControl: false, controlRestriction: "agent-self", sharedProcess: false, sharedServiceCount: 0, resources: null },
]

test("service inventory requires Agent 1.1.18 or newer", () => {
  assert.equal(supportsServiceInventory("1.1.16"), false)
  assert.equal(supportsServiceInventory("1.1.17"), false)
  assert.equal(supportsServiceInventory("1.1.18"), true)
  assert.equal(supportsServiceInventory("1.2.0"), true)
  assert.equal(supportsServiceInventory("2.0.0"), true)
  assert.equal(supportsServiceInventory("1.1"), false)
})

test("service list parser validates counts and resource shape", () => {
  const raw = JSON.stringify({ action: "list", capturedAtUtc: "2026-08-25T00:00:00Z", sampleDurationMs: 750, total: 3, returned: 3, truncated: false, services, error: null })
  assert.equal(parseWindowsServiceListResult(raw)?.services.length, 3)
  assert.equal(parseWindowsServiceListResult(JSON.stringify({ ...JSON.parse(raw), returned: 2 })), null)
  assert.equal(parseWindowsServiceListResult(JSON.stringify({ ...JSON.parse(raw), services: [{ ...services[0], resources: { cpuPercent: "1", workingSetBytes: 1, privateMemoryBytes: 1 } }] })), null)
})

test("filter, search, sorting and formatting are deterministic", () => {
  assert.deepEqual(filterAndSortServices(services, "running", "", "cpu").map((item) => item.serviceName), ["Alpha", "Zulu"])
  assert.deepEqual(filterAndSortServices(services, "all", "后端", "name").map((item) => item.serviceName), ["Zulu"])
  assert.deepEqual(filterAndSortServices(services, "stopped", "", "memory").map((item) => item.serviceName), ["Stopped"])
  assert.equal(formatServiceBytes(1024 * 1024), "1.0 MiB")
  assert.equal(formatServiceBytes(null), "—")
  assert.equal(serviceControlRestrictionText(services[1]), "未加入目标 Agent 的 allowedServices")
  assert.equal(serviceControlRestrictionText(services[2]), "Agent 自身服务仅供查看")
})
