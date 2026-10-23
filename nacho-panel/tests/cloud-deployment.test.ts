import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { EventEmitter } from "node:events"
import { readFile } from "node:fs/promises"
import { createServer, type AddressInfo } from "node:net"
import { test } from "node:test"
import { NextRequest } from "next/server"
import type { Client } from "ssh2"
import { POST } from "../app/api/cloud-deployment/route"
import { buildCloudFirewallCleanupCommand, buildCloudFirewallCommand, buildCloudInstallCommand, buildCloudPortWarning, checkCloudDeploymentAvailability, CLOUD_DEPLOY_PORT, CloudDeploymentError, describeCloudFirewallReport, parseCloudFirewallReport, probeCloudPort, resolveCloudHost, runRemote, sanitizeCloudInstallLine, validateCloudDeployInput, validateCloudHost } from "../lib/cloud-deployment"

const input = {
  action: "deploy",
  host: "192.0.2.12",
  username: "deploy-user",
  password: "example-ssh-password",
  fingerprint: `SHA256:${"A".repeat(43)}`,
}

test("IPv4 and DNS hostnames are accepted; local, reserved and malformed targets are rejected", () => {
  assert.equal(validateCloudHost("192.0.2.12"), "192.0.2.12")
  assert.equal(validateCloudHost("10.1.2.3"), "10.1.2.3")
  assert.equal(validateCloudHost("MaoJiu.CC"), "maojiu.cc")
  assert.equal(validateCloudHost("server.example.com"), "server.example.com")
  for (const host of ["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "224.0.0.1", "::ffff:127.0.0.1", "1.2.3.4;id", "https://example.com", "example.com:22", "bad_name.example", "-bad.example", "example..com", "example.123", "a".repeat(64) + ".example"]) {
    assert.throws(() => validateCloudHost(host), CloudDeploymentError)
  }
})

test("domain A records are validated and pinned before SSH; literals bypass DNS", async () => {
  const resolver = async (host: string) => {
    assert.equal(host, "server.example.com")
    return ["192.0.2.12", "192.0.2.10"]
  }
  assert.equal(await resolveCloudHost("SERVER.EXAMPLE.COM", resolver), "192.0.2.10")
  assert.equal(await resolveCloudHost("192.0.2.12", async () => { throw new Error("DNS should not run") }), "192.0.2.12")
  for (const addresses of [[], ["127.0.0.1"], ["192.0.2.10", "169.254.169.254"], ["::1"]]) {
    await assert.rejects(resolveCloudHost("server.example.com", async () => addresses), CloudDeploymentError)
  }
  await assert.rejects(resolveCloudHost("localhost.localdomain", async () => ["127.0.0.1"]), /回环/)
  await assert.rejects(resolveCloudHost("server.example.com", async () => { throw new Error("NXDOMAIN") }), /DNS A 记录/)
})

test("SSH credentials and confirmed fingerprint have strict shapes", () => {
  assert.deepEqual(validateCloudDeployInput(input), {
    host: input.host,
    username: input.username,
    password: input.password,
    fingerprint: input.fingerprint,
  })
  assert.equal(validateCloudDeployInput({ ...input, host: "MaoJiu.CC" }).host, "maojiu.cc")
  for (const invalid of [
    { username: "root; whoami" },
    { password: "line1\nline2" },
    { password: "" },
    { fingerprint: "SHA256:unverified" },
    { injected: "other" },
  ]) {
    assert.throws(() => validateCloudDeployInput({ ...input, ...invalid }), CloudDeploymentError)
  }
})

test("cloud install prefers the pinned GitHub source archive and falls back to git clone", () => {
  const command = buildCloudInstallCommand("/tmp/nacho-deploy.ABC123")
  assert.match(command, /apt-get update -y/)
  assert.match(command, /dnf install -y git/)
  assert.match(command, /yum install -y git/)
  assert.match(command, /codeload\.github\.com\/nachomao\/nacho-server\/tar\.gz\/\$\{commit\}/)
  assert.match(command, /api\.github\.com\/repos\/nachomao\/nacho-server\/git\/ref\/heads\/main/)
  assert.match(command, /ls-remote --heads/)
  assert.match(command, /5s git/)
  assert.match(command, /--progress/)
  assert.match(command, /--strip-components=1/)
  assert.match(command, /gh-proxy\.com/)
  assert.match(command, /ghproxy\.net/)
  assert.match(command, /https:\/\/github\.com\/nachomao\/nacho-server\.git/)
  assert.match(command, /nacho-server\/deploy\/install\.sh/)
  assert.match(command, /源码包获取失败，回退 Git 克隆/)
  assert.doesNotMatch(command, /ghfast\.top/)
  assert.doesNotMatch(command, /bundle\.tar\.gz/)
})

test("the composed install command parses with a POSIX shell", () => {
  const probe = spawnSync("sh", ["-c", "true"])
  if (probe.error || probe.status !== 0) return
  const command = buildCloudInstallCommand("/tmp/nacho-deploy.ABC123")
  const result = spawnSync("sh", ["-n", "-c", command], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  assert.match(command, /' \|\| bash -c '/)
})

test("cloud deployment is available on local Windows and Linux panels only", () => {
  assert.deepEqual(checkCloudDeploymentAvailability({ platform: "win32", hostname: "localhost" }), { allowed: true })
  assert.deepEqual(checkCloudDeploymentAvailability({ platform: "linux", hostname: "127.0.0.1" }), { allowed: true })
  assert.deepEqual(checkCloudDeploymentAvailability({ platform: "linux", hostname: "LOCALHOST" }), { allowed: true })
  assert.deepEqual(checkCloudDeploymentAvailability({ platform: "linux", hostname: "[::1]" }), { allowed: true })
  const hosted = checkCloudDeploymentAvailability({ platform: "linux", hostname: "localhost", hosted: true })
  assert.equal(hosted.allowed, false)
  assert.match(hosted.allowed === false ? hosted.message : "", /托管部署环境/)
  const unsupported = checkCloudDeploymentAvailability({ platform: "darwin", hostname: "localhost" })
  assert.equal(unsupported.allowed, false)
  assert.match(unsupported.allowed === false ? unsupported.message : "", /Windows 或 Linux/)
  const remote = checkCloudDeploymentAvailability({ platform: "linux", hostname: "panel.example.com" })
  assert.equal(remote.allowed, false)
  assert.match(remote.allowed === false ? remote.message : "", /本机地址/)
})

test("Windows local endpoint enforces same-origin and validates input before SSH", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!
  const vercel = process.env.VERCEL
  Object.defineProperty(process, "platform", { ...platform, value: "win32" })
  delete process.env.VERCEL
  const request = (site: string, body: unknown) => new NextRequest("http://localhost:3000/api/cloud-deployment", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", "sec-fetch-site": site },
    body: JSON.stringify(body),
  })
  try {
    assert.equal((await POST(request("cross-site", { action: "inspect", host: input.host }))).status, 403)
    assert.equal((await POST(request("same-origin", { action: "inspect", host: "127.0.0.1" }))).status, 400)
    assert.equal((await POST(request("same-origin", { ...input, fingerprint: "unverified" }))).status, 400)
    assert.equal((await POST(request("same-origin", { action: "inspect", host: input.host, password: input.password }))).status, 400)
  } finally {
    Object.defineProperty(process, "platform", platform)
    if (vercel === undefined) delete process.env.VERCEL
    else process.env.VERCEL = vercel
  }
})

