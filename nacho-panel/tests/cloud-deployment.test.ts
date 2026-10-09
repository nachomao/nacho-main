import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { NextRequest } from "next/server"
import type { Client } from "ssh2"
import { POST } from "../app/api/cloud-deployment/route"
import { buildCloudInstallCommand, CloudDeploymentError, resolveCloudHost, runRemote, sanitizeCloudInstallLine, validateCloudDeployInput, validateCloudHost } from "../lib/cloud-deployment"

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

test("cloud install gets the server source from GitHub on the target host", () => {
  const command = buildCloudInstallCommand("/tmp/nacho-deploy.ABC123")
  assert.match(command, /apt-get update -y/)
  assert.match(command, /dnf install -y git/)
  assert.match(command, /yum install -y git/)
  assert.match(command, /ls-remote --heads/)
  assert.match(command, /5s git/)
  assert.match(command, /--progress/)
  assert.match(command, /gh-proxy\.com/)
  assert.match(command, /ghfast\.top/)
  assert.match(command, /https:\/\/github\.com\/nachomao\/nacho-server\.git/)
  assert.match(command, /nacho-server\/deploy\/install\.sh/)
  assert.doesNotMatch(command, /bundle\.tar\.gz/)
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
  const [source, script, route, form] = await Promise.all([
    readFile(new URL("../lib/cloud-deployment.ts", import.meta.url), "utf8"),
    readFile(new URL("../../server/deploy/install.sh", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cloud-deployment/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/onboarding/cloud-deploy-form.tsx", import.meta.url), "utf8"),
  ])
  assert.match(source, /NACHO_HIDE_INSTALL_SECRETS=1 bash/)
  assert.doesNotMatch(source, /deploy\/install\.sh >\/dev\/null 2>&1/)
  assert.match(script, /if \[ "\$\{NACHO_HIDE_INSTALL_SECRETS:-0\}" != "1" \]; then/)
  assert.match(route, /type: "log", content/)
  assert.match(form, /<DeploymentStagePanel stage="install" active=\{attemptStarted && !result\}>/)
  assert.match(form, /<InstallationConsole output=\{output\} active=\{busy === "deploy"\}/)
})

test("remote deployment endpoint refuses to run outside the local Windows panel", async () => {
  const request = new NextRequest("https://preview.example/api/cloud-deployment", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://preview.example", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(input),
  })
  const response = await POST(request)
  assert.equal(response.status, 403)
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.doesNotMatch(JSON.stringify(body), /example-ssh-password/)
})
