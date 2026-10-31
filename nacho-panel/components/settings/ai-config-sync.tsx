"use client"

import { useEffect, useRef, useSyncExternalStore } from "react"
import { useServerData } from "@/components/server-data-context"
import { aiConfigStore } from "@/components/settings/ai-data"
import {
  AIRequestError,
  canSaveAIConfig,
  fetchAISettings,
  fetchAIStatus,
  saveAISettings,
  type AIStatus,
} from "@/lib/ai/client"
import type { AIConfig } from "@/lib/ai/config-shared"

const initialStatus: AIStatus = {
  desktop: false,
  available: false,
  runtime: { state: "stopped" },
  settings: { configured: false, hasKey: false },
}

let runtimeStatus: AIStatus = initialStatus
const runtimeListeners = new Set<() => void>()

function publishRuntime(next: AIStatus) {
  runtimeStatus = next
  runtimeListeners.forEach((listener) => listener())
}

export function useAIRuntimeStatus() {
  return useSyncExternalStore(
    (listener) => {
      runtimeListeners.add(listener)
      return () => runtimeListeners.delete(listener)
    },
    () => runtimeStatus,
    () => initialStatus,
  )
}

export async function refreshAIRuntimeStatus() {
  try {
    const status = await fetchAIStatus()
    publishRuntime(status)
    return status
  } catch {
    return runtimeStatus
  }
}

/** 服务端只回传脱敏元数据；保留用户当前输入框中的密钥与本地字段。 */
export function applyAIServerMeta(redacted: AIConfig) {
  const current = aiConfigStore.get()
  const byId = new Map(redacted.mcpServers.map((server) => [server.id, server]))
  aiConfigStore.hydrate({
    ...current,
    hasApiKey: redacted.hasApiKey ?? current.hasApiKey,
    mcpServers: current.mcpServers.map((server) => {
      const match = byId.get(server.id)
      return match
        ? {
            ...server,
            hasToken: match.hasToken ?? server.hasToken,
            tools: match.tools,
            lastCheckedAt: match.lastCheckedAt,
          }
        : server
    }),
  })
}

export function applyAISettingsMeta(config: AIConfig) {
  applyAIServerMeta(config)
  publishRuntime({
    ...runtimeStatus,
    settings: {
      configured: Boolean(config.baseUrl && config.enabled && (config.hasApiKey || config.apiKey)),
      hasKey: Boolean(config.hasApiKey || config.apiKey),
    },
  })
}

let flushHandler: (() => Promise<void>) | null = null

export async function flushAISettings() {
  if (flushHandler) await flushHandler()
}

export function AIConfigSync() {
  const { developerPreview } = useServerData()
  const hydratedRef = useRef(false)
  const enabledRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const savingRef = useRef<Promise<void> | null>(null)
  const dirtyRef = useRef(false)
  const suppressRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    enabledRef.current = false
    hydratedRef.current = false

    async function hydrate() {
      const status = await refreshAIRuntimeStatus()
      if (cancelled) return
      if (!status.desktop || developerPreview) {
        publishRuntime({ ...status, desktop: false, available: false })
        return
      }
      try {
        const config = await fetchAISettings()
        if (cancelled) return
        suppressRef.current = true
        aiConfigStore.hydrate(config)
        suppressRef.current = false
        hydratedRef.current = true
        enabledRef.current = true
        publishRuntime({
          ...status,
          settings: {
            configured: Boolean(config.baseUrl && config.enabled && config.hasApiKey),
            hasKey: Boolean(config.hasApiKey),
          },
        })
      } catch {
        if (!cancelled) publishRuntime({ ...status, settings: { configured: false, hasKey: false } })
      }
    }

    void hydrate()

    const unsubscribe = aiConfigStore.subscribe(() => {
      if (!hydratedRef.current || !enabledRef.current || suppressRef.current) return
      dirtyRef.current = true
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        void persist()
      }, 600)
    })

    async function persist() {
      if (!hydratedRef.current || !enabledRef.current) return
      if (savingRef.current) {
        await savingRef.current
        if (dirtyRef.current) return persist()
        return
      }
      dirtyRef.current = false
      const snapshot = aiConfigStore.get()
      if (!canSaveAIConfig(snapshot)) {
        dirtyRef.current = true
        return
      }
      const task = saveAISettings(snapshot)
        .then((saved) => {
          suppressRef.current = true
          applyAISettingsMeta(saved)
          suppressRef.current = false
        })
        .catch((error) => {
          if (error instanceof AIRequestError && error.status >= 400 && error.status < 500) {
            dirtyRef.current = false
            return
          }
          dirtyRef.current = true
        })
        .finally(() => {
          savingRef.current = null
        })
      savingRef.current = task
      await task
      if (dirtyRef.current && timerRef.current === null) {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null
          void persist()
        }, 200)
      }
    }

    flushHandler = async () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      await persist()
      while (savingRef.current) await savingRef.current
      if (dirtyRef.current) await persist()
    }

    return () => {
      cancelled = true
      flushHandler = null
      unsubscribe()
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [developerPreview])

  return null
}
