import assert from "node:assert/strict"
import test from "node:test"
import {
  MAX_AI_CHAT_HISTORY_MESSAGES,
  MAX_AI_CHAT_HISTORY_SESSIONS,
  createChatSessionId,
  normalizePersistedChatHistory,
  toPersistedChatHistory,
  type Session,
} from "../lib/ai/chat-history"

function session(id: string, messages: Session["messages"] = []): Session {
  return { id, title: `会话 ${id}`, createdAt: 1000, messages }
}

test("persisted history strips image data urls and keeps reasoning and tool steps", () => {
  const history = toPersistedChatHistory([
    session("s1", [
      {
        id: "u1",
        role: "user",
        text: "看图",
        attachments: [{ name: "shot.png", mime: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
      },
      {
        id: "a1",
        role: "assistant",
        text: "结论",
        reasoning: "先看图再回答",
        reasoningActive: true,
        done: true,
        steps: [{
          id: "prt_1",
          source: "mcp",
          tool: "disk.info",
          detail: "path=C:",
          status: "done",
          output: "ok",
        }],
      },
    ]),
  ], "s1")

  const user = history.sessions[0].messages[0]
  assert.equal(user.role, "user")
  if (user.role === "user") {
    assert.equal(user.attachments?.[0].name, "shot.png")
    assert.equal(user.attachments?.[0].dataUrl, undefined)
  }
  const assistant = history.sessions[0].messages[1]
  assert.equal(assistant.role, "assistant")
  if (assistant.role === "assistant") {
    assert.equal(assistant.reasoning, "先看图再回答")
    assert.equal(assistant.reasoningActive, false)
    assert.equal(assistant.steps[0].output, "ok")
  }
})

test("persisted history caps sessions and keeps the active session", () => {
  const sessions = Array.from({ length: MAX_AI_CHAT_HISTORY_SESSIONS + 5 }, (_, index) => session(`s${index}`))
  const activeId = `s${MAX_AI_CHAT_HISTORY_SESSIONS + 4}`
  const history = toPersistedChatHistory(sessions, activeId)
  assert.equal(history.sessions.length, MAX_AI_CHAT_HISTORY_SESSIONS)
  assert.equal(history.activeId, activeId)
  assert.ok(history.sessions.some((item) => item.id === activeId))
})

test("persisted history keeps only the latest messages per session", () => {
  const messages = Array.from({ length: MAX_AI_CHAT_HISTORY_MESSAGES + 5 }, (_, index) => ({
    id: `u${index}`,
    role: "user" as const,
    text: `消息 ${index}`,
  }))
  const history = toPersistedChatHistory([session("s1", messages)], "s1")
  assert.equal(history.sessions[0].messages.length, MAX_AI_CHAT_HISTORY_MESSAGES)
  assert.equal(history.sessions[0].messages[0].id, "u5")
  assert.equal(history.sessions[0].messages.at(-1)?.id, `u${MAX_AI_CHAT_HISTORY_MESSAGES + 4}`)
})

test("normalization drops invalid entries and falls back to the first session", () => {
  const normalized = normalizePersistedChatHistory({
    version: 1,
    activeId: "missing",
    sessions: [
      {
        id: "s1",
        title: "有效会话",
        createdAt: 1000,
        messages: [
          { id: "u1", role: "user", text: "你好" },
          { id: "broken", role: "system", text: "忽略" },
          { id: "a1", role: "assistant", text: "回复", steps: [], done: true },
        ],
      },
      { id: "bad id!", title: "非法", createdAt: 1, messages: [] },
    ],
  })
  assert.ok(normalized)
  assert.equal(normalized.sessions.length, 1)
  assert.equal(normalized.sessions[0].messages.length, 2)
  assert.equal(normalized.activeId, "s1")
  assert.equal(normalizePersistedChatHistory({ version: 2, sessions: [] }), null)
  assert.equal(normalizePersistedChatHistory("nope"), null)
})

test("persisted history keeps ThoughtLine seconds and drops invalid values", () => {
  const assistant = (id: string, thoughtSeconds: unknown) =>
    ({ id, role: "assistant", text: "回复", steps: [], done: true, thoughtSeconds }) as Session["messages"][number]
  const history = toPersistedChatHistory([
    session("s1", [
      assistant("a1", 4.26),
      assistant("a2", -1),
      assistant("a3", Number.NaN),
      assistant("a4", "3"),
      assistant("a5", 90_000),
    ]),
  ], "s1")
  const seconds = history.sessions[0].messages.map((message) =>
    message.role === "assistant" ? message.thoughtSeconds : null)
  assert.deepEqual(seconds, [4.3, undefined, undefined, undefined, undefined])
})

test("session ids stay within the persisted id pattern", () => {
  const id = createChatSessionId()
  assert.match(id, /^[A-Za-z0-9_:-]{1,160}$/)
  assert.notEqual(createChatSessionId(), id)
})
