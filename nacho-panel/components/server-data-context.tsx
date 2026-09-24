"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useOnboarding } from "@/components/onboarding/onboarding-context"
import type { Client } from "@/components/clients/client-data"
import { defaultServerBaseUrl, normalizeServerBaseUrl } from "@/lib/server-connection"
import { canApplyNotificationSnapshot } from "@/lib/notification-state"
import { useLocalSettings } from "@/components/local-settings-provider"

export type Overview = {
  clients: {
    total: number
    online: number
    warning: number
    offline: number
    realtimeConnections: number
  }
  tasks: { total: number; enabled: number }
  plugins: { installed: number }
  commands: { pending: number }
  resources: { cpu: number; memory: number; disk: number }
  health: { unread: number; critical: number; error: number; packages: number }
  updatedAt: number
}

export type LogEntry = {
  id: string
  ts: number
  level: "error" | "warn" | "info" | "debug"
  source: string
  message: string
  detail: string | null
}

export type ServerNotification = {
  id: string
  type: "offline" | "health" | "task" | "log"
  severity: "info" | "warning" | "error" | "critical"
  title: string
  desc: string
  detail: string
  code: string | null
  source: string
  deviceId: string | null
  time: string
  ts: number
  read: boolean
  snoozedUntil: number | null
  groupKey: string
  count?: number
  items?: ServerNotification[]
}

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; message?: string; error?: string }

type ServerDataContextValue = {
  serverBaseUrl: string
  overview: Overview | null
  clients: Client[]
  groups: string[]
  logs: LogEntry[]
  notifications: ServerNotification[]
  notificationError: string | null
  markNotificationRead: (id: string) => Promise<void>
  markAllNotificationsRead: () => Promise<void>
  clearNotifications: () => Promise<void>
  snoozeNotification: (id: string, until: number) => Promise<void>
  snoozeNotificationGroup: (groupKey: string, until: number) => Promise<void>
  markNotificationGroupRead: (groupKey: string) => Promise<void>
  loading: boolean
  refreshing: boolean
  error: string | null
  refresh: () => Promise<void>
  apiRequest: <T>(path: string, init?: RequestInit) => Promise<T>
  uploadRequest: <T>(path: string, file: File, onProgress: (percent: number) => void) => Promise<T>
  downloadRequest: (path: string, fallbackFileName: string) => Promise<void>
}

const ServerDataContext = createContext<ServerDataContextValue | null>(null)

