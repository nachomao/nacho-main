import type { CommandStatus } from "./terminate-process"

export type RestartPhase = "prepared" | "requested" | "verified" | "failed"

export type RestartSystemResult = {
  delaySeconds: number | null
  reason: string | null
  requestedAt: string | null
  previousBootId: string | null
  currentBootId: string | null
  phase: RestartPhase
  durationMs: number
  verifiedAfterRestart: boolean
  error: string | null
}

export type RestartSystemCommand = {
  id: string
  clientId: string
  status: CommandStatus
  result: string | null
}

const phases = new Set<RestartPhase>(["prepared", "requested", "verified", "failed"])

export function parseRestartSystemResult(raw: string | null): RestartSystemResult | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<RestartSystemResult>
    const delaySeconds = value.delaySeconds
    const requestedAt = value.requestedAt
    if (
      !(delaySeconds === null || (typeof delaySeconds === "number" && Number.isInteger(delaySeconds) && delaySeconds >= 0 && delaySeconds <= 300)) ||
      !(value.reason === null || typeof value.reason === "string") ||
      !(requestedAt === null || (typeof requestedAt === "string" && isTimestamp(requestedAt))) ||
      !(value.previousBootId === null || typeof value.previousBootId === "string") ||
      !(value.currentBootId === null || typeof value.currentBootId === "string") ||
      typeof value.phase !== "string" ||
      !phases.has(value.phase as RestartPhase) ||
      typeof value.durationMs !== "number" ||
      !Number.isFinite(value.durationMs) ||
      value.durationMs < 0 ||
      typeof value.verifiedAfterRestart !== "boolean" ||
      !(value.error === null || typeof value.error === "string")
    ) return null
    return value as RestartSystemResult
  } catch {
    return null
  }
}

export function isValidRestartDelay(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 300
}

export function normalizeRestartReason(value: string): string | null {
  const normalized = value.trim()
  return normalized || null
}

export function isValidRestartReason(value: string): boolean {
  const normalized = normalizeRestartReason(value)
  if (normalized === null) return true
  if ([...normalized].length > 256) return false
  return !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(normalized)
}

function isTimestamp(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value))
}
