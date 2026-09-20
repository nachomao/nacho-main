import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, test } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "node:net"
import { once } from "node:events"
import {
  createInitialEnvironment,
  createNpmInvocation,
  ensureManagedEnvironment,
  formatExecutableCommand,
  isLocalControlPortAvailable,
  isValidLocalControlPort,
  parseEnvironmentFile,
  resolveLocalServerDirectory,
  runExecutable,
} from "../lib/local-control-server"

const temporaryDirectories: string[] = []

afterEach(async () => {
  delete process.env.NACHO_LOCAL_SERVER_DIR
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("environment parser preserves secrets containing equals signs", () => {
  const values = parseEnvironmentFile(`
# comment
HOST=127.0.0.1
PANEL_API_KEY=a=b=c
EMPTY=
INVALID
`)
  assert.equal(values.get("HOST"), "127.0.0.1")
  assert.equal(values.get("PANEL_API_KEY"), "a=b=c")
  assert.equal(values.get("EMPTY"), "")
  assert.equal(values.has("INVALID"), false)
})

test("local control ports are restricted to the non-privileged TCP range", () => {
  assert.equal(isValidLocalControlPort(1024), true)
  assert.equal(isValidLocalControlPort(65535), true)
  assert.equal(isValidLocalControlPort(1023), false)
  assert.equal(isValidLocalControlPort(65536), false)
  assert.equal(isValidLocalControlPort(8443.5), false)
  assert.equal(isValidLocalControlPort("8443"), false)
})

test("npm command files are launched through cmd.exe on Windows", () => {
  assert.deepEqual(createNpmInvocation(["--version"], "win32", "C:\\Windows\\System32\\cmd.exe"), {
    file: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", "npm.cmd", "--version"],
  })
  assert.deepEqual(createNpmInvocation(["--version"], "linux"), {
    file: "npm",
    args: ["--version"],
  })
})

test("streamed command lines quote paths containing spaces", () => {
  assert.equal(
    formatExecutableCommand("powershell.exe", ["-File", "C:\\Nacho Panel\\local-control-server.ps1", "-Port", "8443"]),
    'powershell.exe -File "C:\\Nacho Panel\\local-control-server.ps1" -Port 8443',
  )
})

test("start commands complete on process exit even when a descendant keeps stdout open", async () => {
  const parentScript = [
    'const { spawn } = require("node:child_process")',
    'const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 2500)"], { detached: true, stdio: ["ignore", process.stdout, "ignore"] })',
    "child.unref()",
    'process.stdout.write("service-started\\n")',
  ].join(";")
  const startedAt = Date.now()
  const result = await runExecutable(process.execPath, ["-e", parentScript], process.cwd(), 5_000, undefined, "exit")

  assert.match(result.stdout, /service-started/)
  assert.ok(Date.now() - startedAt < 1_500, "启动命令不应等待后代进程关闭 stdout")
})

test("local control port probe distinguishes occupied and available ports", async () => {
  const listener = createServer()
  listener.listen(0, "0.0.0.0")
  await once(listener, "listening")
  const address = listener.address()
  assert.ok(address && typeof address === "object")
  assert.equal(await isLocalControlPortAvailable(address.port), false)
  await new Promise<void>((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())))
  assert.equal(await isLocalControlPortAvailable(address.port), true)
})

test("Windows management script keeps the UTF-8 BOM required by Windows PowerShell 5.1", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url))
  const scriptPath = path.resolve(testDirectory, "../../server/deploy/windows/local-control-server.ps1")
  const script = await readFile(scriptPath)

  assert.deepEqual([...script.subarray(0, 3)], [0xef, 0xbb, 0xbf])
})

test("initial environment uses safe local defaults and independent strong secrets", () => {
  const first = createInitialEnvironment({ accessMode: "loopback", autoStart: true, port: 9555 })
  const second = createInitialEnvironment({ accessMode: "loopback", autoStart: true, port: 9555 })

  assert.equal(first.get("HOST"), "127.0.0.1")
  assert.equal(first.get("PORT"), "9555")
  assert.equal(first.get("DATABASE_PATH"), "./data/nacho.db")
  for (const key of ["PANEL_API_KEY", "ENROLLMENT_KEY", "LOCAL_CONTROL_TOKEN"]) {
    assert.match(first.get(key) || "", /^[A-Za-z0-9_-]{43}$/)
    assert.notEqual(first.get(key), second.get(key))
  }
})

test("managed environment repairs weak defaults without discarding unrelated values", () => {
  const repaired = ensureManagedEnvironment(new Map([
    ["HOST", "localhost"],
    ["PORT", "80"],
    ["PANEL_API_KEY", "change-me-panel-api-key"],
    ["ENROLLMENT_KEY", "change-me-enrollment-key"],
    ["CUSTOM_VALUE", "preserved"],
  ]))

  assert.equal(repaired.get("HOST"), "127.0.0.1")
  assert.equal(repaired.get("PORT"), "8443")
  assert.equal(repaired.get("DATABASE_PATH"), "./data/nacho.db")
  assert.equal(repaired.get("CUSTOM_VALUE"), "preserved")
  assert.match(repaired.get("PANEL_API_KEY") || "", /^[A-Za-z0-9_-]{43}$/)
  assert.match(repaired.get("ENROLLMENT_KEY") || "", /^[A-Za-z0-9_-]{43}$/)
  assert.match(repaired.get("LOCAL_CONTROL_TOKEN") || "", /^[A-Za-z0-9_-]{43}$/)
})

test("server directory resolution rejects an untrusted project and accepts the expected layout", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nacho-local-control-"))
  temporaryDirectories.push(root)
  const serverDir = path.join(root, "server")
  await mkdir(path.join(serverDir, "src"), { recursive: true })
  await mkdir(path.join(serverDir, "deploy", "windows"), { recursive: true })
  await writeFile(path.join(serverDir, "src", "index.ts"), "", "utf8")
  await writeFile(path.join(serverDir, "package.json"), JSON.stringify({ name: "not-nacho" }), "utf8")
  process.env.NACHO_LOCAL_SERVER_DIR = serverDir

  await assert.rejects(() => resolveLocalServerDirectory(), /未找到可信的 server 项目目录/)

  await writeFile(path.join(serverDir, "package.json"), JSON.stringify({ name: "nacho-server" }), "utf8")
  assert.equal(await resolveLocalServerDirectory(), serverDir)
})
