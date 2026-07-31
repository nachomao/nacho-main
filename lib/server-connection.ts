export function normalizeServerBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "")
}

export function defaultServerBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_NACHO_API_URL
  if (configured) return normalizeServerBaseUrl(configured)

  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8443`
  }

  return "http://localhost:8443"
}
