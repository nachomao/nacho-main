import assert from "node:assert/strict"
import test from "node:test"
import {
  buildWebSocketUrl,
  clampTerminalSize,
  formatTransferBytes,
  fromBase64,
  isValidSha256,
  joinWindowsPath,
  parentWindowsPath,
  parseFileServerMessage,
  parseTerminalServerMessage,
  sha256Hex,
  splitTerminalChunk,
  splitWindowsPath,
  stripAnsi,
  terminalSizeFromPixels,
  toBase64,
} from "../lib/webssh"

test("clamps terminal size and derives it from pixels", () => {
  assert.deepEqual(clampTerminalSize(10, 1), { cols: 20, rows: 5 })
  assert.deepEqual(clampTerminalSize(9999, 9999), { cols: 240, rows: 100 })
  assert.deepEqual(terminalSizeFromPixels(720, 360), { cols: 100, rows: 20 })
  assert.deepEqual(terminalSizeFromPixels(0, 0), { cols: 120, rows: 30 })
})

test("builds websocket urls against the control server", () => {
  assert.equal(
    buildWebSocketUrl("http://127.0.0.1:8443", "/api/panel/terminal/ws?ticket=abc"),
    "ws://127.0.0.1:8443/api/panel/terminal/ws?ticket=abc",
  )
  assert.equal(
    buildWebSocketUrl("https://control.example.test/", "/api/panel/files/ws?ticket=xyz"),
    "wss://control.example.test/api/panel/files/ws?ticket=xyz",
  )
})

test("strips ANSI sequences and merges remote chunks into lines", () => {
  assert.equal(stripAnsi("\u001b[31mred\u001b[0m"), "red")
  assert.equal(stripAnsi("plain"), "plain")

  const first = splitTerminalChunk("", "hello\r\nworld")
  assert.deepEqual(first, { lines: ["hello"], partial: "world" })
  const second = splitTerminalChunk(first.partial, "!\nnext\r")
  assert.deepEqual(second, { lines: ["world!", "next"], partial: "" })
  assert.deepEqual(splitTerminalChunk("abc", ""), { lines: [], partial: "abc" })
  assert.deepEqual(splitTerminalChunk("", "\u001b[32mok\u001b[0m\n"), { lines: ["ok"], partial: "" })
})

test("strictly parses terminal server messages", () => {
  const ready = parseTerminalServerMessage(JSON.stringify({
    kind: "ready",
    sessionId: "term-1",
    clientId: "cli-1",
    shell: "powershell",
    cols: 120,
    rows: 30,
    startedAt: 1,
    seq: 0,
    reconnected: false,
    agentAttached: true,
  }))
  assert.equal(ready?.kind, "ready")

  const output = parseTerminalServerMessage(JSON.stringify({ kind: "output", seq: 3, data: "hi" }))
  assert.equal(output?.kind, "output")

  assert.equal(parseTerminalServerMessage(JSON.stringify({ kind: "ready", shell: "bash" })), null)
  assert.equal(parseTerminalServerMessage(JSON.stringify({ kind: "output", seq: "3", data: "hi" })), null)
  assert.equal(parseTerminalServerMessage(JSON.stringify({ kind: "exit", code: "x", reason: "closed" })), null)
  assert.equal(parseTerminalServerMessage("not-json"), null)
  assert.equal(parseTerminalServerMessage(JSON.stringify({ kind: "unknown" })), null)
})

test("strictly parses file server messages", () => {
  const listed = parseFileServerMessage(JSON.stringify({
    kind: "listResult",
    id: "r1",
    path: "C:\\Windows",
    entries: [{ name: "notepad.exe", type: "file", size: 12, mtimeUtc: null }],
    truncated: false,
  }))
  assert.equal(listed?.kind, "listResult")

  const error = parseFileServerMessage(JSON.stringify({ kind: "error", id: "r2", code: "IO_ERROR", message: "denied" }))
  assert.equal(error?.kind, "error")
  assert.equal(parseFileServerMessage(JSON.stringify({ kind: "nope" })), null)
  assert.equal(parseFileServerMessage(JSON.stringify({ kind: "listResult" })), null)
})

test("joins, splits and walks Windows paths", () => {
  assert.equal(joinWindowsPath("C:\\Users", "a.txt"), "C:\\Users\\a.txt")
  assert.equal(joinWindowsPath("C:\\", "a.txt"), "C:\\a.txt")
  assert.equal(parentWindowsPath("C:\\Users\\Administrator"), "C:\\Users")
  assert.equal(parentWindowsPath("C:\\Users"), "C:\\")
  assert.equal(parentWindowsPath("C:\\"), "C:\\")
  assert.deepEqual(splitWindowsPath("C:\\Users\\Administrator"), [
    { name: "C:", path: "C:\\" },
    { name: "Users", path: "C:\\Users" },
    { name: "Administrator", path: "C:\\Users\\Administrator" },
  ])
})

test("encodes chunks and hashes with SHA-256", async () => {
  const bytes = new Uint8Array([0, 1, 2, 253, 254, 255])
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes)
  assert.equal(toBase64(new TextEncoder().encode("hello")), "aGVsbG8=")
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  assert.equal(isValidSha256("a".repeat(64)), true)
  assert.equal(isValidSha256("A".repeat(64)), false)
  assert.equal(isValidSha256("a".repeat(63)), false)
})

test("formats transfer sizes for the queue", () => {
  assert.equal(formatTransferBytes(512), "512 B")
  assert.equal(formatTransferBytes(1536), "1.5 KB")
  assert.equal(formatTransferBytes(2 * 1024 * 1024), "2.0 MB")
  assert.equal(formatTransferBytes(null), "—")
})
