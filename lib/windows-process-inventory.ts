export type ProcessSort = "cpu" | "memory" | "name" | "pid"
export type ProcessTerminationRestriction = "system" | "agent-self" | "path-unavailable" | "not-allowlisted"
export type ProcessActionRestriction = ProcessTerminationRestriction | "start-time-unavailable" | "session-unavailable" | "non-interactive-session" | "command-line-unavailable" | "access-denied"
export type ProcessPriority = "idle" | "below-normal" | "normal" | "above-normal" | "high" | "real-time"

export type WindowsProcessResources = {
  cpuPercent: number | null
  workingSetBytes: number
  privateMemoryBytes: number
}

export type WindowsProcessItem = {
  processId: number
  processName: string
  executablePath: string | null
  startedAtUtc: string | null
  sessionId: number | null
  canTerminate: boolean
  terminationRestriction: ProcessTerminationRestriction | null
  canRestart: boolean
  restartRestriction: ProcessActionRestriction | null
  efficiencyMode: boolean | null
  canSetEfficiency: boolean
  efficiencyRestriction: ProcessActionRestriction | null
  resources: WindowsProcessResources | null
}

export type RestartProcessResult = {
  originalProcessId: number
  newProcessId: number | null
  expectedPath: string
  expectedStartedAtUtc: string
  sessionId: number | null
  phase: "prepared" | "stopped" | "launched" | "verified" | "failed"
  stopped: boolean
  started: boolean
  durationMs: number
  error: string | null
}

export type SetProcessEfficiencyResult = {
  processId: number
  expectedPath: string
  expectedStartedAtUtc: string
  requestedEnabled: boolean
  initialEnabled: boolean | null
  finalEnabled: boolean | null
  originalPriority: ProcessPriority | null
  finalPriority: ProcessPriority | null
  priorityRestored: boolean
  durationMs: number
  error: string | null
}

export type WindowsProcessListResult = {
  capturedAtUtc: string
  sampleDurationMs: number
  total: number
  returned: number
  truncated: boolean
  processes: WindowsProcessItem[]
  error: string | null
}

export type ProcessFormSelection = {
  processId: string
  expectedPath: string
  warning: string | null
}

