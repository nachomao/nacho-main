import { getAIChatSessionMapStore, type ChatSessionMapStore } from "./chat-session-map"
import { OpenCodeError, type OpencodeClient, type OpenCodePermissionRule } from "./opencode-client"
import { NACHO_TOOL_NAMES } from "./tool-meta"

export type ChatConnection = { baseUrl: string; key: string }
export type ChatMode = "agent" | "chat"

export type ChatSession = {
  uiSessionId: string
  opencodeSessionId: string
  connection: ChatConnection
  model: string
  mode: ChatMode
  confirmDanger: boolean
  permissionKey: string
  createdAt: number
  lastUsed: number
}

const sessions = new Map<string, ChatSession>()
const creating = new Map<string, Promise<ChatSession>>()
let active: ChatSession | null = null
let activeTurnId: string | null = null

export function buildPermissionRules(confirmDanger: boolean): OpenCodePermissionRule[] {
  const rules: OpenCodePermissionRule[] = [{ permission: "*", pattern: "*", action: "ask" }]
  for (const readTool of ["read", "glob", "grep", "list", "todowrite"]) {
    rules.push({ permission: readTool, pattern: "*", action: "allow" })
  }
  rules.push({ permission: "bash", pattern: "*", action: confirmDanger ? "ask" : "allow" })
  rules.push({ permission: "edit", pattern: "*", action: confirmDanger ? "ask" : "allow" })
  rules.push({ permission: "write", pattern: "*", action: confirmDanger ? "ask" : "allow" })
  for (const denied of ["webfetch", "websearch", "question", "task", "skill"]) {
    rules.push({ permission: denied, pattern: "*", action: "deny" })
  }
  // Nacho 工具由面板 broker 二次审批；这里放行以避免重复确认。
  for (const name of NACHO_TOOL_NAMES) {
    rules.push({ permission: name, pattern: "*", action: "allow" })
  }
  return rules
}

function permissionKey(confirmDanger: boolean) {
  return confirmDanger ? "ask" : "allow"
}

export async function ensureChatSession(
  client: OpencodeClient,
  input: {
    uiSessionId: string
    connection: ChatConnection
    model: string
    mode: ChatMode
    confirmDanger: boolean
  },
  mapStore: ChatSessionMapStore = getAIChatSessionMapStore(),
): Promise<ChatSession> {
  const existing = sessions.get(input.uiSessionId)
  if (existing) {
    existing.connection = input.connection
    existing.model = input.model
    existing.mode = input.mode
    existing.confirmDanger = input.confirmDanger
    existing.lastUsed = Date.now()
    const key = permissionKey(input.confirmDanger)
    if (existing.permissionKey !== key) {
      await client.updateSession(existing.opencodeSessionId, { permission: buildPermissionRules(input.confirmDanger) })
      existing.permissionKey = key
    }
    return existing
  }
  const pending = creating.get(input.uiSessionId)
  if (pending) return pending
  const task = (async () => {
    // 重启后内存映射为空：优先复用磁盘上记录的 opencode 会话，保持追问的模型上下文。
    const mapped = await mapStore.get(input.uiSessionId).catch(() => null)
    if (mapped) {
      try {
        const remote = await client.getSession(mapped.opencodeSessionId)
        if (remote?.id === mapped.opencodeSessionId) {
          await client.updateSession(remote.id, { permission: buildPermissionRules(input.confirmDanger) })
          const session: ChatSession = {
            uiSessionId: input.uiSessionId,
            opencodeSessionId: remote.id,
            connection: input.connection,
            model: input.model,
            mode: input.mode,
            confirmDanger: input.confirmDanger,
            permissionKey: permissionKey(input.confirmDanger),
            createdAt: Date.now(),
            lastUsed: Date.now(),
          }
          sessions.set(input.uiSessionId, session)
          await mapStore.remember(input.uiSessionId, remote.id).catch(() => undefined)
          return session
        }
        await mapStore.forget(input.uiSessionId).catch(() => undefined)
      } catch (error) {
        if (error instanceof OpenCodeError && error.status === 404) {
          await mapStore.forget(input.uiSessionId).catch(() => undefined)
        } else {
          throw error
        }
      }
    }
    const created = await client.createSession({
      title: "Nacho AI",
      permission: buildPermissionRules(input.confirmDanger),
    })
    const session: ChatSession = {
      uiSessionId: input.uiSessionId,
      opencodeSessionId: created.id,
      connection: input.connection,
      model: input.model,
      mode: input.mode,
      confirmDanger: input.confirmDanger,
      permissionKey: permissionKey(input.confirmDanger),
      createdAt: Date.now(),
      lastUsed: Date.now(),
    }
    sessions.set(input.uiSessionId, session)
    await mapStore.remember(input.uiSessionId, created.id).catch(() => undefined)
    return session
  })().finally(() => creating.delete(input.uiSessionId))
  creating.set(input.uiSessionId, task)
  return task
}

export function getChatSession(uiSessionId: string) {
  return sessions.get(uiSessionId) ?? null
}

export function forgetChatSession(uiSessionId: string) {
  sessions.delete(uiSessionId)
  if (active?.uiSessionId === uiSessionId) {
    active = null
    activeTurnId = null
  }
}

export async function deleteChatSession(
  client: OpencodeClient,
  uiSessionId: string,
  opencodeSessionId?: string,
  mapStore: ChatSessionMapStore = getAIChatSessionMapStore(),
) {
  const session = sessions.get(uiSessionId)
  const target = session?.opencodeSessionId ?? opencodeSessionId
  sessions.delete(uiSessionId)
  if (active?.uiSessionId === uiSessionId) {
    active = null
    activeTurnId = null
  }
  await mapStore.forget(uiSessionId).catch(() => undefined)
  if (target) await client.deleteSession(target).catch(() => undefined)
}

export function setActiveChat(session: ChatSession | null, turnId: string | null = null) {
  active = session
  activeTurnId = session ? turnId : null
}

export function isActiveTurn(uiSessionId: string, turnId: string | null) {
  return Boolean(active && activeTurnId && active.uiSessionId === uiSessionId && activeTurnId === turnId)
}

/** 只清理仍属于该回合的 active chat，避免旧回合的收尾清掉刚发出的新回合。 */
export function clearActiveChat(turnId?: string | null) {
  if (!turnId || activeTurnId === turnId) {
    active = null
    activeTurnId = null
  }
}

export function getActiveChat() {
  return active
}

export function pruneChatSessions(maxAgeMs = 8 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs
  for (const [id, session] of sessions) {
    if (session.lastUsed < cutoff) sessions.delete(id)
  }
  if (active && active.lastUsed < cutoff) {
    active = null
    activeTurnId = null
  }
}
