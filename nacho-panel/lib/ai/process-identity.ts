/** 清理 stale runtime 前校验 PID 仍是预期的 opencode 进程，避免 PID 复用误杀。 */
export type TasklistRow = { imageName: string; pid: number }

export function parseTasklistCsv(output: string): TasklistRow[] {
  const rows: TasklistRow[] = []
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("INFO:")) continue
    const match = /^"([^"]*)","(\d+)"/.exec(trimmed)
    if (!match) continue
    const pid = Number(match[2])
    if (!Number.isInteger(pid) || pid <= 0) continue
    rows.push({ imageName: match[1], pid })
  }
  return rows
}

export function imageNameMatches(actual: string | null | undefined, expected: string | null | undefined) {
  if (!actual || !expected) return false
  return actual.trim().toLowerCase() === expected.trim().toLowerCase()
}

export function runtimeImageName(state: { binaryName?: unknown }, fallbackBinaryPath?: string | null) {
  if (typeof state.binaryName === "string" && state.binaryName.trim()) return state.binaryName.trim()
  if (fallbackBinaryPath) return fallbackBinaryPath.split(/[\\/]/).pop() || ""
  return ""
}
