import type { CommandStatus } from "./terminate-process"
import { formatByteSize } from "./package-deployment"

export { formatByteSize }
export const MAX_FILE_BYTES = 512 * 1024 * 1024

export type ManagedFile = {
  id: string
  kind: "file"
  displayName: string
  version: string
  originalFileName: string
  storageName: string
  sizeBytes: number
  sha256: string | null
  installerType: null
  arguments: string[]
  successExitCodes: number[]
  status: "draft" | "uploading" | "ready" | "deleted"
  createdAt: number
  updatedAt: number
}

export type FileDeployCommand = {
  id: string
  clientId: string
  type: "deploy-file" | "rollback-file-deploy"
  status: CommandStatus
  result: string | null
  exitCode: number | null
  createdAt: number
  updatedAt: number
}

export type FileDeploymentItem = {
  id: string
  commandId: string
  artifactId: string
  clientId: string
  artifact: ManagedFile | null
  client: { id: string; name: string; hostname: string; status: string } | null
  command: FileDeployCommand | null
}

export type FileDeploymentBatch = {
  id: string
  kind: "file"
  status: "pending" | "running" | "success" | "failed" | "completed-with-failures"
  totalItems: number
  createdAt: number
  updatedAt: number
  counts: Record<string, number>
  items: FileDeploymentItem[]
}

export type FileDeployResult = {
  phase: string
  downloadedBytes: number
  hashVerified: boolean
  destinationPath: string
  conflictPolicy: "fail" | "replace"
  replaced: boolean
  backupValid: boolean
  backupPath: string | null
  previousSha256: string | null
  finalSha256: string | null
  durationMs: number
  error: string | null
}

export type FileRollbackResult = {
  phase: string
  originalCommandId: string
  destinationPath: string
  backupValid: boolean
  restoredSha256: string | null
  error: string | null
}

const deployResultKeys = new Set([
  "phase", "downloadedBytes", "hashVerified", "destinationPath", "conflictPolicy", "replaced", "backupValid", "backupPath", "previousSha256", "finalSha256", "durationMs", "error",
])
const rollbackResultKeys = new Set(["phase", "originalCommandId", "destinationPath", "backupValid", "restoredSha256", "error"])
const sha256 = /^[a-f0-9]{64}$/

export function parseFileDeployResult(raw: string | null): FileDeployResult | null {
  if (!raw || new TextEncoder().encode(raw).byteLength > 512 * 1024) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const keys = Object.keys(value)
    if (keys.length !== deployResultKeys.size || keys.some((key) => !deployResultKeys.has(key))) return null
    if (typeof value.phase !== "string" || !Number.isSafeInteger(value.downloadedBytes) || Number(value.downloadedBytes) < 0 || typeof value.hashVerified !== "boolean") return null
    if (typeof value.destinationPath !== "string" || !/^[A-Za-z]:\\/.test(value.destinationPath)) return null
    if (value.conflictPolicy !== "fail" && value.conflictPolicy !== "replace") return null
    if (typeof value.replaced !== "boolean" || typeof value.backupValid !== "boolean") return null
    if (value.backupPath !== null && typeof value.backupPath !== "string") return null
    for (const key of ["previousSha256", "finalSha256"]) if (value[key] !== null && (typeof value[key] !== "string" || !sha256.test(value[key]))) return null
    if (!Number.isSafeInteger(value.durationMs) || Number(value.durationMs) < 0 || value.error !== null && typeof value.error !== "string") return null
    return value as FileDeployResult
  } catch { return null }
}

export function parseFileRollbackResult(raw: string | null): FileRollbackResult | null {
  if (!raw || new TextEncoder().encode(raw).byteLength > 512 * 1024) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const keys = Object.keys(value)
    if (keys.length !== rollbackResultKeys.size || keys.some((key) => !rollbackResultKeys.has(key))) return null
    if (typeof value.phase !== "string" || typeof value.originalCommandId !== "string" || !/^cmd-[a-f0-9]{12}$/.test(value.originalCommandId) || typeof value.destinationPath !== "string" || typeof value.backupValid !== "boolean") return null
    if (value.restoredSha256 !== null && (typeof value.restoredSha256 !== "string" || !sha256.test(value.restoredSha256))) return null
    if (value.error !== null && typeof value.error !== "string") return null
    return value as FileRollbackResult
  } catch { return null }
}

export function validateFileDraft(file: File | null, displayName: string, destinationPath: string): string | null {
  if (!file) return "请选择要下发的文件"
  if (file.size < 1 || file.size > MAX_FILE_BYTES) return "文件大小必须在 1 B 至 512 MiB 之间"
  if (!displayName.trim() || [...displayName.trim()].length > 120) return "展示名长度必须为 1–120 个字符"
  if (!isValidWindowsDestinationPath(destinationPath)) return "目标路径必须是本地 Windows 绝对文件路径"
  return null
}

export function isValidWindowsDestinationPath(value: string): boolean {
  if (value.length < 3 || value.length > 32_767 || !/^[A-Za-z]:\\[^\0-\x1f\x7f]+$/.test(value)) return false
  if (value.startsWith("\\\\") || value.startsWith("//") || value.startsWith("\\\\?\\") || value.startsWith("\\\\.\\") || value.endsWith("\\") || value.includes("*") || value.includes("?") || value.slice(2).includes(":")) return false
  return true
}

export function isTerminalFileBatch(batch: FileDeploymentBatch): boolean {
  return ["success", "failed", "completed-with-failures"].includes(batch.status)
}

export function isRollbackEligible(result: FileDeployResult | null, command: FileDeployCommand | null): boolean {
  return command?.type === "deploy-file" && command.status === "success" && result?.phase === "success" && result.backupValid
}
