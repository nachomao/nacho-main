import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { NextRequest } from "next/server"
import { extract } from "tar"
import { POST } from "../app/api/cloud-deployment/route"
import { CloudDeploymentError, createBundle, validateCloudDeployInput, validateCloudHost } from "../lib/cloud-deployment"

const input = {
  action: "deploy",
  host: "192.0.2.12",
  username: "deploy-user",
  password: "example-ssh-password",
  fingerprint: `SHA256:${"A".repeat(43)}`,
}

test("only literal IPv4 cloud hosts are accepted; local and metadata targets are rejected", () => {
  assert.equal(validateCloudHost("192.0.2.12"), "192.0.2.12")
  assert.equal(validateCloudHost("10.1.2.3"), "10.1.2.3")
  for (const host of ["localhost", "server.example.com", "127.0.0.1", "0.0.0.0", "169.254.169.254", "224.0.0.1", "::ffff:127.0.0.1", "1.2.3.4;id"]) {
    assert.throws(() => validateCloudHost(host), CloudDeploymentError)
  }
})

test("SSH credentials and confirmed fingerprint have strict shapes", () => {
  assert.deepEqual(validateCloudDeployInput(input), {
    host: input.host,
    username: input.username,
    password: input.password,
    fingerprint: input.fingerprint,
  })
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

test("bundle contains only required source and verified Agent artifact, never local secrets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nacho-bundle-test-"))
  try {
    const server = path.join(root, "server")
    const unpack = path.join(root, "unpack")
    await mkdir(path.join(server, "artifacts/windows"), { recursive: true })
    await mkdir(path.join(server, "src"))
    await mkdir(path.join(server, "deploy"))
    await mkdir(unpack)
    const fileName = "nacho-agent-1.2.3-win-x64.exe"
    const artifact = Buffer.from("released-agent")
    await writeFile(path.join(server, "artifacts/windows", fileName), artifact)
    await writeFile(path.join(server, "artifacts/windows/latest.json"), JSON.stringify({
      fileName, sha256: createHash("sha256").update(artifact).digest("hex"),
    }))
    await writeFile(path.join(server, "package.json"), "{}")
    await writeFile(path.join(server, "package-lock.json"), "{}")
    await writeFile(path.join(server, "tsconfig.json"), "{}")
    await writeFile(path.join(server, "src/index.ts"), "export {}")
    await writeFile(path.join(server, "deploy/install.sh"), "#!/bin/sh")
    await writeFile(path.join(server, "deploy/uninstall.sh"), "#!/bin/sh")
    await writeFile(path.join(server, ".env"), "PANEL_API_KEY=secret")
    const bundle = path.join(root, "bundle.tar.gz")
    await createBundle(server, bundle)
    await extract({ file: bundle, cwd: unpack })
    assert.deepEqual(await readFile(path.join(unpack, "artifacts/windows", fileName)), artifact)
    await assert.rejects(access(path.join(unpack, ".env")))
    await writeFile(path.join(server, "artifacts/windows/latest.json"), JSON.stringify({ fileName, sha256: "0".repeat(64) }))
    await assert.rejects(createBundle(server, bundle), /SHA-256/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
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
