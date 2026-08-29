export type CommandStatus = "pending" | "sent" | "running" | "success" | "failed" | "canceled"

export type TerminateProcessResult = {
  processId: number
  expectedPath: string
  actualPath: string | null
  killProcessTree: boolean
  initialStatus: "unknown" | "running" | "exited"
  finalStatus: "unknown" | "running" | "exited"
  durationMs: number
  timedOut: boolean
  error: string | null
}

export const terminalCommandStatuses: CommandStatus[] = ["success", "failed", "canceled"]

const processStatuses = new Set(["unknown", "running", "exited"])

export function parseTerminateProcessResult(raw: string | null): TerminateProcessResult | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<TerminateProcessResult>
    if (
      !Number.isInteger(value.processId) ||
      typeof value.expectedPath !== "string" ||
      !(typeof value.actualPath === "string" || value.actualPath === null) ||
      typeof value.killProcessTree !== "boolean" ||
      typeof value.initialStatus !== "string" ||
      !processStatuses.has(value.initialStatus) ||
      typeof value.finalStatus !== "string" ||
      !processStatuses.has(value.finalStatus) ||
      typeof value.durationMs !== "number" ||
      typeof value.timedOut !== "boolean" ||
      !(typeof value.error === "string" || value.error === null)
    ) return null
    return value as TerminateProcessResult
  } catch {
    return null
  }
}

export function isValidProcessId(value: string): boolean {
  if (!/^\d+$/.test(value.trim())) return false
  const processId = Number(value)
  return Number.isSafeInteger(processId) && processId > 0 && processId !== 4
}

export function isValidProcessTimeout(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 120
}

export function isAbsoluteWindowsExecutablePath(value: string): boolean {
  const path = value.trim()
  if (!path || /[*?]/.test(path) || /[\\/]$/.test(path)) return false
  return /^[a-zA-Z]:\\[^\\]+/.test(path) || /^\\\\[^\\]+\\[^\\]+\\.+/.test(path)
}
