import assert from "node:assert/strict"
import test from "node:test"
import { defaultStoredSettings } from "../lib/ai/settings-schema"
import { findNachoTool, listNachoTools, validateToolArgs } from "../lib/ai/tool-registry"

test("tool list respects enabled skills and plugins", () => {
  const settings = defaultStoredSettings()
  const names = listNachoTools(settings).map((tool) => tool.id)
  assert.equal(names.includes("nacho_list_clients"), true)
  assert.equal(names.includes("nacho_run_shell"), true)
  assert.equal(names.includes("nacho_collect_logs"), true)
  assert.equal(names.includes("nacho_set_timer"), true)
  assert.equal(names.includes("nacho_start_local_job"), true)
  assert.equal(names.includes("nacho_backup"), false) // p-backup 默认关闭
  assert.equal(names.includes("nacho_list_tasks"), false) // s-task 默认关闭

  const withoutOps = {
    ...settings,
    skills: settings.skills.map((skill) => ({ ...skill, enabled: skill.id !== "s-ops" })),
  }
  const opsNames = listNachoTools(withoutOps).map((tool) => tool.id)
  assert.equal(opsNames.includes("nacho_run_shell"), false)
  assert.equal(opsNames.includes("nacho_list_services"), false)
  assert.equal(opsNames.includes("nacho_list_clients"), true)
})

test("mcp tool names are the suffix and resolve back to full ids", () => {
  const tool = findNachoTool("run_shell")
  assert.equal(tool?.id, "nacho_run_shell")
  assert.equal(findNachoTool("nacho_run_shell")?.mcpName, "run_shell")
  assert.equal(findNachoTool("unknown"), null)
  assert.equal(findNachoTool("list_clients")?.inputSchema.type, "object")
})

test("timer and local job tool schemas are exposed and validated", () => {
  assert.equal(findNachoTool("set_timer")?.id, "nacho_set_timer")
  assert.equal(findNachoTool("start_local_job")?.id, "nacho_start_local_job")
  const timer = findNachoTool("set_timer")
  assert.ok(timer)
  assert.deepEqual(validateToolArgs(timer.inputSchema, { afterSeconds: 1800, reminder: "检查日志" }), [])
  assert.equal(validateToolArgs(timer.inputSchema, { afterSeconds: 9, reminder: "检查" }).length > 0, true)
  assert.equal(validateToolArgs(timer.inputSchema, { afterSeconds: 60 }).some((message) => message.includes("reminder")), true)
  const job = findNachoTool("start_local_job")
  assert.ok(job)
  assert.equal(validateToolArgs(job.inputSchema, { command: "npm run build" }).length, 0)
  assert.equal(validateToolArgs(job.inputSchema, { command: "x", shell: "bash" }).some((message) => message.includes("shell")), true)
})

test("argument validation catches required, extra, enum and range errors", () => {
  const tool = findNachoTool("run_shell")
  assert.ok(tool)
  assert.equal(validateToolArgs(tool.inputSchema, {}).some((message) => message.includes("script")), true)
  assert.equal(validateToolArgs(tool.inputSchema, { clientId: "c1", script: "echo hi", extra: 1 }).some((message) => message.includes("extra")), true)
  assert.equal(validateToolArgs(tool.inputSchema, { clientId: "c1", script: "echo hi", shell: "bash" }).some((message) => message.includes("shell")), true)
  assert.equal(validateToolArgs(tool.inputSchema, { clientId: "c1", script: "echo hi", timeoutSeconds: 1000 }).some((message) => message.includes("timeoutSeconds")), true)
  assert.deepEqual(validateToolArgs(tool.inputSchema, { clientId: "c1", script: "echo hi", timeoutSeconds: 30 }), [])
})
