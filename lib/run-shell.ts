import type { CommandStatus } from "./terminate-process"

export type ShellKind = "cmd" | "powershell"

export type RunShellCommand = {
  id: string
  clientId: string
  type: "run-shell"
  status: CommandStatus
  result: string | null
  exitCode: number | null
  createdAt: number
  updatedAt: number
}

export type RunShellResult = {
  shell: ShellKind
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  truncated: boolean
  error: string | null
}

const resultFields = new Set([
  "shell",
  "stdout",
  "stderr",
  "exitCode",
  "durationMs",
  "timedOut",
  "truncated",
  "error",
])

export function isValidShellScript(value: string): boolean {
  const length = [...value].length
  if (length < 1 || length > 32_768 || value.trim().length === 0) return false
  return ![...value].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code === 0 || (code < 32 && character !== "\r" && character !== "\n" && character !== "\t")
  })
}

export function isValidShellTimeout(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 900
}

export function parseRunShellResult(raw: string | null): RunShellResult | null {
  if (!raw || new TextEncoder().encode(raw).byteLength > 512 * 1024) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    if (Object.keys(value).length !== resultFields.size || Object.keys(value).some((key) => !resultFields.has(key))) return null
    if (value.shell !== "cmd" && value.shell !== "powershell") return null
    if (typeof value.stdout !== "string" || typeof value.stderr !== "string") return null
    if (value.exitCode !== null && (!Number.isInteger(value.exitCode) || typeof value.exitCode !== "number")) return null
    if (typeof value.durationMs !== "number" || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0) return null
    if (typeof value.timedOut !== "boolean" || typeof value.truncated !== "boolean") return null
    if (value.error !== null && typeof value.error !== "string") return null
    return value as RunShellResult
  } catch {
    return null
  }
}
