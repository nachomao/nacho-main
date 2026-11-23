/** 面板里唯一由客户端上报字段推导系统类型的地方，缺失即未知，不做任何猜测。 */
export type PanelClientOS = "windows" | "linux" | "macos"

export type ClientOSFields = {
  os?: unknown
  osName?: unknown
  system?: unknown
  platform?: unknown
} & Record<string, unknown>

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

/**
 * 只读取客户端真实上报的系统字段（os / osName / system / platform）。
 * 没有任何字段或字段无法识别时返回 null —— 不允许按 id 哈希之类的规则“演示”分配。
 */
export function resolveClientOS(client: ClientOSFields | null | undefined): PanelClientOS | null {
  if (!client) return null
  const raw = [client.os, client.osName, client.system, client.platform].map(normalize).filter(Boolean).join(" ")
  if (!raw) return null
  // 必须先判 macOS："darwin" 里含有 "win"，先判 Windows 会把 macOS 归错
  if (raw.includes("mac") || raw.includes("darwin") || raw.includes("os x") || raw.includes("osx")) return "macos"
  if (raw.includes("win")) return "windows"
  if (
    raw.includes("linux") ||
    raw.includes("ubuntu") ||
    raw.includes("debian") ||
    raw.includes("centos") ||
    raw.includes("fedora") ||
    raw.includes("rocky") ||
    raw.includes("alpine") ||
    raw.includes("unix")
  ) {
    return "linux"
  }
  return null
}

/** 客户端是否属于目标系统；系统未知时一律不匹配，交给界面展示明确空态。 */
export function matchesClientOS(client: ClientOSFields | null | undefined, os: PanelClientOS): boolean {
  return resolveClientOS(client) === os
}

/** 系统类型未知的客户端数量，用于空态文案区分「没在线」与「没上报系统」。 */
export function countUnknownClientOS(clients: readonly ClientOSFields[]): number {
  return clients.filter((client) => resolveClientOS(client) === null).length
}
