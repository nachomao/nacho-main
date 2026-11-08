/** AI 桌面接口只监听本机；Host 校验用于阻断 DNS rebinding 与反代 Host 伪造。 */
export function isLoopbackHostname(value: string | null | undefined): boolean {
  if (!value) return false
  const host = value.trim().toLowerCase()
  if (!host) return false

  if (host.startsWith("[")) {
    const end = host.indexOf("]")
    if (end < 0) return false
    const rest = host.slice(end + 1)
    if (rest && !/^:\d+$/.test(rest)) return false
    const bracketed = host.slice(0, end + 1)
    return bracketed === "[::1]"
  }

  let hostname = host
  const firstColon = host.indexOf(":")
  if (firstColon >= 0) {
    if (firstColon !== host.lastIndexOf(":")) return host === "::1"
    const port = host.slice(firstColon + 1)
    if (!/^\d+$/.test(port)) return false
    hostname = host.slice(0, firstColon)
  }
  return hostname === "127.0.0.1" || hostname === "localhost"
}
