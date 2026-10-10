const assert = require("node:assert/strict")
const { createHash } = require("node:crypto")
const fs = require("node:fs/promises")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const {
  downloadFile, fetchGitHubJson, cloneGitHub, candidates, contentRange,
  PROBE_TIMEOUT_MS, PARALLEL_MIN_BYTES, ensureAria2, runProcess,
} = require("../src/github-download.cjs")

const URL = "https://github.com/example/project/releases/download/v1.0.0/file.bin"
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")

async function fixture(context, size = PARALLEL_MIN_BYTES) {
  const bytes = Buffer.alloc(size, 37)
  bytes[size - 1] = 91
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nacho-download-test-"))
  const state = { peak: 0, active: 0, requests: [], behavior: null }
  const events = []
  const server = http.createServer((request, response) => {
    const source = request.url.split("/")[1]
    const range = request.headers.range
    const probe = range === "bytes=0-0"
    const entry = { source, range, probe, headers: request.headers }
    state.requests.push(entry)
    if (state.behavior?.(entry, request, response)) return
    if (range) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(range)
      const start = Number(match[1]), end = Number(match[2])
      if (!probe) { state.active++; state.peak = Math.max(state.peak, state.active) }
      response.once("close", () => { if (!probe) state.active-- })
      const send = () => {
        response.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": end - start + 1, "Content-Type": "application/octet-stream" })
        response.end(bytes.subarray(start, end + 1))
      }
      if (probe) send()
      else setTimeout(send, start === 0 ? 40 : 10)
    } else {
      response.writeHead(200, { "Content-Length": size, "Content-Type": "application/octet-stream" })
      response.end(bytes)
    }
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const fetcher = (url, init) => {
    const source = url.startsWith("https://gh-proxy.com/") ? "first" :
      url.startsWith("https://ghfast.top/") ? "second" : "direct"
    return fetch(`${origin}/${source}`, init)
  }
  context.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(directory, { recursive: true, force: true })
  })
  return { bytes, directory, state, fetcher, events, output: path.join(directory, "file.bin"),
    options: { fetcher, platform: "win32", sizeBytes: size, sha256: digest(bytes), probeTimeoutMs: 1000,
      onPhase: (phase) => events.push({ phase }),
      onProgress: (bytes, total) => events.push({ bytes, total }) } }
}

test("defaults retain five-second probing, public API mirror support and strict Content-Range", () => {
  assert.equal(PROBE_TIMEOUT_MS, 5000)
  assert.equal(candidates(URL).length, 3)
  assert.equal(candidates("https://api.github.com/repos/example/project", "api").length, 2)
  assert.equal(candidates("https://example.org/file.bin").length, 1)
  assert.deepEqual(contentRange("bytes 0-0/100"), { start: 0, end: 0, total: 100 })
  assert.equal(contentRange("bytes 0-100/100"), null)
  assert.equal(contentRange("bytes */100"), null)
})

test("GitHub range downloads use four concurrent connections and assemble out-of-order segments", async (context) => {
  const f = await fixture(context)
  const result = await downloadFile(URL, f.output, f.options)
  assert.equal(result.source, "GitHub")
  assert.equal(result.connections, 4)
  assert.equal(f.state.peak, 4)
  assert.deepEqual(await fs.readFile(f.output), f.bytes)
  assert.equal(f.state.requests.filter((request) => !request.probe && request.range).length, 4)
  assert.equal((await fs.readdir(f.directory)).length, 1)
  const progress = f.events.filter((event) => event.bytes !== undefined)
  assert.equal(progress[0].bytes, 0)
  assert.equal(progress.at(-1).bytes, f.bytes.length)
  assert.ok(progress.every((event, index) => event.total === f.bytes.length &&
    event.bytes <= f.bytes.length && (!index || event.bytes >= progress[index - 1].bytes)))
  assert.deepEqual(f.events.filter((event) => event.phase).map((event) => event.phase),
    ["connecting", "downloading", "verifying"])
  assert.equal(f.events.at(-2).bytes, f.bytes.length, "校验开始前已经报告完整实际字节")
})

