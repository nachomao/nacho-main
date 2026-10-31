import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createAIChatSessionMapStore, type ChatSessionMapStore } from "../lib/ai/chat-session-map"
import {
  buildPermissionRules,
  clearActiveChat,
  ensureChatSession,
  forgetChatSession,
  getActiveChat,
  getChatSession,
  isActiveTurn,
  setActiveChat,
  type ChatSession,
} from "../lib/ai/chat-sessions"
import { OpenCodeError, type OpencodeClient } from "../lib/ai/opencode-client"

const connection = { baseUrl: "http://127.0.0.1:8455", key: "test-key" }

async function withMapStore(run: (store: ChatSessionMapStore) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nacho-ai-session-map-"))
  const filePath = path.join(directory, "ai-chat-session-map.json")
  try {
    await run(createAIChatSessionMapStore({ filePath }))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("permission rules default to ask, allow reads and let the broker own Nacho danger tools", () => {
  const askRules = buildPermissionRules(true)
  const last = (permission: string) => [...askRules].reverse().find((rule) => rule.permission === permission)
  assert.equal(last("*")?.action, "ask")
  assert.equal(last("read")?.action, "allow")
  assert.equal(last("bash")?.action, "ask")
  assert.equal(last("webfetch")?.action, "deny")
  assert.equal(last("nacho_run_shell")?.action, "allow")
  const allowRules = buildPermissionRules(false)
  assert.equal([...allowRules].reverse().find((rule) => rule.permission === "bash")?.action, "allow")
})

test("old turn abort/cleanup cannot clear a new active turn", () => {
  const session: ChatSession = {
    uiSessionId: "u-turn",
    opencodeSessionId: "ses_turn",
    connection,
    model: "fake-model",
    mode: "agent",
    confirmDanger: true,
    permissionKey: "ask",
    createdAt: 1,
    lastUsed: 1,
  }
  setActiveChat(session, "t-old")
  assert.equal(isActiveTurn("u-turn", "t-old"), true)
  setActiveChat(session, "t-new")
  assert.equal(isActiveTurn("u-turn", "t-old"), false)
  clearActiveChat("t-old")
  assert.equal(getActiveChat()?.uiSessionId, "u-turn")
  assert.equal(isActiveTurn("u-turn", "t-new"), true)
  clearActiveChat("t-new")
  assert.equal(getActiveChat(), null)
})

test("chat session is reused and permission rules are updated when confirmDanger changes", async () => {
  await withMapStore(async (mapStore) => {
    const uiSessionId = `u-test-${Date.now()}`
    let created = 0
    let updated = 0
    const client = {
      createSession: async () => {
        created++
        return { id: "ses_test" }
      },
      updateSession: async () => {
        updated++
        return { id: "ses_test" }
      },
    } as unknown as OpencodeClient
    const first = await ensureChatSession(client, {
      uiSessionId,
      connection,
      model: "fake-model",
      mode: "agent",
      confirmDanger: true,
    }, mapStore)
    assert.equal(first.opencodeSessionId, "ses_test")
    assert.equal(created, 1)
    const second = await ensureChatSession(client, {
      uiSessionId,
      connection,
      model: "fake-model",
      mode: "agent",
      confirmDanger: true,
    }, mapStore)
    assert.equal(second.opencodeSessionId, "ses_test")
    assert.equal(updated, 0)
    await ensureChatSession(client, {
      uiSessionId,
      connection,
      model: "fake-model",
      mode: "agent",
      confirmDanger: false,
    }, mapStore)
    assert.equal(updated, 1)
    assert.equal(getChatSession(uiSessionId)?.permissionKey, "allow")
    forgetChatSession(uiSessionId)
    assert.equal(getChatSession(uiSessionId), null)
  })
})

test("persisted mapping is adopted after a restart and permission rules are re-applied", async () => {
  await withMapStore(async (mapStore) => {
    const uiSessionId = `u-adopt-${Date.now()}`
    await mapStore.remember(uiSessionId, "ses_saved")
    let updated = 0
    const client = {
      getSession: async (sessionId: string) => ({ id: sessionId }),
      updateSession: async () => {
        updated++
        return { id: "ses_saved" }
      },
      createSession: async () => {
        throw new Error("must not create a new session")
      },
    } as unknown as OpencodeClient
    const session = await ensureChatSession(client, {
      uiSessionId,
      connection,
      model: "fake-model",
      mode: "agent",
      confirmDanger: true,
    }, mapStore)
    assert.equal(session.opencodeSessionId, "ses_saved")
    assert.equal(session.permissionKey, "ask")
    assert.equal(updated, 1)
    assert.equal((await mapStore.get(uiSessionId))?.opencodeSessionId, "ses_saved")
    forgetChatSession(uiSessionId)
  })
})

test("stale mapping is replaced with a new opencode session", async () => {
  await withMapStore(async (mapStore) => {
    const uiSessionId = `u-stale-${Date.now()}`
    await mapStore.remember(uiSessionId, "ses_gone")
    let created = 0
    const client = {
      getSession: async () => {
        throw new OpenCodeError("not found", 404)
      },
      updateSession: async () => ({ id: "ses_gone" }),
      createSession: async () => {
        created++
        return { id: "ses_new" }
      },
    } as unknown as OpencodeClient
    const session = await ensureChatSession(client, {
      uiSessionId,
      connection,
      model: "fake-model",
      mode: "agent",
      confirmDanger: true,
    }, mapStore)
    assert.equal(session.opencodeSessionId, "ses_new")
    assert.equal(created, 1)
    assert.equal((await mapStore.get(uiSessionId))?.opencodeSessionId, "ses_new")
    forgetChatSession(uiSessionId)
  })
})

test("non-404 adoption errors propagate without creating a replacement", async () => {
  await withMapStore(async (mapStore) => {
    const uiSessionId = `u-error-${Date.now()}`
    await mapStore.remember(uiSessionId, "ses_saved")
    let created = 0
    const client = {
      getSession: async () => {
        throw new OpenCodeError("engine unavailable", 500)
      },
      createSession: async () => {
        created++
        return { id: "ses_new" }
      },
    } as unknown as OpencodeClient
    await assert.rejects(
      ensureChatSession(client, {
        uiSessionId,
        connection,
        model: "fake-model",
        mode: "agent",
        confirmDanger: true,
      }, mapStore),
      /engine unavailable/,
    )
    assert.equal(created, 0)
    assert.equal((await mapStore.get(uiSessionId))?.opencodeSessionId, "ses_saved")
    forgetChatSession(uiSessionId)
  })
})
