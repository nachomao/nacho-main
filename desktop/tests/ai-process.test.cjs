const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const { imageNameMatches, killRuntimeProcess, parseTasklistCsv } = require("../src/ai-process.cjs")

function startNodeProcess() {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  })
}

test("killRuntimeProcess kills the recorded process tree and removes the runtime file", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-ai-process-"))
  const runtimePath = path.join(directory, "ai-runtime.json")
  const child = startNodeProcess()
  t.after(() => {
    try { child.kill("SIGKILL") } catch {}
    fs.rmSync(directory, { recursive: true, force: true })
  })
  assert.ok(child.pid)
  fs.writeFileSync(runtimePath, JSON.stringify({
    pid: child.pid,
    state: "ready",
    binaryName: path.basename(process.execPath),
  }), "utf8")
  assert.equal(killRuntimeProcess(runtimePath), true)
  assert.equal(fs.existsSync(runtimePath), false)
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve()
    child.once("exit", resolve)
    setTimeout(resolve, 3_000)
  })
  assert.notEqual(child.exitCode, null)
})

test("killRuntimeProcess uses the fallback binary for legacy runtime files", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-ai-process-"))
  const runtimePath = path.join(directory, "ai-runtime.json")
  const child = startNodeProcess()
  t.after(() => {
    try { child.kill("SIGKILL") } catch {}
    fs.rmSync(directory, { recursive: true, force: true })
  })
  assert.ok(child.pid)
  fs.writeFileSync(runtimePath, JSON.stringify({ pid: child.pid, state: "ready" }), "utf8")
  assert.equal(killRuntimeProcess(runtimePath, process.execPath), true)
  assert.equal(fs.existsSync(runtimePath), false)
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve()
    child.once("exit", resolve)
    setTimeout(resolve, 3_000)
  })
  assert.notEqual(child.exitCode, null)
})

test("killRuntimeProcess never kills a PID whose image name does not match", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-ai-process-"))
  const runtimePath = path.join(directory, "ai-runtime.json")
  const child = startNodeProcess()
  t.after(() => {
    try { child.kill("SIGKILL") } catch {}
    fs.rmSync(directory, { recursive: true, force: true })
  })
  assert.ok(child.pid)
  fs.writeFileSync(runtimePath, JSON.stringify({
    pid: child.pid,
    state: "ready",
    binaryName: "nacho-not-this-process.exe",
  }), "utf8")
  assert.equal(killRuntimeProcess(runtimePath), false)
  assert.equal(fs.existsSync(runtimePath), false)
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(child.exitCode, null)
})

test("killRuntimeProcess tolerates missing, invalid and unverified runtime files", () => {
  assert.equal(killRuntimeProcess(path.join(os.tmpdir(), "nacho-missing-runtime.json")), false)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-ai-process-"))
  const runtimePath = path.join(directory, "ai-runtime.json")
  fs.writeFileSync(runtimePath, "{bad json", "utf8")
  assert.equal(killRuntimeProcess(runtimePath), false)
  fs.writeFileSync(runtimePath, JSON.stringify({ pid: process.pid, state: "ready" }), "utf8")
  assert.equal(killRuntimeProcess(runtimePath), false)
  assert.equal(fs.existsSync(runtimePath), false)
  fs.rmSync(directory, { recursive: true, force: true })
})

test("tasklist CSV parsing and image name matching are strict", () => {
  const rows = parseTasklistCsv([
    '"opencode.exe","1234","Console","1","10,000 K"',
    '"node.exe","88","Console","1","1,000 K"',
    "INFO: No tasks are running which match the specified criteria.",
  ].join("\r\n"))
  assert.deepEqual(rows, [
    { imageName: "opencode.exe", pid: 1234 },
    { imageName: "node.exe", pid: 88 },
  ])
  assert.equal(imageNameMatches("OpenCode.exe", "opencode.exe"), true)
  assert.equal(imageNameMatches("node.exe", "opencode.exe"), false)
  assert.equal(imageNameMatches(null, "opencode.exe"), false)
})
