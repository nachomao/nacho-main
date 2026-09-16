type HeaderReader = Pick<Headers, "get">

function firstHeaderValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim().toLowerCase() || null
}

export function isSameOriginRequest(headers: HeaderReader, requestOrigin: string) {
  const fetchSite = headers.get("sec-fetch-site")?.trim().toLowerCase()
  if (fetchSite) return fetchSite === "same-origin"

  const origin = headers.get("origin")
  if (!origin) return false
  if (origin === requestOrigin) return true

  try {
    const originUrl = new URL(origin)
    const forwardedHost = firstHeaderValue(headers.get("x-forwarded-host"))
    const requestHost = firstHeaderValue(headers.get("host"))
    if (![forwardedHost, requestHost].filter(Boolean).includes(originUrl.host.toLowerCase())) return false

    const forwardedProtocol = firstHeaderValue(headers.get("x-forwarded-proto"))
    return !forwardedProtocol || originUrl.protocol === `${forwardedProtocol}:`
  } catch {
    return false
  }
}