const restrictions = new Set<ProcessTerminationRestriction>(["system", "agent-self", "path-unavailable", "not-allowlisted"])
const actionRestrictions = new Set<ProcessActionRestriction>([...restrictions, "start-time-unavailable", "session-unavailable", "non-interactive-session", "command-line-unavailable", "access-denied"])
const priorities = new Set<ProcessPriority>(["idle", "below-normal", "normal", "above-normal", "high", "real-time"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

export function parseWindowsProcessListResult(raw: string | null): WindowsProcessListResult | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || !Array.isArray(value.processes)) return null
    if (typeof value.capturedAtUtc !== "string" || Number.isNaN(Date.parse(value.capturedAtUtc))) return null
    if (![value.sampleDurationMs, value.total, value.returned].every(isNonNegativeInteger)) return null
    const sampleDurationMs = value.sampleDurationMs as number
    const total = value.total as number
    const returned = value.returned as number
    if (typeof value.truncated !== "boolean" || !(value.error === null || typeof value.error === "string" && value.error.length > 0)) return null

    const processes: WindowsProcessItem[] = []
    for (const item of value.processes) {
      if (!isRecord(item) || typeof item.processId !== "number" || !Number.isSafeInteger(item.processId) || item.processId <= 0) return null
      if (typeof item.processName !== "string" || item.processName.length === 0) return null
      if (!(item.executablePath === null || typeof item.executablePath === "string" && item.executablePath.length > 0)) return null
      if (!(item.startedAtUtc === null || typeof item.startedAtUtc === "string" && !Number.isNaN(Date.parse(item.startedAtUtc)))) return null
      if (!(item.sessionId === null || isNonNegativeInteger(item.sessionId))) return null
      if (typeof item.canTerminate !== "boolean") return null
      if (!(item.terminationRestriction === null || typeof item.terminationRestriction === "string" && restrictions.has(item.terminationRestriction as ProcessTerminationRestriction))) return null
      if (item.canTerminate !== (item.terminationRestriction === null)) return null
      if (item.canTerminate && item.executablePath === null) return null
      if (item.terminationRestriction === "path-unavailable" && item.executablePath !== null) return null
      if (item.terminationRestriction === "not-allowlisted" && item.executablePath === null) return null
      if (item.terminationRestriction === "system" && item.processId !== 4) return null
      if (typeof item.canRestart !== "boolean" || !(item.restartRestriction === null || typeof item.restartRestriction === "string" && actionRestrictions.has(item.restartRestriction as ProcessActionRestriction))) return null
      if (item.canRestart !== (item.restartRestriction === null)) return null
      if (item.canRestart && (item.executablePath === null || item.startedAtUtc === null || item.sessionId === null || item.sessionId === 0)) return null
      if (!(item.efficiencyMode === null || typeof item.efficiencyMode === "boolean")) return null
      if (typeof item.canSetEfficiency !== "boolean" || !(item.efficiencyRestriction === null || typeof item.efficiencyRestriction === "string" && actionRestrictions.has(item.efficiencyRestriction as ProcessActionRestriction))) return null
      if (item.canSetEfficiency !== (item.efficiencyRestriction === null)) return null
      if (item.canSetEfficiency && (item.executablePath === null || item.startedAtUtc === null || item.efficiencyMode === null)) return null

      let resources: WindowsProcessResources | null = null
      if (item.resources !== null) {
        if (!isRecord(item.resources)) return null
        const cpu = item.resources.cpuPercent
        if (!(cpu === null || typeof cpu === "number" && Number.isFinite(cpu) && cpu >= 0 && cpu <= 100)) return null
        if (!isNonNegativeInteger(item.resources.workingSetBytes) || !isNonNegativeInteger(item.resources.privateMemoryBytes)) return null
        resources = item.resources as WindowsProcessResources
      }
      processes.push({ ...item, resources } as WindowsProcessItem)
    }
    if (returned !== processes.length || returned > total || value.truncated !== (returned < total)) return null
    return { ...value, sampleDurationMs, total, returned, processes } as WindowsProcessListResult
  } catch {
    return null
  }
}

export function supportsProcessInventory(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!match) return false
  const current = match.slice(1).map(Number)
  const minimum = [1, 1, 19]
  for (let index = 0; index < minimum.length; index++) {
    if (current[index] !== minimum[index]) return current[index] > minimum[index]
  }
  return true
}

export function supportsProcessActions(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!match) return false
  const current = match.slice(1).map(Number)
  const minimum = [1, 1, 20]
  for (let index = 0; index < minimum.length; index++) {
    if (current[index] !== minimum[index]) return current[index] > minimum[index]
  }
  return true
}

export function filterAndSortProcesses(processes: WindowsProcessItem[], query: string, sort: ProcessSort): WindowsProcessItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return processes
    .filter((process) => !normalizedQuery || `${process.processName}\n${process.processId}\n${process.executablePath ?? ""}`.toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => {
      if (sort === "cpu") {
        const difference = (right.resources?.cpuPercent ?? -1) - (left.resources?.cpuPercent ?? -1)
        if (difference) return difference
      }
      if (sort === "memory") {
        const difference = (right.resources?.workingSetBytes ?? -1) - (left.resources?.workingSetBytes ?? -1)
        if (difference) return difference
      }
      if (sort === "pid") return left.processId - right.processId
      const byName = left.processName.localeCompare(right.processName, undefined, { sensitivity: "base" })
      return byName || left.processId - right.processId
    })
}