test("a hanging direct probe is cancelled at the shared deadline and selects the first mirror", async (context) => {
  const f = await fixture(context, 1024)
  f.state.behavior = (entry) => entry.source === "direct"
  const began = Date.now()
  const result = await downloadFile(URL, f.output, { ...f.options, probeTimeoutMs: 80 })
  assert.equal(result.source, "gh-proxy.com")
  assert.ok(Date.now() - began < 1000)
  assert.deepEqual(await fs.readFile(f.output), f.bytes)
})

test("direct and first-mirror errors select the second mirror", async (context) => {
  const f = await fixture(context, 1024)
  f.state.behavior = (entry, _request, response) => {
    if (entry.source === "second") return false
    response.writeHead(502); response.end()
    return true
  }
  assert.equal((await downloadFile(URL, f.output, f.options)).source, "ghfast.top")
})

test("all unavailable sources fail without creating partial files", async (context) => {
  const f = await fixture(context, 1024)
  f.state.behavior = (_entry, _request, response) => { response.writeHead(503); response.end(); return true }
  await assert.rejects(downloadFile(URL, f.output, f.options), /均不可用/)
  assert.deepEqual(await fs.readdir(f.directory), [])
})

test("probes follow redirects to the actual file endpoint", async (context) => {
  const f = await fixture(context, 1024)
  f.state.behavior = (entry, request, response) => {
    if (request.url !== "/direct") return false
    response.writeHead(302, { Location: "/redirected" }); response.end()
    return true
  }
  assert.equal((await downloadFile(URL, f.output, f.options)).source, "GitHub")
  assert.ok(f.state.requests.some((entry) => entry.source === "redirected"))
  assert.deepEqual(await fs.readFile(f.output), f.bytes)
})

test("non-GitHub downloads and small GitHub files use a single connection", async (context) => {
  const f = await fixture(context, 1024)
  const result = await downloadFile("https://example.org/file.bin", f.output, f.options)
  assert.equal(result.connections, 1)
  assert.equal(f.state.requests.length, 1)
  assert.equal(f.state.requests[0].range, undefined)
  assert.equal(f.events[0].phase, "connecting")
  assert.equal(f.events[1].phase, "downloading")
  assert.equal(f.events.at(-2).bytes, f.bytes.length)
  assert.equal(f.events.at(-1).phase, "verifying")
  const second = await downloadFile(URL, f.output, f.options)
  assert.equal(second.connections, 1)
})

test("a server that ignores Range uses a single download without rejecting a slow connected source", async (context) => {
  const f = await fixture(context)
  f.state.behavior = (entry, _request, response) => {
    if (!entry.probe) return false
    response.writeHead(200, { "Content-Length": f.bytes.length })
    response.write(f.bytes.subarray(0, 1))
    const timer = setTimeout(() => response.end(f.bytes.subarray(1)), 300)
    response.once("close", () => clearTimeout(timer))
    return true
  }
  const result = await downloadFile(URL, f.output, f.options)
  assert.equal(result.source, "GitHub")
  assert.equal(result.connections, 1)
})

test("wrong range responses cancel all segments and restart with one connection", async (context) => {
  const f = await fixture(context)
  f.state.behavior = (entry, _request, response) => {
    if (!entry.range || entry.probe || !entry.range.startsWith("bytes=0-")) return false
    setTimeout(() => {
      response.writeHead(206, { "Content-Range": `bytes 0-1/${f.bytes.length}`, "Content-Length": 2 })
      response.end(f.bytes.subarray(0, 2))
    }, 80)
    return true
  }
  const result = await downloadFile(URL, f.output, f.options)
  assert.equal(result.connections, 1)
  assert.deepEqual(await fs.readFile(f.output), f.bytes)
  const retry = f.events.findIndex((event) => event.phase === "retrying")
  assert.ok(f.events.slice(0, retry).some((event) => event.bytes > 0), "回退前已经写入部分分段")
  assert.deepEqual(f.events.slice(retry, retry + 3), [
    { phase: "retrying" }, { phase: "downloading" }, { bytes: 0, total: f.bytes.length },
  ])
  assert.equal(f.events.at(-2).bytes, f.bytes.length)
  assert.equal(f.events.at(-1).phase, "verifying")
})

