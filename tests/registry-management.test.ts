import assert from "node:assert/strict"
import test from "node:test"
import {
  inverseRegistryPayload,
  isValidRegistrySubKey,
  latestRegistryCommand,
  parseRegistryEditorValue,
  parseRegistryResult,
  registryBinaryDecodedBytes,
  registryPayload,
  type RegistryCommand,
} from "@/lib/registry-management"

test("注册表路径、整数、Base64 与 64 KiB 单值边界", () => {
  assert.equal(isValidRegistrySubKey("SOFTWARE\\Nacho\\Fixture"), true)
  assert.equal(isValidRegistrySubKey("SOFTWARE\\\\Fixture"), false)
  assert.equal(isValidRegistrySubKey("SOFTWARE\\..\\Fixture"), false)
  assert.equal(parseRegistryEditorValue("dword", "4294967295"), 4_294_967_295)
  assert.equal(parseRegistryEditorValue("qword", "9223372036854775807"), "9223372036854775807")
  assert.throws(() => parseRegistryEditorValue("qword", "9223372036854775808"), /64 位/)
  assert.equal(registryBinaryDecodedBytes("AAECAw=="), 4)
  assert.equal(registryBinaryDecodedBytes("bad"), null)
  assert.doesNotThrow(() => parseRegistryEditorValue("binary", Buffer.alloc(49_149).toString("base64")))
  assert.throws(() => parseRegistryEditorValue("binary", Buffer.alloc(49_150).toString("base64")), /64 KiB/)
})

test("四种 action 生成固定七字段严格 payload", () => {
  const base = ["HKLM", "registry64", "SOFTWARE\\Fixture"] as const
  assert.deepEqual(registryPayload("list", ...base), { action: "list", hive: "HKLM", view: "registry64", subKey: "SOFTWARE\\Fixture", valueName: null, valueKind: null, value: null })
  assert.deepEqual(registryPayload("get", ...base, "Name"), { action: "get", hive: "HKLM", view: "registry64", subKey: "SOFTWARE\\Fixture", valueName: "Name", valueKind: null, value: null })
  assert.deepEqual(registryPayload("delete", ...base, "Name"), { action: "delete", hive: "HKLM", view: "registry64", subKey: "SOFTWARE\\Fixture", valueName: "Name", valueKind: null, value: null })
  assert.deepEqual(registryPayload("set", ...base, "Name", "multiString", ["a", "b"]).value, ["a", "b"])
})

test("严格解析 list/set/delete 结果并生成逆向回滚", () => {
  const previous = { valueName: "Name", valueKind: "string", value: "old", sizeBytes: 5 } as const
  const current = { valueName: "Name", valueKind: "dword", value: 1, sizeBytes: 4 } as const
  const set = parseRegistryResult(JSON.stringify({ action: "set", hive: "HKLM", view: "registry64", subKey: "SOFTWARE\\Fixture", changed: true, values: null, previous, current, error: null }))
  assert.equal(set?.action, "set")
  assert.deepEqual(set && inverseRegistryPayload(set), { action: "set", hive: "HKLM", view: "registry64", subKey: "SOFTWARE\\Fixture", valueName: "Name", valueKind: "string", value: "old" })
  const created = parseRegistryResult(JSON.stringify({ action: "set", hive: "HKLM", view: "registry64", subKey: "SOFTWARE\\Fixture", changed: true, values: null, previous: null, current, error: null }))
  assert.equal(created && inverseRegistryPayload(created)?.action, "delete")
  const deleted = parseRegistryResult(JSON.stringify({ action: "delete", hive: "HKLM", view: "registry64", subKey: "SOFTWARE\\Fixture", changed: true, values: null, previous, current: null, error: null }))
  assert.equal(deleted && inverseRegistryPayload(deleted)?.action, "set")
  assert.equal(parseRegistryResult(JSON.stringify({ action: "list", hive: "HKLM", view: "registry64", subKey: "SOFTWARE\\Fixture", changed: false, values: [], previous: null, current: null, error: null, extra: true })), null)
})

test("刷新恢复选择最新终态注册表命令", () => {
  const command = (id: string, status: RegistryCommand["status"], createdAt: number): RegistryCommand => ({ id, clientId: "client-1", type: "manage-registry", status, result: null, exitCode: null, createdAt, updatedAt: createdAt, payload: registryPayload("list", "HKLM", "registry64", "SOFTWARE\\Fixture") })
  assert.equal(latestRegistryCommand([command("old", "success", 1), command("running", "running", 3), command("new", "success", 2)])?.id, "new")
  assert.equal(latestRegistryCommand([command("running", "running", 3)]), null)
})
