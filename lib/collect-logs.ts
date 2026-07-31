import type { CommandStatus } from "./terminate-process"

export const logSources = ["agent", "system", "application"] as const
export type LogSource = (typeof logSources)[number]

export type CollectedLogEntry = {
  source: LogSource
  timestampUtc: string
  level: string | null
  eventId: number | null
  provider: string | null
  message: string
}

export type CollectLogsResult = {
  sources: LogSource[]
  requestedSinceUtc: string | null
  requestedUntilUtc: string | null
  effectiveSinceUtc: string | null
  effectiveUntilUtc: string | null
  entries: CollectedLogEntry[]
  countsBySource: Partial<Record<LogSource, number>>
  truncated: boolean
  durationMs: number
  error: string | null
}

export type CollectLogsCommand = {
  id: string
  clientId: string
  status: CommandStatus
  result: string | null
}

const sourceSet = new Set<string>(logSources)
const resultFields = new Set([
  "sources",
  "requestedSinceUtc",
  "requestedUntilUtc",
  "effectiveSinceUtc",
  "effectiveUntilUtc",
  "entries",
  "countsBySource",
  "truncated",
  "durationMs",
  "error",
])
const entryFields = new Set(["source", "timestampUtc", "level", "eventId", "provider", "message"])

export function parseCollectLogsResult(raw: string | null): CollectLogsResult | null {
  if (!raw || new TextEncoder().encode(raw).byteLength > 512 * 1024) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (!isRecord(value) || !hasExactFields(value, resultFields)) return null
    if (!Array.isArray(value.sources) || value.sources.length > 3) return null
    if (!value.sources.every(isLogSource) || new Set(value.sources).size !== value.sources.length) return null
    const sources = value.sources as LogSource[]
    if (!nullableTimestamp(value.requestedSinceUtc) || !nullableTimestamp(value.requestedUntilUtc) ||
        !nullableTimestamp(value.effectiveSinceUtc) || !nullableTimestamp(value.effectiveUntilUtc)) return null
    if (!Array.isArray(value.entries) || value.entries.length > 1000) return null
    if (!isRecord(value.countsBySource) || Object.keys(value.countsBySource).some((key) => !sources.includes(key as LogSource))) return null
    if (typeof value.truncated !== "boolean" || !isNonnegativeNumber(value.durationMs)) return null
    if (!(value.error === null || typeof value.error === "string")) return null
    if (typeof value.error === "string" && (value.error.length > 1024 || hasDangerousControls(value.error) || hasUnredactedSecret(value.error))) return null
    if (sources.length === 0 && value.error === null) return null

    const entries: CollectedLogEntry[] = []
    const actualCounts = new Map<LogSource, number>()
    for (const candidate of value.entries) {
      if (!isRecord(candidate) || !hasExactFields(candidate, entryFields)) return null
      if (!isLogSource(candidate.source) || !sources.includes(candidate.source)) return null
      if (typeof candidate.timestampUtc !== "string" || !isTimestamp(candidate.timestampUtc)) return null
      if (!(candidate.level === null || isSafeMetadata(candidate.level))) return null
      if (!(candidate.eventId === null || (typeof candidate.eventId === "number" && Number.isInteger(candidate.eventId)))) return null
      if (!(candidate.provider === null || isSafeMetadata(candidate.provider))) return null
      if (typeof candidate.message !== "string" || [...candidate.message].length > 4096 || hasDangerousControls(candidate.message) || hasUnredactedSecret(candidate.message)) return null
      entries.push(candidate as CollectedLogEntry)
      actualCounts.set(candidate.source, (actualCounts.get(candidate.source) ?? 0) + 1)
    }
    for (const source of sources) {
      const count = value.countsBySource[source]
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count !== (actualCounts.get(source) ?? 0)) return null
    }
    return value as CollectLogsResult
  } catch {
    return null
  }
}

export function isLogSource(value: unknown): value is LogSource {
  return typeof value === "string" && sourceSet.has(value)
}

export function isValidMaxEntries(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 1000
}

export function utcInputToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute, second = "00"] = match
  const milliseconds = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  const date = new Date(milliseconds)
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 ||
      date.getUTCDate() !== Number(day) || date.getUTCHours() !== Number(hour) ||
      date.getUTCMinutes() !== Number(minute) || date.getUTCSeconds() !== Number(second)) return null
  return date.toISOString()
}

export function dateToUtcInput(value: Date): string {
  return value.toISOString().slice(0, 16)
}

export function isValidLogWindow(sinceUtc: string | null, untilUtc: string | null, now = Date.now()): boolean {
  if (!sinceUtc || !untilUtc) return false
  const since = Date.parse(sinceUtc)
  const until = Date.parse(untilUtc)
  return Number.isFinite(since) && Number.isFinite(until) && since < until && until - since <= 24 * 60 * 60 * 1000 && until <= now
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactFields(value: Record<string, unknown>, expected: Set<string>): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.size && keys.every((key) => expected.has(key))
}

function nullableTimestamp(value: unknown): boolean {
  return value === null || (typeof value === "string" && isTimestamp(value))
}

function isTimestamp(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value))
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function hasDangerousControls(value: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)
}

function hasUnredactedSecret(value: string): boolean {
  return /\b(?:authorization|api[-_ ]?key|device[-_ ]?token|access[-_ ]?token|token|password|secret)\b\s*[:=]\s*(?!\[REDACTED\])\S+|\bbearer\s+(?!\[REDACTED\])\S+/iu.test(value)
}

function isSafeMetadata(value: unknown): value is string {
  return typeof value === "string" && [...value].length <= 256 && !hasDangerousControls(value) && !hasUnredactedSecret(value)
}