test("Linux local panel passes the deployment gate and keeps the request checks", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!
  const vercel = process.env.VERCEL
  Object.defineProperty(process, "platform", { ...platform, value: "linux" })
  delete process.env.VERCEL
  const request = (site: string, body: unknown) => new NextRequest("http://localhost:3000/api/cloud-deployment", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", "sec-fetch-site": site },
    body: JSON.stringify(body),
  })
  try {
    assert.equal((await POST(request("same-origin", { action: "inspect", host: "127.0.0.1" }))).status, 400)
    assert.equal((await POST(request("same-origin", { ...input, fingerprint: "unverified" }))).status, 400)
    assert.equal((await POST(request("same-origin", { action: "inspect", host: input.host, password: input.password }))).status, 400)
    assert.equal((await POST(request("cross-site", { action: "inspect", host: input.host }))).status, 403)
  } finally {
    Object.defineProperty(process, "platform", platform)
    if (vercel === undefined) delete process.env.VERCEL
    else process.env.VERCEL = vercel
  }
})

test("SSH stdout and stderr stream by line without losing split UTF-8 or exposing secrets", async () => {
  const lines: string[] = []
  const channel = new EventEmitter() as EventEmitter & { stderr: EventEmitter; end: (value?: string) => void; close: () => void }
  channel.stderr = new EventEmitter()
  channel.close = () => channel.emit("close", -1)
  channel.end = (value) => {
    assert.equal(value, "ssh-secret\n")
    channel.emit("data", Buffer.from("npm ci\r\n"))
    assert.deepEqual(lines, ["npm ci"])
    const unicode = Buffer.from("编译完成\n")
    channel.emit("data", unicode.subarray(0, 2))
    channel.emit("data", unicode.subarray(2))
    channel.stderr.emit("data", Buffer.from("PANEL_API_KEY=private-key\n错误详情\n"))
    channel.emit("data", Buffer.from("ssh-secret\n"))
    channel.emit("close", 0)
  }
  const client = { exec(_command: string, callback: (error: Error | null, stream: typeof channel) => void) { callback(null, channel) } } as unknown as Client
  const result = await runRemote(client, "sudo bash install.sh", "ssh-secret", (line) => lines.push(sanitizeCloudInstallLine(line, "ssh-secret")))
  assert.equal(result.code, 0)
  assert.deepEqual(lines, ["npm ci", "编译完成", "[Nacho] 已隐藏敏感输出", "错误详情", "[Nacho] 已隐藏敏感输出"])
  assert.doesNotMatch(lines.join(" "), /private-key|ssh-secret/)
  assert.equal(sanitizeCloudInstallLine("\u001b[1;32m[install]\u001b[0m 构建完成", "ssh-secret"), "[install] 构建完成")
  assert.equal(sanitizeCloudInstallLine("注册密钥: private-key", "ssh-secret"), "[Nacho] 已隐藏敏感输出")
})

