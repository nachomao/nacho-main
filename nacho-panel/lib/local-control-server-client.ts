"use client"

import useSWR, { mutate as mutateCache } from "swr"
import type {
  LocalControlAccessMode,
  LocalControlAction,
  LocalControlInstallLog,
  LocalControlInstallOptions,
  LocalControlInstallStreamEvent,
  LocalControlServerStatus,
} from "./local-control-server-types"

export const LOCAL_CONTROL_API_PATH = "/api/local-control-server"

type ApiEnvelope =
  | { ok: true; data: LocalControlServerStatus }
  | { ok: false; message?: string; error?: string }

async function readEnvelope(response: Response) {
  const body = (await response.json().catch(() => null)) as ApiEnvelope | null
  if (!response.ok || !body?.ok) {
    const message = body && !body.ok ? body.message || body.error : undefined
    throw new Error(message || `本地服务请求失败（HTTP ${response.status}）`)
  }
  return body.data
}

async function statusFetcher(path: string) {
  return readEnvelope(await fetch(path, { cache: "no-store", headers: { Accept: "application/json" } }))
}

async function mutateLocalControl(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>) {
  const status = await readEnvelope(
    await fetch(LOCAL_CONTROL_API_PATH, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
  await mutateCache(LOCAL_CONTROL_API_PATH, status, { revalidate: false })
  return status
}

export function useLocalControlServer(refreshInterval = 0) {
  const result = useSWR<LocalControlServerStatus>(LOCAL_CONTROL_API_PATH, statusFetcher, {
    refreshInterval,
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  })
  return {
    status: result.data,
    error: result.error instanceof Error ? result.error.message : null,
    loading: result.isLoading,
    refreshing: result.isValidating,
    refresh: result.mutate,
  }
}

export function runLocalControlAction(action: Exclude<LocalControlAction, "install">) {
  return mutateLocalControl("POST", { action })
}

export async function installLocalControl(
  options: LocalControlInstallOptions,
  onProgress?: (entry: LocalControlInstallLog) => void,
) {
  const response = await fetch(LOCAL_CONTROL_API_PATH, {
    method: "POST",
    headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "install", ...options }),
  })
  if (!response.ok || !response.headers.get("content-type")?.includes("application/x-ndjson") || !response.body) {
    return readEnvelope(response)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let status: LocalControlServerStatus | null = null
  let streamError: string | null = null

  const consume = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as LocalControlInstallStreamEvent
    if (event.type === "log") onProgress?.(event.data)
    else if (event.type === "complete") status = event.data
    else if (event.type === "error") streamError = event.message
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""
    for (const line of lines) consume(line)
    if (done) break
  }
  consume(buffer)

  if (streamError) throw new Error(streamError)
  if (!status) throw new Error("安装输出已结束，但未收到本地服务状态")
  await mutateCache(LOCAL_CONTROL_API_PATH, status, { revalidate: false })
  return status
}

export function updateLocalControlAutoStart(autoStart: boolean) {
  return mutateLocalControl("PATCH", { autoStart })
}

export function updateLocalControlAccessMode(accessMode: LocalControlAccessMode) {
  return mutateLocalControl("PATCH", { accessMode })
}

export function updateLocalControlPort(port: number) {
  return mutateLocalControl("PATCH", { port })
}

export function uninstallLocalControl(confirmation: string) {
  return mutateLocalControl("DELETE", { confirmation })
}