export function formatProcessBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—"
  if (value < 1024) return `${value} B`
  const units = ["KiB", "MiB", "GiB", "TiB"]
  let amount = value / 1024
  let index = 0
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024
    index++
  }
  return `${amount >= 100 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`
}

export function processTerminationRestrictionText(process: WindowsProcessItem): string | null {
  if (process.canTerminate) return null
  switch (process.terminationRestriction) {
    case "system": return "系统进程由 Agent 拒绝终止"
    case "agent-self": return "Agent 自身进程由 Agent 拒绝终止"
    case "path-unavailable": return "映像路径不可读，选择后需手工补充"
    case "not-allowlisted": return "映像路径未加入目标 Agent 的 allowedProcessPaths"
    default: return "最终操作将由 Agent 再次校验"
  }
}

export function processActionRestrictionText(restriction: ProcessActionRestriction | null): string | null {
  switch (restriction) {
    case null: return null
    case "system": return "系统进程不支持此操作"
    case "agent-self": return "Agent 自身进程不支持此操作"
    case "path-unavailable": return "映像路径不可读"
    case "not-allowlisted": return "映像路径未加入目标 Agent 的 allowedProcessPaths"
    case "start-time-unavailable": return "进程启动时间不可读"
    case "session-unavailable": return "进程会话不可读"
    case "non-interactive-session": return "仅支持当前活动用户会话中的普通进程"
    case "command-line-unavailable": return "原启动参数不可读"
    case "access-denied": return "Windows 拒绝进程信息或设置访问"
  }
}

export function parseRestartProcessResult(raw: string | null): RestartProcessResult | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || !Number.isSafeInteger(value.originalProcessId) || Number(value.originalProcessId) <= 0) return null
    if (!(value.newProcessId === null || Number.isSafeInteger(value.newProcessId) && Number(value.newProcessId) > 0)) return null
    if (typeof value.expectedPath !== "string" || typeof value.expectedStartedAtUtc !== "string" || Number.isNaN(Date.parse(value.expectedStartedAtUtc))) return null
    if (!(value.sessionId === null || Number.isSafeInteger(value.sessionId) && Number(value.sessionId) > 0)) return null
    if (!["prepared", "stopped", "launched", "verified", "failed"].includes(String(value.phase))) return null
    if (typeof value.stopped !== "boolean" || typeof value.started !== "boolean" || !isNonNegativeInteger(value.durationMs)) return null
    if (!(value.error === null || typeof value.error === "string" && value.error.length > 0)) return null
    if (value.started !== (value.newProcessId !== null)) return null
    return value as RestartProcessResult
  } catch { return null }
}

export function parseSetProcessEfficiencyResult(raw: string | null): SetProcessEfficiencyResult | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || !Number.isSafeInteger(value.processId) || Number(value.processId) <= 0) return null
    if (typeof value.expectedPath !== "string" || typeof value.expectedStartedAtUtc !== "string" || Number.isNaN(Date.parse(value.expectedStartedAtUtc))) return null
    if (typeof value.requestedEnabled !== "boolean" || !(value.initialEnabled === null || typeof value.initialEnabled === "boolean") || !(value.finalEnabled === null || typeof value.finalEnabled === "boolean")) return null
    if (!(value.originalPriority === null || typeof value.originalPriority === "string" && priorities.has(value.originalPriority as ProcessPriority))) return null
    if (!(value.finalPriority === null || typeof value.finalPriority === "string" && priorities.has(value.finalPriority as ProcessPriority))) return null
    if (typeof value.priorityRestored !== "boolean" || !isNonNegativeInteger(value.durationMs)) return null
    if (!(value.error === null || typeof value.error === "string" && value.error.length > 0)) return null
    return value as SetProcessEfficiencyResult
  } catch { return null }
}

export function processFormSelection(process: WindowsProcessItem): ProcessFormSelection {
  return {
    processId: String(process.processId),
    expectedPath: process.executablePath ?? "",
    warning: processTerminationRestrictionText(process),
  }
}