test("cloud install streams real output but keeps installer keys out of its summary", async () => {
  const [source, route, form] = await Promise.all([
    readFile(new URL("../lib/cloud-deployment.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cloud-deployment/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/onboarding/cloud-deploy-form.tsx", import.meta.url), "utf8"),
  ])
  assert.match(source, /NACHO_HIDE_INSTALL_SECRETS=1 bash/)
  assert.doesNotMatch(source, /deploy\/install\.sh >\/dev\/null 2>&1/)
  assert.match(route, /type: "log", content/)
  assert.match(form, /<DeploymentStagePanel stage="install" active=\{attemptStarted && !result\}>/)
  assert.match(form, /<InstallationConsole output=\{output\} active=\{busy === "deploy"\}/)
})

test("remote deployment endpoint refuses to run outside a local panel", async () => {
  const request = new NextRequest("https://preview.example/api/cloud-deployment", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://preview.example", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(input),
  })
  const response = await POST(request)
  assert.equal(response.status, 403)
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.match(body.message, /本机地址/)
  assert.doesNotMatch(JSON.stringify(body), /example-ssh-password/)
})

test("cloud firewall command opens only managed firewalls and never edits raw rules", () => {
  assert.equal(CLOUD_DEPLOY_PORT, 8443)
  const command = buildCloudFirewallCommand(8443)
  for (const fragment of [
    'grep -qi "^Status: active"',
    'ufw allow "$PORT/tcp"',
    'firewall-cmd --query-port="$PORT/tcp"',
    'firewall-cmd --permanent --add-port="$PORT/tcp"',
    "firewall-cmd --reload",
    "nft list ruleset",
    "iptables -S",
    "NACHO_FIREWALL backend=$backend",
  ]) {
    assert.ok(command.includes(fragment), `缺少片段：${fragment}`)
  }
  assert.ok(!command.includes("iptables -I"))
  assert.ok(!command.includes("nft add"))
  assert.ok(!command.includes("ufw disable"))
  assert.equal(buildCloudFirewallCleanupCommand(8443, "ufw"), "ufw delete allow 8443/tcp")
  assert.match(buildCloudFirewallCleanupCommand(8443, "firewalld"), /--remove-port=8443\/tcp/)
  assert.equal(buildCloudFirewallCleanupCommand(8443, "nftables"), "")

  const probe = spawnSync("sh", ["-c", "true"])
  if (probe.error || probe.status !== 0) return
  const parsed = spawnSync("sh", ["-n", "-c", command], { encoding: "utf8" })
  assert.equal(parsed.status, 0, parsed.stderr)
})

