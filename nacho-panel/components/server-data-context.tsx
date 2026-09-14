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
  type: "offline" | "health" | "task"
  severity: "warning" | "error" | "critical"
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

// 临时预览开关：真实服务端接入后，将备份文件直接覆盖本文件即可完整恢复。
const USE_MOCK_SERVER_DATA = true

function createMockNotifications(now: number): ServerNotification[] {
  const formatTime = (timestamp: number) => new Date(timestamp).toLocaleString("zh-CN", { hour12: false })
  const infrastructureItems: NonNullable<ServerNotification["items"]> = [
    {
      id: "mock-notice-heartbeat",
      type: "offline",
      severity: "error",
      title: "心跳延迟",
      desc: "北京边缘节点连续两次心跳超时",
      detail: "当前延迟 46 秒，实时通道正在自动重连。",
      code: "HEARTBEAT_DELAY",
      source: "clients",
      deviceId: "mock-beijing-edge",
      time: formatTime(now - 2 * 60_000),
      ts: now - 2 * 60_000,
      read: false,
      snoozedUntil: null,
      groupKey: "mock:infrastructure",
    },
    {
      id: "mock-notice-disk",
      type: "health",
      severity: "warning",
      title: "磁盘空间预警",
      desc: "深圳构建节点的缓存分区达到 82%",
      detail: "建议在下一次构建前清理过期制品缓存。",
      code: "DISK_USAGE_HIGH",
      source: "health",
      deviceId: "mock-shenzhen-build",
      time: formatTime(now - 8 * 60_000),
      ts: now - 8 * 60_000,
      read: false,
      snoozedUntil: null,
      groupKey: "mock:infrastructure",
    },
    {
      id: "mock-notice-certificate",
      type: "health",
      severity: "warning",
      title: "证书即将到期",
      desc: "上海主节点的内网证书将在 12 天后到期",
      detail: "续签任务已经创建，等待维护窗口执行。",
      code: "CERT_EXPIRING",
      source: "health",
      deviceId: "mock-shanghai-core",
      time: formatTime(now - 17 * 60_000),
      ts: now - 17 * 60_000,
      read: true,
      snoozedUntil: null,
      groupKey: "mock:infrastructure",
    },
  ]
  const top = infrastructureItems[0]

  return [
    { ...top, count: infrastructureItems.length, items: infrastructureItems },
    {
      id: "mock-notice-task",
      type: "task",
      severity: "error",
      title: "巡检任务执行失败",
      desc: "生产环境夜间巡检未能完成",
      detail: "脚本在验证服务状态时返回退出码 2，请检查目标服务权限。",
      code: "EXIT_2",
      source: "tasks",
      deviceId: "mock-shanghai-core",
      time: formatTime(now - 26 * 60_000),
      ts: now - 26 * 60_000,
      read: false,
      snoozedUntil: null,
      groupKey: "mock:task:nightly-check",
      count: 1,
    },
    {
      id: "mock-notice-recovered",
      type: "offline",
      severity: "warning",
      title: "实时连接已恢复",
      desc: "北京边缘节点重新建立 WebSocket 通道",
      detail: "离线期间的命令队列已完成同步，没有发现丢失任务。",
      code: "CONNECTION_RECOVERED",
      source: "clients",
      deviceId: "mock-beijing-edge",
      time: formatTime(now - 41 * 60_000),
      ts: now - 41 * 60_000,
      read: true,
      snoozedUntil: null,
      groupKey: "mock:connection:recovered",
      count: 1,
    },
  ]
}

let mockNotifications = createMockNotifications(Date.now())

function cloneMockNotifications(): ServerNotification[] {
  return mockNotifications.map((notice) => ({
    ...notice,
    items: notice.items?.map((item) => ({ ...item })),
  }))
}