export function ServerDataProvider({ children }: { children: ReactNode }) {
  const { settings: localSettings } = useLocalSettings()
  const { serverSource } = useOnboarding()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [notifications, setNotifications] = useState<ServerNotification[]>([])
  const [notificationError, setNotificationError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const notificationMutationEpoch = useRef(0)
  const connectedOnce = useRef(false)
  const notificationQuery = useMemo(() => {
    const n = localSettings.notificationCenter
    return `limit=${n.maxItems}&grouped=true&retentionDays=${n.retentionDays}&maxItems=${n.maxItems}&autoPurge=${n.autoPurge}`
  }, [localSettings.notificationCenter])

  const connection = useMemo(() => {
    // 未完成引导时不构造连接，由上层展示引导/错误态，避免伪造可用连接
    if (!serverSource) return null
    return { baseUrl: normalizeServerBaseUrl(serverSource.api), key: serverSource.key }
  }, [serverSource])

  const apiRequest = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (!connection) throw new Error("尚未配置服务端连接")
      let response: Response
      try {
        response = await fetch(`${connection.baseUrl}/api/panel${path}`, {
          ...init,
          signal: init?.signal ?? AbortSignal.timeout(8_000),
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${connection.key}`,
            ...(init?.body ? { "Content-Type": "application/json" } : {}),
            ...init?.headers,
          },
        })
      } catch {
        throw new Error("连接服务端失败，请检查服务端地址和网络")
      }
      const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null
      if (!response.ok || !body?.ok) {
        const message = body && !body.ok ? body.message || body.error : undefined
        throw new Error(message || `服务端请求失败（HTTP ${response.status}）`)
      }
      return body.data
    },
    [connection],
  )

  const uploadRequest = useCallback(
    <T,>(path: string, file: File, onProgress: (percent: number) => void): Promise<T> => {
      if (!connection) return Promise.reject(new Error("尚未配置服务端连接"))
      return new Promise<T>((resolve, reject) => {
        const request = new XMLHttpRequest()
        request.open("PUT", `${connection.baseUrl}/api/panel${path}`)
        request.timeout = 60 * 60 * 1000
        request.setRequestHeader("Accept", "application/json")
        request.setRequestHeader("Authorization", `Bearer ${connection.key}`)
        request.setRequestHeader("Content-Type", "application/octet-stream")
        request.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
        }
        request.onerror = () => reject(new Error("上传连接失败，请检查服务端地址和网络"))
        request.ontimeout = () => reject(new Error("上传超时"))
        request.onabort = () => reject(new Error("上传已取消"))
        request.onload = () => {
          let body: ApiEnvelope<T> | null = null
          try { body = JSON.parse(request.responseText) as ApiEnvelope<T> } catch { /* 使用统一错误 */ }
          if (request.status < 200 || request.status >= 300 || !body?.ok) {
            const message = body && !body.ok ? body.message || body.error : undefined
            reject(new Error(message || `服务端请求失败（HTTP ${request.status}）`))
            return
          }
          onProgress(100)
          resolve(body.data)
        }
        request.send(file)
      })
    },
    [connection],
  )

  const downloadRequest = useCallback(async (path: string, fallbackFileName: string): Promise<void> => {
    if (!connection) throw new Error("尚未配置服务端连接")
    let response: Response
    try {
      response = await fetch(`${connection.baseUrl}/api/panel${path}`, {
        signal: AbortSignal.timeout(30_000),
        headers: { Accept: "application/json", Authorization: `Bearer ${connection.key}` },
      })
    } catch {
      throw new Error("下载连接失败，请检查服务端地址和网络")
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiEnvelope<never> | null
      const message = body && !body.ok ? body.message || body.error : undefined
      throw new Error(message || `下载失败（HTTP ${response.status}）`)
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    try {
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = fallbackFileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }, [connection])

  const mutateNotifications = useCallback(async (path: string, init: RequestInit) => {
    const epoch = ++notificationMutationEpoch.current
    await apiRequest(path, init)
    const next = await apiRequest<ServerNotification[]>(`/notifications?${notificationQuery}`)
    if (canApplyNotificationSnapshot(epoch, notificationMutationEpoch.current)) setNotifications(next)
  }, [apiRequest, notificationQuery])

  const markNotificationRead = useCallback(async (id: string) => {
    await mutateNotifications(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" })
  }, [mutateNotifications])

  const markAllNotificationsRead = useCallback(async () => {
    await mutateNotifications("/notifications/read-all", { method: "POST" })
  }, [mutateNotifications])

  const clearNotifications = useCallback(async () => {
    await mutateNotifications("/notifications", { method: "DELETE" })
  }, [mutateNotifications])
  const snoozeNotification = useCallback(async (id: string, until: number) => {
    await mutateNotifications(`/notifications/${encodeURIComponent(id)}/snooze`, { method: "POST", body: JSON.stringify({ until }) })
  }, [mutateNotifications])
  const snoozeNotificationGroup = useCallback(async (groupKey: string, until: number) => {
    await mutateNotifications(`/notifications/group/${encodeURIComponent(groupKey)}/snooze`, { method: "POST", body: JSON.stringify({ until }) })
  }, [mutateNotifications])
  const markNotificationGroupRead = useCallback(async (groupKey: string) => {
    await mutateNotifications(`/notifications/group/${encodeURIComponent(groupKey)}/read`, { method: "POST" })
  }, [mutateNotifications])

  const refresh = useCallback(async () => {
    if (!connection) {
      setError("尚未配置服务端连接")
      setNotificationError("尚未配置服务端连接")
      setLoading(false)
      return
    }
    const sequence = ++requestSequence.current
    const notificationEpoch = notificationMutationEpoch.current
    if (!connectedOnce.current) {
      setLoading(true)
    }
    setRefreshing(true)
    try {
      // 仅概览接口作为连接判定依据；其它业务接口缺失或暂时失败时保留已有数据，
      // 避免某个旧版路由的 404 被误报为整面板断线。
      const [overviewResult, clientsResult, groupsResult, logsResult] = await Promise.allSettled([
        apiRequest<Overview>("/overview"),
        apiRequest<Client[]>("/clients"),
        apiRequest<string[]>("/groups"),
        apiRequest<LogEntry[]>("/logs?limit=30"),
      ])
      if (overviewResult.status === "rejected") throw overviewResult.reason
      if (sequence !== requestSequence.current) return
      setOverview(overviewResult.value)
      if (clientsResult.status === "fulfilled") setClients(clientsResult.value)
      if (groupsResult.status === "fulfilled") setGroups(groupsResult.value)
      if (logsResult.status === "fulfilled") setLogs(logsResult.value)
      try {
        const nextNotifications = await apiRequest<ServerNotification[]>(`/notifications?${notificationQuery}`)
        if (sequence !== requestSequence.current) return
        setNotificationError(null)
        if (canApplyNotificationSnapshot(notificationEpoch, notificationMutationEpoch.current)) setNotifications(nextNotifications)
      } catch (caught) {
        if (sequence !== requestSequence.current) return
        // 保留上次成功的数据；旧服务端缺少通知路由时明确显示错误而不是伪装成空列表。
        setNotificationError(caught instanceof Error ? caught.message : "通知加载失败")
      }
      connectedOnce.current = true
      setError(null)
    } catch (caught) {
      if (sequence !== requestSequence.current) return
      setError(caught instanceof Error ? caught.message : "服务端连接失败")
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [apiRequest, connection, notificationQuery])

  useEffect(() => {
    void refresh()
    if (!connection) return
    // 客户端状态（尤其是卸载后的“已注销”）需要尽快反映到卡片；
    // 3 秒轮询仍可避免请求风暴，同时把可见延迟控制在一个交互节拍内。
    const timer = window.setInterval(() => void refresh(), 3_000)
    return () => window.clearInterval(timer)
  }, [connection, refresh])

  const value = useMemo(
    () => ({ serverBaseUrl: connection?.baseUrl || defaultServerBaseUrl(), overview, clients, groups, logs, notifications, notificationError, markNotificationRead, markAllNotificationsRead, clearNotifications, snoozeNotification, snoozeNotificationGroup, markNotificationGroupRead, loading, refreshing, error, refresh, apiRequest, uploadRequest, downloadRequest }),
    [connection, overview, clients, groups, logs, notifications, notificationError, markNotificationRead, markAllNotificationsRead, clearNotifications, snoozeNotification, snoozeNotificationGroup, markNotificationGroupRead, loading, refreshing, error, refresh, apiRequest, uploadRequest, downloadRequest],
  )

  return <ServerDataContext.Provider value={value}>{children}</ServerDataContext.Provider>
}

export function useServerData() {
  const context = useContext(ServerDataContext)
  if (!context) throw new Error("useServerData 必须在 ServerDataProvider 内使用")
  return context
}