test("interrupted downloads discard all segments before switching to a mirror", async (context) => {
  const f = await fixture(context)
  f.state.behavior = (entry, request) => {
    if (entry.source !== "direct" || entry.probe) return false
    request.socket.destroy()
    return true
  }
  const result = await downloadFile(URL, f.output, f.options)
  assert.equal(result.source, "gh-proxy.com")
  assert.deepEqual(await fs.readFile(f.output), f.bytes)
  assert.deepEqual(await fs.readdir(f.directory), ["file.bin"])
})

test("单连接收到部分字节后换源，重试重新从零计算下载进度", async (context) => {
  const f = await fixture(context, 64 * 1024)
  f.state.behavior = (entry, _request, response) => {
    if (entry.source !== "direct" || entry.probe) return false
    response.writeHead(200, { "Content-Length": f.bytes.length })
    response.write(f.bytes.subarray(0, f.bytes.length / 2))
    setTimeout(() => response.destroy(), 30)
    return true
  }
  const result = await downloadFile(URL, f.output, f.options)
  assert.equal(result.source, "gh-proxy.com")
  const retry = f.events.findIndex((event) => event.phase === "retrying")
  assert.ok(f.events.slice(0, retry).some((event) => event.bytes > 0))
  assert.deepEqual(f.events.slice(retry, retry + 4), [
    { phase: "retrying" }, { phase: "connecting" }, { phase: "downloading" }, { bytes: 0, total: f.bytes.length },
  ])
  assert.equal(f.events.at(-2).bytes, f.bytes.length)
  assert.equal(f.events.at(-1).phase, "verifying")
  assert.deepEqual(await fs.readFile(f.output), f.bytes)
})

test("SHA-256 mismatches cannot replace an existing verified file", async (context) => {
  const f = await fixture(context, 1024)
  await fs.writeFile(f.output, "previous-verified-file")
  await assert.rejects(downloadFile(URL, f.output, { ...f.options, sha256: "a".repeat(64) }), /SHA-256/)
  assert.equal(await fs.readFile(f.output, "utf8"), "previous-verified-file")
  assert.deepEqual(await fs.readdir(f.directory), ["file.bin"])
  assert.equal(f.events.at(-2).bytes, f.bytes.length)
  assert.equal(f.events.at(-1).phase, "verifying", "完整收齐后进入真实校验，失败不能声称安装成功")
})

test("public API probes reject invalid JSON and never send credentials to mirrors", async () => {
  const calls = []
  const data = await fetchGitHubJson("https://api.github.com/repos/example/project", {
    fetcher: async (url, init) => {
      calls.push({ url, headers: new Headers(init.headers) })
      return new Response(url.startsWith("https://api.") ? "Invalid input." : '{"ok":true}')
    },
    validate: (object) => object.ok === true,
  })
  assert.equal(data.ok, true)
  assert.equal(calls.length, 2)
  assert.ok(calls.every((call) => !call.headers.has("authorization")))
  await assert.rejects(fetchGitHubJson("https://api.github.com/test", {
    headers: { Authorization: "Bearer never-transmit" },
  }), /认证凭据/)
})

