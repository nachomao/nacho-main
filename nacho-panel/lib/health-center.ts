export type HealthPackageStatus = "collecting" | "analyzing" | "analyzed" | "failed"

export function isHealthPackageActive(status: HealthPackageStatus): boolean {
  return status === "collecting" || status === "analyzing"
}

export function healthPackagePrimaryAction(
  status: HealthPackageStatus,
  downloadable: boolean,
  hasClient: boolean,
): "reanalyze" | "recollect" | null {
  if (status === "failed") return hasClient ? "recollect" : null
  if (status === "analyzed" && downloadable) return "reanalyze"
  return null
}

export function createHealthCollectionPayload(clientIds: string[], now = new Date()) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  return {
    clientIds,
    sources: ["agent", "system", "application"] as const,
    sinceUtc: since.toISOString(),
    untilUtc: now.toISOString(),
    maxEntries: 500,
  }
}
