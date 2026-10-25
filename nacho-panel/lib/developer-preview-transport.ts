/**
 * 开发者预览模式的数据传输层：把 ServerDataProvider 的 `/api/panel/*` 调用
 * 路由到内存演示数据，不发起任何真实网络请求。
 *
 * 路由只覆盖主页面需要的读取接口与少量写操作；未覆盖的接口会明确报错，
 * 由各页面已有的错误态展示，避免静默返回错误形状导致渲染异常。
 */

import { developerPreviewUnsupportedMessage } from "./developer-preview"
import {
  createDeveloperPreviewStore,
  developerPreviewAgentUpdates,
  developerPreviewOverview,
  type DeveloperPreviewStore,
  type PreviewClient,
  type PreviewInstallProfile,
  type PreviewInstallProfileValues,
  type PreviewNotification,
  type PreviewPlugin,
  type PreviewTask,
} from "./developer-preview-data"

type PreviewTransportOptions = {
  /** 测试可注入固定 store，页面运行默认新建一份。 */
  store?: DeveloperPreviewStore
  /** 测试可注入固定时钟。 */
  now?: () => number
}

export type DeveloperPreviewTransport = {
  store: DeveloperPreviewStore
  request: <T>(path: string, init?: RequestInit) => Promise<T>
}

const EMPTY_LIST_PREFIXES = ["/commands", "/managed-artifacts", "/deployment-batches"]

function readBody<T>(init?: RequestInit): T | null {
  if (!init?.body) return null
  try {
    return JSON.parse(String(init.body)) as T
  } catch {
    return null
  }
}

function findNotification(store: DeveloperPreviewStore, id: string) {
  const direct = store.notifications.find((item) => item.id === id)
  if (direct) return direct
  for (const notice of store.notifications) {
    const child = notice.items?.find((item) => item.id === id)
    if (child) return child
  }
  return undefined
}

function markNotification(store: DeveloperPreviewStore, id: string, patch: Partial<PreviewNotification>) {
  const apply = (item: PreviewNotification): PreviewNotification => item.id === id ? { ...item, ...patch } : item
  store.notifications = store.notifications.map((notice) => {
    const next = apply(notice)
    return next.items ? { ...next, items: next.items.map(apply) } : next
  })
}

function markGroup(store: DeveloperPreviewStore, groupKey: string, patch: Partial<PreviewNotification>) {
  store.notifications = store.notifications.map((notice) => {
    if (notice.groupKey !== groupKey) return notice
    return {
      ...notice,
      ...patch,
      items: notice.items?.map((item) => ({ ...item, ...patch })),
    }
  })
}

function sortNotifications(notifications: PreviewNotification[]) {
  return [...notifications].sort((a, b) => b.ts - a.ts)
}

function resolveNotificationQuery(notifications: PreviewNotification[], search: URLSearchParams) {
  const limit = Number(search.get("limit"))
  const sorted = sortNotifications(notifications)
  return Number.isFinite(limit) && limit > 0 ? sorted.slice(0, limit) : sorted
}

function createProfileId(store: DeveloperPreviewStore, timestamp: number) {
  const index = store.installProfiles.length + 1
  return `preview-profile-${index}-${timestamp.toString(36).slice(-4)}`
}