test("firewall report parsing derives whether the panel opened the port", () => {
  assert.deepEqual(
    parseCloudFirewallReport("ufw status\nNACHO_FIREWALL backend=ufw active=yes allowed_before=no allowed_after=yes\r\n"),
    { backend: "ufw", active: true, allowed: true, opened: true },
  )
  assert.deepEqual(
    parseCloudFirewallReport("NACHO_FIREWALL backend=firewalld active=yes allowed_before=yes allowed_after=yes"),
    { backend: "firewalld", active: true, allowed: true, opened: false },
  )
  assert.deepEqual(
    parseCloudFirewallReport("NACHO_FIREWALL backend=nftables active=yes allowed_before=no allowed_after=no"),
    { backend: "nftables", active: true, allowed: false, opened: false },
  )
  assert.deepEqual(
    parseCloudFirewallReport("NACHO_FIREWALL backend=none active=no allowed_before=no allowed_after=no"),
    { backend: "none", active: false, allowed: false, opened: false },
  )
  assert.equal(parseCloudFirewallReport("目标服务器没有可用的防火墙标记"), null)
})

test("firewall report becomes readable deployment logs", () => {
  const opened = describeCloudFirewallReport({ backend: "ufw", active: true, allowed: true, opened: true }, 8443)
  assert.ok(opened.some((line) => line.includes("此前未放行")))
  assert.ok(opened.some((line) => line.includes("已放行")))
  const failed = describeCloudFirewallReport({ backend: "firewalld", active: true, allowed: false, opened: false }, 8443)
  assert.ok(failed.some((line) => line.includes("放行未生效")))
  const raw = describeCloudFirewallReport({ backend: "iptables", active: true, allowed: false, opened: false }, 8443)
  assert.ok(raw.some((line) => line.includes("未自动修改")))
  assert.ok(describeCloudFirewallReport(null, 8443)[0].includes("无法确认"))
  assert.ok(describeCloudFirewallReport({ backend: "none", active: false, allowed: false, opened: false }, 8443)[0].includes("未检测到"))
})

test("TCP port probe distinguishes a listening port from a closed one", async () => {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const port = (server.address() as AddressInfo).port
  assert.equal(await probeCloudPort("127.0.0.1", port, 1_000), true)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  assert.equal(await probeCloudPort("127.0.0.1", port, 1_000), false)
})

test("cloud port warning names the suspected cloud firewall policy", () => {
  const allowed = buildCloudPortWarning({ localFirewall: { backend: "ufw", active: true, allowed: true, opened: false } })
  assert.match(allowed, /疑似腾讯云/)
  assert.match(allowed, /安全组或云防火墙/)
  assert.match(allowed, /8443/)
  assert.match(allowed, /重试验证/)
  assert.match(allowed, /ufw/)
  const unknown = buildCloudPortWarning({ localFirewall: null })
  assert.match(unknown, /无法确认服务器本机防火墙状态/)
  assert.match(unknown, /iptables\/nftables/)
  const raw = buildCloudPortWarning({ localFirewall: { backend: "iptables", active: true, allowed: false, opened: false } })
  assert.match(raw, /iptables/)
  const absent = buildCloudPortWarning({ localFirewall: { backend: "none", active: false, allowed: false, opened: false } })
  assert.match(absent, /未检测到运行中的本机防火墙/)
})

test("cloud deployment checks the firewall and reports an unreachable public port", async () => {
  const [source, form] = await Promise.all([
    readFile(new URL("../lib/cloud-deployment.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/onboarding/cloud-deploy-form.tsx", import.meta.url), "utf8"),
  ])
  assert.match(source, /onProgress\("检测并尝试放行 8443 端口防火墙"\)/)
  assert.match(source, /buildCloudFirewallCommand\(CLOUD_DEPLOY_PORT\)/)
  assert.match(source, /probeCloudPort\(address, CLOUD_DEPLOY_PORT\)/)
  assert.match(source, /return \{ api, key: secret\.output, warning \}/)
  assert.match(form, /deployment\.warning/)
  assert.match(form, /疑似云防火墙策略拦截 8443 端口/)
  assert.match(form, /部署时会自动检测并尝试放行 8443 端口防火墙/)
})
