import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createSettingsStore } from "../lib/ai/settings-store"
import { defaultStoredSettings } from "../lib/ai/settings-schema"

const protector = {
  protect: (plaintext: string) => Buffer.from(`enc:${plaintext}`, "utf8"),
  unprotect: (ciphertext: Buffer) => {
    const value = ciphertext.toString("utf8")
    if (!value.startsWith("enc:")) throw new Error("bad ciphertext")
    return value.slice(4)
  },
}

async function withStore(run: (store: ReturnType<typeof createSettingsStore>, filePath: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nacho-ai-settings-"))
  const filePath = path.join(directory, "ai-settings.json")
  try {
    await run(createSettingsStore({ filePath, protector }), filePath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("missing settings file yields defaults", async () => {
  await withStore(async (store) => {
    const snapshot = await store.read()
    assert.equal(snapshot.exists, false)
    assert.equal(snapshot.recovered, false)
    assert.equal(snapshot.config.apiKey, "")
    assert.equal(snapshot.config.model, "gpt-5.2")
  })
})

test("settings are encrypted at rest and round-trip", async () => {
  await withStore(async (store, filePath) => {
    const config = {
      ...defaultStoredSettings(),
      apiKey: "sk-secret-1234567890",
      mcpServers: [{
        id: "m1", name: "M1", url: "https://mcp.example.com/mcp", status: "connected" as const,
        tools: 1, token: "mcp-secret-token",
      }],
    }
    const saved = await store.write(config)
    assert.equal(saved.config.apiKey, config.apiKey)
    const raw = await readFile(filePath, "utf8")
    assert.equal(raw.includes("sk-secret-1234567890"), false)
    assert.equal(raw.includes("mcp-secret-token"), false)
    const loaded = await store.read()
    assert.equal(loaded.config.apiKey, config.apiKey)
    assert.equal(loaded.config.mcpServers[0].token, "mcp-secret-token")
  })
})

test("corrupt settings return defaults without deleting the file", async () => {
  await withStore(async (store, filePath) => {
    await writeFile(filePath, JSON.stringify({ version: 1, scheme: "windows-dpapi-current-user", ciphertext: Buffer.from("enc:{bad json").toString("base64") }), "utf8")
    const snapshot = await store.read()
    assert.equal(snapshot.recovered, true)
    assert.equal(snapshot.config.apiKey, "")
    const raw = await readFile(filePath, "utf8")
    assert.equal(raw.includes("ciphertext"), true)
  })
})

test("update serializes concurrent writes and keeps both changes", async () => {
  await withStore(async (store) => {
    await Promise.all([
      store.update((current) => ({ ...current, enabled: false })),
      store.update((current) => ({ ...current, temperature: 1.1 })),
    ])
    const snapshot = await store.read()
    assert.equal(snapshot.config.enabled, false)
    assert.equal(snapshot.config.temperature, 1.1)
  })
})

test("redacted read never exposes saved keys", async () => {
  await withStore(async (store) => {
    await store.write({ ...defaultStoredSettings(), apiKey: "sk-secret-1234567890" })
    const redacted = await store.getRedacted()
    assert.equal(redacted.apiKey, "")
    assert.equal(redacted.hasApiKey, true)
    assert.equal(JSON.stringify(redacted).includes("sk-secret"), false)
  })
})
