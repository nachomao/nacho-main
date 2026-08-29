export type LocalUserAction = "list" | "enable" | "disable" | "delete" | "add-to-group" | "remove-from-group"
export type LocalUserWriteAction = Exclude<LocalUserAction, "list">
export type LocalUserError = { code: string; message: string }
export type LocalUserAccount = {
  userName: string
  sid: string
  enabled: boolean
  builtIn: boolean
  groups: string[]
}
export type LocalUserResult =
  | { action: "list"; changed: false; accounts: LocalUserAccount[]; error: LocalUserError | null }
  | { action: LocalUserWriteAction; changed: boolean; target: LocalUserAccount | null; error: LocalUserError | null }
export type LocalUserCommand = {
  id: string
  clientId: string
  type: "manage-local-user"
  payload: { action: LocalUserAction; userName: string | null; groupName: string | null }
  status: "pending" | "sent" | "running" | "success" | "failed" | "canceled"
  result: string | null
  exitCode: number | null
  createdAt: number
  updatedAt: number
}

const forbiddenName = /[\0-\x1f\x7f"/\\[\]:;|=,+*?<>@]/
export const terminalLocalUserStatuses = ["success", "failed", "canceled"] as const

export function isValidLocalUserName(value: string): boolean {
  return value.length >= 1 && value.length <= 20 && value === value.trim() && value !== "." && value !== ".." && !value.endsWith(".") && !forbiddenName.test(value)
}

export function isValidLocalGroupName(value: string): boolean {
  return value.length >= 1 && value.length <= 256 && value === value.trim() && value !== "." && value !== ".." && !value.endsWith(".") && !forbiddenName.test(value)
}

export function localUserPayload(action: LocalUserAction, userName: string | null = null, groupName: string | null = null) {
  if (action === "list") return { action, userName: null, groupName: null } as const
  if (!userName || !isValidLocalUserName(userName)) throw new Error("本地账户名格式无效")
  if (action === "add-to-group" || action === "remove-from-group") {
    if (!groupName || !isValidLocalGroupName(groupName)) throw new Error("本地组名格式无效")
    return { action, userName, groupName }
  }
  return { action, userName, groupName: null }
}

export function parseLocalUserResult(raw: string | null): LocalUserResult | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!isObject(value) || typeof value.action !== "string" || typeof value.changed !== "boolean" || !isError(value.error)) return null
    const keys = Object.keys(value).sort().join("|")
    if (value.action === "list") {
      if (keys !== "accounts|action|changed|error" || value.changed !== false || !Array.isArray(value.accounts)) return null
      const accounts = value.accounts.map(parseAccount)
      if (accounts.some((account) => account === null)) return null
      return { action: "list", changed: false, accounts: accounts as LocalUserAccount[], error: value.error as LocalUserError | null }
    }
    if (!["enable", "disable", "delete", "add-to-group", "remove-from-group"].includes(value.action) || keys !== "action|changed|error|target") return null
    const target = value.target === null ? null : parseAccount(value.target)
    if (value.target !== null && target === null) return null
    return { action: value.action as LocalUserWriteAction, changed: value.changed, target, error: value.error as LocalUserError | null }
  } catch {
    return null
  }
}

export function latestLocalUserList(commands: LocalUserCommand[]): LocalUserCommand | null {
  return [...commands]
    .filter((command) => command.type === "manage-local-user" && command.payload.action === "list" && terminalLocalUserStatuses.includes(command.status as (typeof terminalLocalUserStatuses)[number]))
    .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
}

export function localUserConfirmation(action: LocalUserWriteAction, clientName: string, userName: string, groupName: string | null): string {
  const labels: Record<LocalUserWriteAction, string> = {
    enable: "启用账户",
    disable: "禁用账户",
    delete: "删除账户",
    "add-to-group": "加入本地组",
    "remove-from-group": "移出本地组",
  }
  return [`确认${labels[action]}`, `客户端：${clientName}`, `账户：${userName}`, groupName ? `本地组：${groupName}` : null].filter(Boolean).join("\n")
}

export function isDeleteConfirmationValid(userName: string, confirmation: string): boolean {
  return confirmation === userName
}

function parseAccount(value: unknown): LocalUserAccount | null {
  if (!isObject(value) || Object.keys(value).sort().join("|") !== "builtIn|enabled|groups|sid|userName" ||
    typeof value.userName !== "string" || !isValidLocalUserName(value.userName) || typeof value.sid !== "string" ||
    !/^S-1-(?:\d+-)+\d+$/.test(value.sid) || typeof value.enabled !== "boolean" || typeof value.builtIn !== "boolean" ||
    !Array.isArray(value.groups) || value.groups.some((group) => typeof group !== "string" || !isValidLocalGroupName(group))) return null
  return { userName: value.userName, sid: value.sid, enabled: value.enabled, builtIn: value.builtIn, groups: value.groups as string[] }
}

function isError(value: unknown): value is LocalUserError | null {
  return value === null || (isObject(value) && Object.keys(value).sort().join("|") === "code|message" && typeof value.code === "string" && /^[A-Z0-9_]{1,64}$/.test(value.code) && typeof value.message === "string" && value.message.length > 0 && value.message.length <= 512)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
