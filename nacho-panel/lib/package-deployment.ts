import type { CommandStatus } from "./terminate-process"

export const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024

export type InstallerType = "msi" | "exe"

export type ManagedPackage = {
  id: string
  kind: "package"
  displayName: string
  version: string
  originalFileName: string
  storageName: string
  sizeBytes: number
  sha256: string | null
  installerType: InstallerType
  arguments: string[]
  successExitCodes: number[]
  status: "draft" | "uploading" | "ready"
  createdAt: number
  updatedAt: number
}

export type PackageCommand = {
  id: string
  clientId: string
  type: "install-package"
  status: CommandStatus
  result: string | null
  exitCode: number | null
  createdAt: number
  updatedAt: number
}

export type PackageDeploymentItem = {
  id: string
  commandId: string
  artifactId: string
  clientId: string
  artifact: ManagedPackage | null
  client: { id: string; name: string; hostname: string; status: string } | null
  command: PackageCommand | null
}

export type PackageDeploymentBatch = {
  id: string
  kind: "package"
  status: "pending" | "running" | "success" | "failed" | "completed-with-failures"
  totalItems: number
  createdAt: number
  updatedAt: number
  counts: Record<string, number>
  items: PackageDeploymentItem[]
}

export type PackageInstallResult = {
  phase: string
  downloadedBytes: number
  hashVerified: boolean
  installerType: InstallerType | null
  exitCode: number | null
  rebootRequired: boolean
  durationMs: number
  timedOut: boolean
  error: string | null
}

const resultKeys = new Set([
  "phase", "downloadedBytes", "hashVerified", "installerType", "exitCode",
  "rebootRequired", "durationMs", "timedOut", "error",
])

export function parsePackageInstallResult(raw: string | null): PackageInstallResult | null {
  if (!raw || new TextEncoder().encode(raw).byteLength > 512 * 1024) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const keys = Object.keys(value)
    if (keys.length !== resultKeys.size || keys.some((key) => !resultKeys.has(key))) return null
    if (typeof value.phase !== "string" || value.phase.length < 1) return null
    if (!Number.isSafeInteger(value.downloadedBytes) || Number(value.downloadedBytes) < 0) return null
    if (typeof value.hashVerified !== "boolean") return null
    if (value.installerType !== null && value.installerType !== "msi" && value.installerType !== "exe") return null
    if (value.exitCode !== null && (!Number.isInteger(value.exitCode) || typeof value.exitCode !== "number")) return null
    if (typeof value.rebootRequired !== "boolean" || typeof value.timedOut !== "boolean") return null
    if (!Number.isSafeInteger(value.durationMs) || Number(value.durationMs) < 0) return null
    if (value.error !== null && typeof value.error !== "string") return null
    return value as PackageInstallResult
  } catch {
    return null
  }
}

export function parseArgumentLines(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
}

export function parseSuccessExitCodes(value: string): number[] | null {
  const pieces = value.split(",").map((piece) => piece.trim()).filter(Boolean)
  if (pieces.length < 1 || pieces.length > 32) return null
  const numbers = pieces.map(Number)
  if (numbers.some((number) => !Number.isInteger(number) || number < 0 || number > 65_535)) return null
  if (new Set(numbers).size !== numbers.length) return null
  return numbers
}

export function validatePackageDraft(input: {
  file: File | null
  displayName: string
  version: string
  installerType: InstallerType
  arguments: string[]
  successExitCodes: number[] | null
}): string | null {
  if (!input.file) return "请选择 MSI 或 EXE 安装包"
  if (input.file.size < 1 || input.file.size > MAX_PACKAGE_BYTES) return "安装包大小必须在 1 B 至 1 GiB 之间"
  const lowerName = input.file.name.toLowerCase()
  if (!lowerName.endsWith(`.${input.installerType}`)) return "文件扩展名与安装器类型不一致"
  if (!input.displayName.trim() || [...input.displayName.trim()].length > 120) return "展示名长度必须为 1–120 个字符"
  if ([...input.version.trim()].length > 64) return "版本号不能超过 64 个字符"
  if (input.arguments.length > 64 || input.arguments.some((argument) => argument.length > 4096 || /[\0-\x1f\x7f]/.test(argument))) return "安装参数无效"
  if (input.installerType === "msi" && input.arguments.some((argument) => !/^[A-Za-z_][A-Za-z0-9_]*=.+$/.test(argument))) return "MSI 参数必须使用 PROPERTY=value 格式"
  if (!input.successExitCodes) return "成功退出码必须是 0–65535 的无重复整数"
  if (!input.successExitCodes.includes(0)) return "成功退出码必须包含 0"
  if (input.installerType === "msi" && !input.successExitCodes.includes(3010)) return "MSI 成功退出码必须包含 3010"
  return null
}

export function formatByteSize(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

export function isTerminalPackageBatch(batch: PackageDeploymentBatch): boolean {
  return ["success", "failed", "completed-with-failures"].includes(batch.status)
}