function getMockServerResponse(path: string, init?: RequestInit): unknown {
  const now = Date.now()

  if (path === "/overview") {
    return {
      clients: { total: 3, online: 3, warning: 0, offline: 0, realtimeConnections: 3 },
      tasks: { total: 0, enabled: 0 },
      plugins: { installed: 0 },
      commands: { pending: 0 },
      resources: { cpu: 18.6, memory: 42.3, disk: 31.8 },
      health: { unread: 0, critical: 0, error: 0, packages: 0 },
      updatedAt: now,
    } satisfies Overview
  }

  if (path === "/clients") {
    return [
      {
        id: "mock-shanghai-core",
        name: "上海主节点",
        hostname: "nacho-sh-core-01",
        ip: "10.24.0.12",
        os: "Linux",
        osName: "Ubuntu 24.04 LTS",
        status: "online",
        tags: ["核心", "生产"],
        group: "生产环境",
        version: "1.8.2",
        lastSeen: now - 8_000,
        registeredAt: now - 1000 * 60 * 60 * 24 * 86,
        metrics: { cpu: 14.8, memory: 38.2, disk: 29.4, uptime: 1000 * 60 * 60 * 24 * 19 },
        connected: true,
      },
      {
        id: "mock-beijing-edge",
        name: "北京边缘节点",
        hostname: "nacho-bj-edge-02",
        ip: "10.18.4.27",
        os: "Windows",
        osName: "Windows Server 2025",
        status: "online",
        tags: ["边缘", "业务"],
        group: "边缘节点",
        version: "1.8.2",
        lastSeen: now - 13_000,
        registeredAt: now - 1000 * 60 * 60 * 24 * 42,
        metrics: { cpu: 22.1, memory: 47.6, disk: 36.9, uptime: 1000 * 60 * 60 * 24 * 8 },
        connected: true,
      },
      {
        id: "mock-shenzhen-build",
        name: "深圳构建节点",
        hostname: "nacho-sz-build-03",
        ip: "10.31.2.8",
        os: "macOS",
        osName: "macOS 26",
        status: "online",
        tags: ["构建", "测试"],
        group: "生产环境",
        version: "1.8.1",
        lastSeen: now - 19_000,
        registeredAt: now - 1000 * 60 * 60 * 24 * 21,
        metrics: { cpu: 18.9, memory: 41.1, disk: 29.1, uptime: 1000 * 60 * 60 * 24 * 5 },
        connected: true,
      },
    ] satisfies Client[]
  }

  if (path === "/groups") return ["生产环境", "边缘节点"]
  if (path === "/logs/sources") return ["nacho-server", "agent"]
  if (path.startsWith("/logs")) {
    return [
      { id: "mock-log-1", ts: now - 12_000, level: "info", source: "nacho-server", message: "服务端运行正常", detail: "模拟连接已建立，3 个客户端保持在线" },
      { id: "mock-log-2", ts: now - 38_000, level: "info", source: "agent", message: "客户端状态同步完成", detail: null },
      { id: "mock-log-3", ts: now - 72_000, level: "debug", source: "nacho-server", message: "资源指标采集完成", detail: null },
    ] satisfies LogEntry[]
  }
  if (path.startsWith("/notifications")) {
    const method = init?.method?.toUpperCase() || "GET"
    if (path === "/notifications" && method === "DELETE") {
      mockNotifications = []
      return { cleared: true }
    }
    if (path === "/notifications/read-all" && method === "POST") {
      mockNotifications = mockNotifications.map((notice) => ({
        ...notice,
        read: true,
        items: notice.items?.map((item) => ({ ...item, read: true })),
      }))
      return { updated: true }
    }

    const groupMatch = path.match(/^\/notifications\/group\/([^/]+)\/(read|snooze)$/)
    if (groupMatch && method === "POST") {
      const groupKey = decodeURIComponent(groupMatch[1])
      if (groupMatch[2] === "snooze") {
        mockNotifications = mockNotifications.filter((notice) => notice.groupKey !== groupKey)
      } else {
        mockNotifications = mockNotifications.map((notice) => notice.groupKey === groupKey ? {
          ...notice,
          read: true,
          items: notice.items?.map((item) => ({ ...item, read: true })),
        } : notice)
      }
      return { updated: true }
    }

    const itemMatch = path.match(/^\/notifications\/([^/]+)\/(read|snooze)$/)
    if (itemMatch && method === "POST") {
      const id = decodeURIComponent(itemMatch[1])
      if (itemMatch[2] === "snooze") {
        mockNotifications = mockNotifications.flatMap((notice) => {
          if (!notice.items?.length) return notice.id === id ? [] : [notice]
          const items = notice.items.filter((item) => item.id !== id)
          if (items.length === notice.items.length) return [notice]
          if (items.length === 0) return []
          if (items.length === 1) return [{ ...items[0], count: 1 }]
          return [{ ...items[0], count: items.length, items }]
        })
      } else {
        mockNotifications = mockNotifications.map((notice) => {
          if (!notice.items?.length) return notice.id === id ? { ...notice, read: true } : notice
          const items = notice.items.map((item) => item.id === id ? { ...item, read: true } : item)
          return { ...notice, ...items[0], count: items.length, items }
        })
      }
      return { updated: true }
    }

    return cloneMockNotifications()
  }
  if (path === "/health/findings" || path === "/health/packages") return []
  if (path === "/tasks" || path === "/plugins" || path === "/install-profiles") return []

  return []
}

export function ServerDataProvider({ children }: { children: ReactNode }) {
  const { settings: localSettings } = useLocalSettings()
  const { serverSource } = useOnboarding()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [notifications, setNotifications] = useState<ServerNotification[]>([])
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
    if (USE_MOCK_SERVER_DATA) return { baseUrl: "mock://nacho-server", key: "mock-preview-key" }
    // 未完成引导时不构造连接，由上层展示引导/错误态，避免伪造可用连接
    if (!serverSource) return null
    if (serverSource?.mode === "cloud") {
      return { baseUrl: normalizeServerBaseUrl(serverSource.api), key: serverSource.key }
    }
    const configuredKey = process.env.NEXT_PUBLIC_NACHO_PANEL_API_KEY
    return {
      baseUrl: defaultServerBaseUrl(),
      key: configuredKey || "change-me-panel-api-key",
    }
  }, [serverSource])

  const apiRequest = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (USE_MOCK_SERVER_DATA) return getMockServerResponse(path, init) as T
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
        if (canApplyNotificationSnapshot(notificationEpoch, notificationMutationEpoch.current)) setNotifications(nextNotifications)
      } catch {
        // 兼容尚未升级通知路由的服务端；核心连接已经确认成功。
        if (canApplyNotificationSnapshot(notificationEpoch, notificationMutationEpoch.current)) setNotifications([])
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
    () => ({ serverBaseUrl: connection?.baseUrl || defaultServerBaseUrl(), overview, clients, groups, logs, notifications, markNotificationRead, markAllNotificationsRead, clearNotifications, snoozeNotification, snoozeNotificationGroup, markNotificationGroupRead, loading, refreshing, error, refresh, apiRequest, uploadRequest, downloadRequest }),
    [connection, overview, clients, groups, logs, notifications, markNotificationRead, markAllNotificationsRead, clearNotifications, snoozeNotification, snoozeNotificationGroup, markNotificationGroupRead, loading, refreshing, error, refresh, apiRequest, uploadRequest, downloadRequest],
  )

  return <ServerDataContext.Provider value={value}>{children}</ServerDataContext.Provider>
}

export function useServerData() {
  const context = useContext(ServerDataContext)
  if (!context) throw new Error("useServerData 必须在 ServerDataProvider 内使用")
  return context
}
