const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const { killRuntimeProcess } = require("../src/ai-process.cjs")

test("killRuntimeProcess kills the recorded process tree and removes the runtime file", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-ai-process-"))
  const runtimePath = path.join(directory, "ai-runtime.json")
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  })
  t.after(() => {
    try { child.kill("SIGKILL") } catch {}
    fs.rmSync(directory, { recursive: true, force: true })
  })
  assert.ok(child.pid)
  fs.writeFileSync(runtimePath, JSON.stringify({ pid: child.pid, state: "ready" }), "utf8")
  assert.equal(killRuntimeProcess(runtimePath), true)
  assert.equal(fs.existsSync(runtimePath), false)
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve()
    child.once("exit", resolve)
    setTimeout(resolve, 3_000)
  })
  assert.notEqual(child.exitCode, null)
})

test("killRuntimeProcess tolerates missing or invalid runtime files", () => {
  assert.equal(killRuntimeProcess(path.join(os.tmpdir(), "nacho-missing-runtime.json")), false)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-ai-process-"))
  const runtimePath = path.join(directory, "ai-runtime.json")
  fs.writeFileSync(runtimePath, "{bad json", "utf8")
  assert.equal(killRuntimeProcess(runtimePath), false)
  fs.rmSync(directory, { recursive: true, force: true })
})
