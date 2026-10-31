import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { AIChatHistoryStoreError, createAIChatHistoryStore } from "../lib/ai/chat-history-store"
import type { PersistedChatHistory, Session } from "../lib/ai/chat-history"

function session(id: string, active = false): Session {
  return {
    id,
    title: active ? "当前会话" : `会话 ${id}`,
    createdAt: 1000,
    messages: [{ id: `u-${id}`, role: "user", text: "你好" }],
  }
}

async function withStore(run: (store: ReturnType<typeof createAIChatHistoryStore>, filePath: string, directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nacho-ai-chat-history-"))
  const filePath = path.join(directory, "ai-chat-history.json")
  try {
    await run(createAIChatHistoryStore({ filePath }), filePath, directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("missing history file yields an empty snapshot", async () => {
  await withStore(async (store) => {
    const snapshot = await store.read()
    assert.equal(snapshot.exists, false)
    assert.equal(snapshot.recovered, false)
    assert.deepEqual(snapshot.history.sessions, [])
    assert.equal(snapshot.history.activeId, "")
  })
})

test("history round-trips through the atomic store", async () => {
  await withStore(async (store, filePath, directory) => {
    const history: PersistedChatHistory = {
      version: 1,
      activeId: "s1",
      sessions: [session("s1", true), session("s2")],
    }
    await store.write(history)
    const snapshot = await store.read()
    assert.equal(snapshot.exists, true)
    assert.equal(snapshot.recovered, false)
    assert.equal(snapshot.history.activeId, "s1")
    assert.equal(snapshot.history.sessions.length, 2)
    const raw = await readFile(filePath, "utf8")
    assert.match(raw, /"version":1/)
    assert.equal((await readdir(directory)).some((name) => name.endsWith(".tmp")), false)
  })
})

test("corrupt history is quarantined and read as empty", async () => {
  await withStore(async (store, filePath, directory) => {
    await writeFile(filePath, "{bad json", "utf8")
    const snapshot = await store.read()
    assert.equal(snapshot.recovered, true)
    assert.deepEqual(snapshot.history.sessions, [])
    const entries = await readdir(directory)
    assert.ok(entries.some((name) => name.startsWith("ai-chat-history.json.corrupt-")))
  })
})

test("removing the active session picks a new active session", async () => {
  await withStore(async (store) => {
    await store.write({ version: 1, activeId: "s2", sessions: [session("s1"), session("s2", true)] })
    const removed = await store.remove("s2")
    assert.equal(removed.removed, true)
    assert.equal(removed.history.activeId, "s1")
    assert.equal(removed.history.sessions.length, 1)
    const again = await store.remove("missing")
    assert.equal(again.removed, false)
  })
})

test("oversized history is rejected without leaving a partial file", async () => {
  await withStore(async (store, filePath) => {
    const messages = Array.from({ length: 50 }, (_, index) => ({
      id: `a${index}`,
      role: "assistant" as const,
      text: "x".repeat(200_000),
      steps: [],
      done: true,
    }))
    await assert.rejects(
      store.write({ version: 1, activeId: "s1", sessions: [{ id: "s1", title: "大", createdAt: 1, messages }] }),
      (error: unknown) => error instanceof AIChatHistoryStoreError && error.code === "too-large",
    )
    const snapshot = await store.read()
    assert.equal(snapshot.exists, false)
    await assert.rejects(readFile(filePath, "utf8"))
  })
})
