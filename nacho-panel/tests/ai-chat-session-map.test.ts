import assert from "node:assert/strict"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createAIChatSessionMapStore } from "../lib/ai/chat-session-map"

async function withStore(run: (store: ReturnType<typeof createAIChatSessionMapStore>, directory: string, filePath: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nacho-ai-session-map-"))
  const filePath = path.join(directory, "ai-chat-session-map.json")
  try {
    await run(createAIChatSessionMapStore({ filePath }), directory, filePath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("mapping round-trips and forgets", async () => {
  await withStore(async (store) => {
    assert.equal(await store.get("s1"), null)
    await store.remember("s1", "ses_abc")
    assert.equal((await store.get("s1"))?.opencodeSessionId, "ses_abc")
    await store.forget("s1")
    assert.equal(await store.get("s1"), null)
  })
})

test("corrupt mapping file is quarantined", async () => {
  await withStore(async (store, directory, filePath) => {
    await writeFile(filePath, "{bad", "utf8")
    assert.equal(await store.get("s1"), null)
    const entries = await readdir(directory)
    assert.ok(entries.some((name) => name.startsWith("ai-chat-session-map.json.corrupt-")))
  })
})

test("mapping rejects invalid ids", async () => {
  await withStore(async (store) => {
    await store.remember("bad id!", "ses_abc")
    await store.remember("s1", "bad id!")
    assert.equal(await store.get("bad id!"), null)
    assert.equal(await store.get("s1"), null)
  })
})