export function createDeveloperPreviewTransport(options: PreviewTransportOptions = {}): DeveloperPreviewTransport {
  const store = options.store ?? createDeveloperPreviewStore()
  const now = options.now ?? (() => Date.now())

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const method = (init?.method ?? "GET").toUpperCase()
    const [pathname = "", queryString = ""] = path.split("?")
    const search = new URLSearchParams(queryString)

    const unsupported = (): never => {
      throw new Error(developerPreviewUnsupportedMessage(`${method} ${pathname}`))
    }

    /* ---------------- 只读接口 ---------------- */
    if (method === "GET") {
      if (pathname === "/overview") return developerPreviewOverview(store, now()) as T
      if (pathname === "/clients") return store.clients as T
      if (pathname === "/groups") return store.groups as T
      if (pathname === "/logs") {
        const limit = Number(search.get("limit"))
        const rows = [...store.logs].sort((a, b) => b.ts - a.ts)
        return (Number.isFinite(limit) && limit > 0 ? rows.slice(0, limit) : rows) as T
      }
      if (pathname === "/logs/sources") return Array.from(new Set(store.logs.map((row) => row.source))) as T
      if (pathname === "/notifications") return resolveNotificationQuery(store.notifications, search) as T
      if (pathname === "/tasks") return store.tasks as T
      if (pathname === "/plugins") return store.plugins as T
      if (pathname === "/health/findings") return store.findings as T
      if (pathname === "/health/packages") return store.packages as T
      if (pathname === "/settings") return store.settings as T
      if (pathname === "/runtime-info") return store.runtimeInfo as T
      if (pathname === "/install-profiles") return store.installProfiles as T
      if (pathname === "/agent-updates") return developerPreviewAgentUpdates(store) as T

      const clientMatch = /^\/clients\/([^/]+)$/.exec(pathname)
      if (clientMatch) {
        const client = store.clients.find((item) => item.id === decodeURIComponent(clientMatch[1]))
        if (!client) throw new Error("开发者预览模式中不存在该客户端")
        return client as T
      }

      const revisionsMatch = /^\/install-profiles\/([^/]+)\/revisions$/.exec(pathname)
      if (revisionsMatch) {
        const profileId = decodeURIComponent(revisionsMatch[1])
        return store.installRevisions
          .filter((revision) => revision.profileId === profileId)
          .sort((a, b) => b.revision - a.revision) as T
      }

      if (EMPTY_LIST_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
        return [] as T
      }

      return unsupported()
    }

    /* ---------------- 通知中心 ---------------- */
    if (method === "DELETE" && pathname === "/notifications") {
      store.notifications = []
      return undefined as T
    }
    if (method === "POST" && pathname === "/notifications/read-all") {
      store.notifications = store.notifications.map((notice) => ({
        ...notice,
        read: true,
        items: notice.items?.map((item) => ({ ...item, read: true })),
      }))
      return undefined as T
    }
    const groupActionMatch = /^\/notifications\/group\/([^/]+)\/(read|snooze)$/.exec(pathname)
    if (method === "POST" && groupActionMatch) {
      const groupKey = decodeURIComponent(groupActionMatch[1])
      const action = groupActionMatch[2]
      const body = readBody<{ until?: number }>(init)
      markGroup(store, groupKey, action === "read" ? { read: true } : { snoozedUntil: body?.until ?? null })
      return undefined as T
    }
    const noticeActionMatch = /^\/notifications\/([^/]+)\/(read|snooze)$/.exec(pathname)
    if (method === "POST" && noticeActionMatch) {
      const id = decodeURIComponent(noticeActionMatch[1])
      const action = noticeActionMatch[2]
      const body = readBody<{ until?: number }>(init)
      markNotification(store, id, action === "read" ? { read: true } : { snoozedUntil: body?.until ?? null })
      return undefined as T
    }

    /* ---------------- 客户端与分组 ---------------- */
    if (method === "POST" && pathname === "/clients") {
      const body = readBody<{ name?: string; hostname?: string; os?: string; group?: string }>(init)
      store.counters.client += 1
      const client: PreviewClient = {
        id: `preview-client-new-${store.counters.client}`,
        name: body?.name?.trim() || "新客户端",
        hostname: body?.hostname?.trim() || body?.name?.trim() || "new-client",
        ip: "192.168.1.100",
        os: body?.os === "Linux" || body?.os === "macOS" ? body.os : "Windows",
        osName: "待接入",
        status: "unregistered",
        tags: [],
        group: body?.group || store.groups[0] || "默认分组",
        version: "—",
        lastSeen: now(),
        registeredAt: now(),
        metrics: null,
        connected: false,
      }
      store.clients = [client, ...store.clients]
      return client as T
    }
    const deleteClientMatch = /^\/clients\/([^/]+)$/.exec(pathname)
    if (method === "DELETE" && deleteClientMatch) {
      const id = decodeURIComponent(deleteClientMatch[1])
      store.clients = store.clients.filter((client) => client.id !== id)
      return undefined as T
    }
    if (method === "POST" && pathname === "/groups") {
      const body = readBody<{ name?: string }>(init)
      const name = body?.name?.trim()
      if (name && !store.groups.includes(name)) store.groups = [...store.groups, name]
      return store.groups as T
    }

    /* ---------------- 计划任务 ---------------- */
    if (method === "POST" && pathname === "/tasks") {
      const body = readBody<Partial<PreviewTask>>(init)
      store.counters.task += 1
      const task: PreviewTask = {
        id: `preview-task-new-${store.counters.task}`,
        name: body?.name || "新计划任务",
        os: body?.os === "linux" ? "linux" : "windows",
        action: body?.action || "运行程序",
        program: body?.program || "",
        args: body?.args || "",
        triggerId: body?.triggerId || "daily",
        time: body?.time || "00:00",
        interval: body?.interval ?? 1,
        cron: body?.cron || "",
        clientIds: body?.clientIds ?? [],
        enabled: body?.enabled ?? true,
      }
      store.tasks = [task, ...store.tasks]
      return task as T
    }
    const taskMatch = /^\/tasks\/([^/]+)$/.exec(pathname)
    if (taskMatch && method === "PATCH") {
      const id = decodeURIComponent(taskMatch[1])
      const body = readBody<Partial<PreviewTask>>(init)
      const current = store.tasks.find((task) => task.id === id)
      if (!current) throw new Error("开发者预览模式中不存在该计划任务")
      const updated: PreviewTask = { ...current, ...body, id: current.id }
      store.tasks = store.tasks.map((task) => task.id === id ? updated : task)
      return updated as T
    }
    if (taskMatch && method === "DELETE") {
      const id = decodeURIComponent(taskMatch[1])
      store.tasks = store.tasks.filter((task) => task.id !== id)
      return undefined as T
    }
    const taskEnabledMatch = /^\/tasks\/([^/]+)\/enabled$/.exec(pathname)
    if (method === "POST" && taskEnabledMatch) {
      const id = decodeURIComponent(taskEnabledMatch[1])
      const body = readBody<{ enabled?: boolean }>(init)
      const current = store.tasks.find((task) => task.id === id)
      if (!current) throw new Error("开发者预览模式中不存在该计划任务")
      const updated = { ...current, enabled: body?.enabled ?? !current.enabled }
      store.tasks = store.tasks.map((task) => task.id === id ? updated : task)
      return updated as T
    }
    const taskDispatchMatch = /^\/tasks\/([^/]+)\/dispatch$/.exec(pathname)
    if (method === "POST" && taskDispatchMatch) return undefined as T

    /* ---------------- 插件 ---------------- */
    if (method === "POST" && pathname === "/plugins") {
      const body = readBody<Partial<PreviewPlugin>>(init)
      store.counters.plugin += 1
      const plugin: PreviewPlugin = {
        id: `preview-plugin-new-${store.counters.plugin}`,
        name: body?.name || "新插件",
        version: body?.version || "0.1.0",
        author: body?.author || "NachoNeko",
        category: body?.category || "工具",
        description: body?.description || "",
        size: body?.size || "0.1 MiB",
        icon: body?.icon || "puzzle",
        status: body?.status || "available",
        restartRestore: body?.restartRestore ?? false,
        params: body?.params ?? [],
      }
      store.plugins = [plugin, ...store.plugins]
      return plugin as T
    }
    const pluginMatch = /^\/plugins\/([^/]+)$/.exec(pathname)
    if (pluginMatch && method === "PATCH") {
      const id = decodeURIComponent(pluginMatch[1])
      const body = readBody<Partial<PreviewPlugin>>(init)
      const current = store.plugins.find((plugin) => plugin.id === id)
      if (!current) throw new Error("开发者预览模式中不存在该插件")
      const updated: PreviewPlugin = { ...current, ...body, id: current.id, params: body?.params ?? current.params }
      store.plugins = store.plugins.map((plugin) => plugin.id === id ? updated : plugin)
      return updated as T
    }
    if (pluginMatch && method === "DELETE") {
      const id = decodeURIComponent(pluginMatch[1])
      store.plugins = store.plugins.filter((plugin) => plugin.id !== id)
      return undefined as T
    }
    const pluginStatusMatch = /^\/plugins\/([^/]+)\/status$/.exec(pathname)
    if (method === "POST" && pluginStatusMatch) {
      const id = decodeURIComponent(pluginStatusMatch[1])
      const body = readBody<{ status?: PreviewPlugin["status"] }>(init)
      const current = store.plugins.find((plugin) => plugin.id === id)
      if (!current) throw new Error("开发者预览模式中不存在该插件")
      const updated = { ...current, status: body?.status ?? current.status }
      store.plugins = store.plugins.map((plugin) => plugin.id === id ? updated : plugin)
      return updated as T
    }

    /* ---------------- 健康中心 ---------------- */
    if (method === "POST" && pathname === "/health/findings/read-all") {
      store.findings = store.findings.map((finding) => ({ ...finding, read: true }))
      return undefined as T
    }
    const findingReadMatch = /^\/health\/findings\/([^/]+)\/read$/.exec(pathname)
    if (method === "POST" && findingReadMatch) {
      const id = decodeURIComponent(findingReadMatch[1])
      store.findings = store.findings.map((finding) => finding.id === id ? { ...finding, read: true } : finding)
      return undefined as T
    }
    const packageActionMatch = /^\/health\/packages\/([^/]+)\/(reanalyze|recollect)$/.exec(pathname)
    if (method === "POST" && packageActionMatch) {
      const id = decodeURIComponent(packageActionMatch[1])
      const analyzedAt = now()
      store.packages = store.packages.map((item) => item.id === id
        ? {
            ...item,
            status: item.status === "failed" ? "analyzed" : item.status,
            error: null,
            analyzedAt,
            downloadable: true,
          }
        : item)
      return undefined as T
    }

    /* ---------------- 设置 ---------------- */
    if (method === "PUT" && pathname === "/settings") {
      const body = readBody<{ security?: { openEnrollment?: boolean } }>(init)
      if (typeof body?.security?.openEnrollment === "boolean") {
        store.settings = { ...store.settings, security: { ...store.settings.security, openEnrollment: body.security.openEnrollment } }
      }
      return store.settings as T
    }

    /* ---------------- 安装档案 ---------------- */
    if (method === "POST" && pathname === "/install-profiles") {
      const body = readBody<PreviewInstallProfileValues & { note?: string }>(init)
      const timestamp = now()
      const profile: PreviewInstallProfile = {
        id: createProfileId(store, timestamp),
        name: body?.name || "新安装档案",
        runMode: body?.runMode === "silent" ? "silent" : "menu",
        agentServerUrl: body?.agentServerUrl ?? null,
        heartbeatSeconds: body?.heartbeatSeconds ?? 20,
        pollSeconds: body?.pollSeconds ?? 15,
        clientName: body?.clientName ?? null,
        group: body?.group || "默认分组",
        tags: body?.tags ?? [],
        overwriteExisting: body?.overwriteExisting ?? false,
        reEnrollOnServerChange: body?.reEnrollOnServerChange ?? false,
        isDefault: false,
        revision: 1,
        activeRevision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      store.installProfiles = [profile, ...store.installProfiles]
      store.installRevisions = [
        {
          profileId: profile.id,
          revision: 1,
          snapshot: {
            name: profile.name,
            runMode: profile.runMode,
            agentServerUrl: profile.agentServerUrl,
            heartbeatSeconds: profile.heartbeatSeconds,
            pollSeconds: profile.pollSeconds,
            clientName: profile.clientName,
            group: profile.group,
            tags: profile.tags,
            overwriteExisting: profile.overwriteExisting,
            reEnrollOnServerChange: profile.reEnrollOnServerChange,
          },
          note: body?.note || "创建安装档案",
          createdAt: timestamp,
        },
        ...store.installRevisions,
      ]
      return profile as T
    }
    const profileMatch = /^\/install-profiles\/([^/]+)$/.exec(pathname)
    if (profileMatch && method === "PUT") {
      const id = decodeURIComponent(profileMatch[1])
      const body = readBody<PreviewInstallProfileValues & { note?: string }>(init)
      const current = store.installProfiles.find((profile) => profile.id === id)
      if (!current) throw new Error("开发者预览模式中不存在该安装档案")
      const timestamp = now()
      const nextRevision = current.revision + 1
      const updated: PreviewInstallProfile = {
        ...current,
        ...(body ?? {}),
        id: current.id,
        revision: nextRevision,
        activeRevision: nextRevision,
        updatedAt: timestamp,
      }
      store.installProfiles = store.installProfiles.map((profile) => profile.id === id ? updated : profile)
      store.installRevisions = [
        {
          profileId: id,
          revision: nextRevision,
          snapshot: {
            name: updated.name,
            runMode: updated.runMode,
            agentServerUrl: updated.agentServerUrl,
            heartbeatSeconds: updated.heartbeatSeconds,
            pollSeconds: updated.pollSeconds,
            clientName: updated.clientName,
            group: updated.group,
            tags: updated.tags,
            overwriteExisting: updated.overwriteExisting,
            reEnrollOnServerChange: updated.reEnrollOnServerChange,
          },
          note: body?.note || "更新安装参数",
          createdAt: timestamp,
        },
        ...store.installRevisions,
      ]
      return updated as T
    }
    if (profileMatch && method === "DELETE") {
      const id = decodeURIComponent(profileMatch[1])
      if (store.installProfiles.length <= 1) throw new Error("至少需要保留一个安装档案")
      const remaining = store.installProfiles.filter((profile) => profile.id !== id)
      const defaultProfileId = remaining.find((profile) => profile.isDefault)?.id
        ?? remaining[0]?.id
        ?? null
      store.installProfiles = remaining.map((profile) => ({
        ...profile,
        isDefault: profile.id === defaultProfileId,
      }))
      store.installRevisions = store.installRevisions.filter((revision) => revision.profileId !== id)
      return { id, defaultProfileId } as T
    }
    const defaultProfileMatch = /^\/install-profiles\/([^/]+)\/default$/.exec(pathname)
    if (method === "POST" && defaultProfileMatch) {
      const id = decodeURIComponent(defaultProfileMatch[1])
      const current = store.installProfiles.find((profile) => profile.id === id)
      if (!current) throw new Error("开发者预览模式中不存在该安装档案")
      store.installProfiles = store.installProfiles.map((profile) => ({ ...profile, isDefault: profile.id === id }))
      return { ...current, isDefault: true } as T
    }
    const restoreRevisionMatch = /^\/install-profiles\/([^/]+)\/revisions\/(\d+)\/restore$/.exec(pathname)
    if (method === "POST" && restoreRevisionMatch) {
      const id = decodeURIComponent(restoreRevisionMatch[1])
      const revisionNumber = Number(restoreRevisionMatch[2])
      const current = store.installProfiles.find((profile) => profile.id === id)
      const revision = store.installRevisions.find((item) => item.profileId === id && item.revision === revisionNumber)
      if (!current || !revision) throw new Error("开发者预览模式中不存在该安装档案或版本")
      const updated: PreviewInstallProfile = {
        ...current,
        ...revision.snapshot,
        activeRevision: revision.revision,
        updatedAt: now(),
      }
      store.installProfiles = store.installProfiles.map((profile) => profile.id === id ? updated : profile)
      return updated as T
    }

    /* ---------------- 日志清空 ---------------- */
    if (method === "DELETE" && pathname === "/logs") {
      store.logs = []
      return undefined as T
    }

    return unsupported()
  }

  return { store, request }
}
