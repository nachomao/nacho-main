"use client"

import useSWR, { mutate as mutateCache } from "swr"
import type {
  LocalControlAccessMode,
  LocalControlAction,
  LocalControlInstallOptions,
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

export function installLocalControl(options: LocalControlInstallOptions) {
  return mutateLocalControl("POST", { action: "install", ...options })
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