test("Linux reuses aria2 or prepares it once and passes four-connection arguments", async (context) => {
  const f = await fixture(context)
  let installed = false, preparations = 0
  const invocations = []
  const processRunner = async (file, args) => {
    invocations.push({ file, args })
    if (args[0] === "--version") return { code: installed ? 0 : 1, stdout: "", stderr: "" }
    await fs.writeFile(path.join(args[args.indexOf("--dir") + 1], args[args.indexOf("--out") + 1]), f.bytes)
    return { code: 0, stdout: "", stderr: "" }
  }
  const options = { ...f.options, platform: "linux", processRunner,
    prepareAria2: async () => { installed = true; preparations++ } }
  assert.equal((await downloadFile(URL, f.output, options)).connections, 4)
  assert.equal(preparations, 1)
  assert.ok(invocations.some((call) => call.args.includes("--split=4") &&
    call.args.includes("--max-connection-per-server=4") && call.args.includes("--max-concurrent-downloads=1")))
  await downloadFile(URL, f.output, options)
  assert.equal(preparations, 1)
})

test("failed Linux tool installation falls back to a single connection", async (context) => {
  const f = await fixture(context)
  const messages = []
  const result = await downloadFile(URL, f.output, { ...f.options, platform: "linux",
    processRunner: async () => ({ code: 1, stdout: "", stderr: "" }),
    prepareAria2: async () => { throw new Error("permission denied") }, onLog: (message) => messages.push(message) })
  assert.equal(result.connections, 1)
  assert.ok(messages.some((message) => /permission denied/.test(message)))
  assert.deepEqual(await fs.readFile(f.output), f.bytes)
})

test("an unavailable privileged installer never grants sudo privileges", async () => {
  let calls = 0
  assert.equal(await ensureAria2({ processRunner: async (file) => {
    calls++; assert.equal(file, "aria2c"); return { code: 1, stdout: "", stderr: "" }
  } }), false)
  assert.equal(calls, 1)
})

test("Git probes and clone fallback use the actual repository and restore its canonical remote", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nacho-git-download-"))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const destination = path.join(directory, "source")
  const calls = []
  const sha = "d".repeat(40)
  await cloneGitHub("https://github.com/example/project.git", destination, {
    processRunner: async (_file, args, options) => {
      calls.push({ args, options })
      if (args.includes("ls-remote")) {
        return { code: args.includes("https://github.com/example/project.git") ? 1 : 0,
          stdout: `${sha}\trefs/heads/main\n`, stderr: "" }
      }
      if (args.includes("clone")) await fs.mkdir(destination)
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  const clone = calls.find((call) => call.args.includes("clone"))
  assert.ok(clone.args.includes("https://gh-proxy.com/https://github.com/example/project.git"))
  assert.ok(clone.args.includes("--progress"))
  assert.equal(clone.options.env.GIT_TERMINAL_PROMPT, "0")
  assert.deepEqual(calls.at(-1).args, ["-C", destination, "remote", "set-url", "origin",
    "https://github.com/example/project.git"])
})

test("a clone transport failure clears its partial directory before trying another source", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nacho-git-retry-"))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const destination = path.join(directory, "source")
  let attempts = 0
  await cloneGitHub("https://github.com/example/project.git", destination, {
    processRunner: async (_file, args) => {
      if (args.includes("ls-remote")) return { code: 0, stdout: `${"d".repeat(40)}\trefs/heads/main\n`, stderr: "" }
      if (args.includes("clone")) {
        assert.equal(await fs.lstat(destination).then(() => true, () => false), false)
        await fs.mkdir(destination)
        if (++attempts === 1) return { code: 128, stdout: "", stderr: "network reset" }
      }
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.equal(attempts, 2)
})

test("cancelled process probes terminate descendants and return promptly", async () => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error("probe deadline")), 150)
  const began = Date.now()
  try {
    await assert.rejects(runProcess(process.execPath, ["-e",
      'require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});setInterval(()=>{},1000)'],
    { signal: controller.signal }), /probe deadline/)
    assert.ok(Date.now() - began < 1500)
  } finally { clearTimeout(timer) }
})
