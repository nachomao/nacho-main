export type ServiceControlAction = "query" | "start" | "stop" | "restart"
export type ServiceListFilter = "all" | "running" | "stopped"
export type ServiceSort = "name" | "cpu" | "memory"

export type WindowsServiceResources = {
  cpuPercent: number | null
  workingSetBytes: number
  privateMemoryBytes: number
}

export type WindowsServiceItem = {
  serviceName: string
  displayName: string
  status: string
  processId: number | null
  canControl: boolean
  controlRestriction: "not-allowlisted" | "agent-self" | null
  sharedProcess: boolean
  sharedServiceCount: number
  resources: WindowsServiceResources | null
}

export type WindowsServiceListResult = {
  action: "list"
  capturedAtUtc: string
  sampleDurationMs: number
  total: number
  returned: number
  truncated: boolean
  services: WindowsServiceItem[]
  error: string | null
}

export type WindowsServiceControlResult = {
  serviceName: string
  action: ServiceControlAction
  initialStatus: string
  finalStatus: string
  durationMs: number
  timedOut: boolean
  error: string | null
}

const serviceActions = new Set<ServiceControlAction>(["query", "start", "stop", "restart"])
const restrictions = new Set(["not-allowlisted", "agent-self"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value))
}

export function parseWindowsServiceListResult(raw: string | null): WindowsServiceListResult | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.action !== "list" || !Array.isArray(value.services)) return null
    if (typeof value.capturedAtUtc !== "string" || Number.isNaN(Date.parse(value.capturedAtUtc))) return null
    if (![value.sampleDurationMs, value.total, value.returned].every((item) => typeof item === "number" && Number.isInteger(item) && item >= 0)) return null
    const sampleDurationMs = value.sampleDurationMs as number
    const total = value.total as number
    const returned = value.returned as number
    if (typeof value.truncated !== "boolean" || !(value.error === null || typeof value.error === "string")) return null
    const services: WindowsServiceItem[] = []
    for (const item of value.services) {
      if (!isRecord(item) || typeof item.serviceName !== "string" || typeof item.displayName !== "string" || typeof item.status !== "string") return null
      if (!(item.processId === null || (typeof item.processId === "number" && Number.isInteger(item.processId) && item.processId > 0))) return null
      if (typeof item.canControl !== "boolean" || typeof item.sharedProcess !== "boolean" || typeof item.sharedServiceCount !== "number" || !Number.isInteger(item.sharedServiceCount) || item.sharedServiceCount < 0) return null
      if (!(item.controlRestriction === null || typeof item.controlRestriction === "string" && restrictions.has(item.controlRestriction))) return null
      let resources: WindowsServiceResources | null = null
      if (item.resources !== null) {
        if (!isRecord(item.resources) || !isNullableNumber(item.resources.cpuPercent) || typeof item.resources.workingSetBytes !== "number" || typeof item.resources.privateMemoryBytes !== "number") return null
        resources = item.resources as WindowsServiceResources
      }
      services.push({ ...item, resources } as WindowsServiceItem)
    }
    if (returned !== services.length || returned > total || value.truncated !== (returned < total)) return null
    return { ...value, sampleDurationMs, total, returned, services } as WindowsServiceListResult
  } catch {
    return null
  }
}

export function parseWindowsServiceControlResult(raw: string | null): WindowsServiceControlResult | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || typeof value.serviceName !== "string" || typeof value.action !== "string" || !serviceActions.has(value.action as ServiceControlAction)) return null
    if (typeof value.initialStatus !== "string" || typeof value.finalStatus !== "string" || typeof value.durationMs !== "number" || typeof value.timedOut !== "boolean") return null
    if (!(value.error === null || typeof value.error === "string")) return null
    return value as WindowsServiceControlResult
  } catch {
    return null
  }
}

export function supportsServiceInventory(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!match) return false
  const current = match.slice(1).map(Number)
  const minimum = [1, 1, 18]
  for (let index = 0; index < minimum.length; index++) {
    if (current[index] !== minimum[index]) return current[index] > minimum[index]
  }
  return true
}

export function filterAndSortServices(
  services: WindowsServiceItem[],
  filter: ServiceListFilter,
  query: string,
  sort: ServiceSort,
): WindowsServiceItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return services
    .filter((service) => filter === "all" || (filter === "running" ? service.status === "running" : service.status === "stopped"))
    .filter((service) => !normalizedQuery || `${service.serviceName}\n${service.displayName}`.toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => {
      if (sort === "cpu") {
        const difference = (right.resources?.cpuPercent ?? -1) - (left.resources?.cpuPercent ?? -1)
        if (difference) return difference
      }
      if (sort === "memory") {
        const difference = (right.resources?.workingSetBytes ?? -1) - (left.resources?.workingSetBytes ?? -1)
        if (difference) return difference
      }
      return left.serviceName.localeCompare(right.serviceName, undefined, { sensitivity: "base" })
    })
}

export function formatServiceBytes(value: number | null | undefined): string {
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

export function serviceControlRestrictionText(service: WindowsServiceItem): string | null {
  if (service.canControl) return null
  return service.controlRestriction === "agent-self" ? "Agent 自身服务仅供查看" : "未加入目标 Agent 的 allowedServices"
}
