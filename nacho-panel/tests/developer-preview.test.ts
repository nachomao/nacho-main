import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {
  DEVELOPER_PREVIEW_API,
  DEVELOPER_PREVIEW_KEY,
  developerPreviewUnsupportedMessage,
  isDeveloperPreviewCredentials,
  isDeveloperPreviewSource,
} from "../lib/developer-preview"
import { createDeveloperPreviewStore } from "../lib/developer-preview-data"
import { createDeveloperPreviewTransport } from "../lib/developer-preview-transport"

// 固定时钟：演示数据的时间戳必须可复现，避免测试结果随运行时间漂移。
const FIXED_NOW = Date.UTC(2026, 9, 24, 16, 0, 0)

type OverviewShape = {
  clients: { total: number; online: number; warning: number; offline: number; realtimeConnections: number }
  tasks: { total: number; enabled: number }
  plugins: { installed: number }
  health: { unread: number; critical: number; packages: number }
}

type NotificationShape = {
  id: string
  read: boolean
  groupKey: string
  items?: Array<{ id: string; read: boolean }>
}

test("开发者预览凭据只命中 localhost + localhosttest", () => {
  for (const api of ["localhost", "LOCALHOST", "http://localhost", "http://localhost/", "  http://LOCALHOST/  "]) {
    assert.equal(isDeveloperPreviewCredentials(api, "localhosttest"), true, api)
  }
  assert.equal(isDeveloperPreviewCredentials("localhost", "  localhosttest  "), true)
  for (const api of [
    "localhost:8443",
    "http://localhost:8443",
    "https://localhost",
    "127.0.0.1",
    "http://127.0.0.1:8443",
    "localhost/api",
    "http://localhost/other",
    "maojiu.cc:8443",
    "",
  ]) {
    assert.equal(isDeveloperPreviewCredentials(api, "localhosttest"), false, api)
  }
  assert.equal(isDeveloperPreviewCredentials("localhost", "not-the-key"), false)
  assert.equal(isDeveloperPreviewCredentials("localhost", "localhosttest2"), false)
  assert.equal(isDeveloperPreviewCredentials("localhost", "LOCALHOSTTEST"), false)
})

test("已保存来源只有预览 cloud 组合才被识别", () => {
  assert.equal(isDeveloperPreviewSource(null), false)
  assert.equal(isDeveloperPreviewSource(undefined), false)
  assert.equal(isDeveloperPreviewSource({ mode: "local", api: "http://127.0.0.1:8443", key: "key" }), false)
  assert.equal(isDeveloperPreviewSource({ mode: "cloud", api: "http://maojiu.cc:8443", key: "key" }), false)
  assert.equal(isDeveloperPreviewSource({ mode: "cloud", api: "http://localhost:8443", key: DEVELOPER_PREVIEW_KEY }), false)
  assert.equal(isDeveloperPreviewSource({ mode: "cloud", api: DEVELOPER_PREVIEW_API, key: "other" }), false)
  assert.equal(isDeveloperPreviewSource({ mode: "cloud", api: DEVELOPER_PREVIEW_API, key: DEVELOPER_PREVIEW_KEY }), true)
})

test("演示 store 提供稳定的主页面数据", () => {
  const store = createDeveloperPreviewStore(FIXED_NOW)
  assert.equal(store.clients.length, 4)
  assert.equal(store.groups.length, 3)
  assert.equal(store.tasks.length, 3)
  assert.equal(store.plugins.length, 4)
  assert.equal(store.findings.length, 5)
  assert.equal(store.packages.length, 2)
  assert.ok(store.logs.length >= 10)
  assert.ok(store.notifications.length >= 4)
  assert.equal(store.installProfiles.filter((profile) => profile.isDefault).length, 1)
})

test("预览传输为主页面提供演示数据", async () => {
  const transport = createDeveloperPreviewTransport({ now: () => FIXED_NOW })

  const overview = await transport.request<OverviewShape>("/overview")
  assert.equal(overview.clients.total, 4)
  assert.equal(overview.clients.online, 2)
  assert.equal(overview.clients.warning, 1)
  assert.equal(overview.clients.offline, 1)
  assert.equal(overview.tasks.total, 3)
  assert.equal(overview.tasks.enabled, 2)
  assert.equal(overview.plugins.installed, 2)
  assert.equal(overview.health.packages, 2)

  const clients = await transport.request<Array<{ id: string; status: string }>>("/clients")
  assert.equal(clients.length, 4)
  assert.equal(clients.some((client) => client.status === "offline"), true)

  const single = await transport.request<{ id: string }>(`/clients/${encodeURIComponent(clients[0].id)}`)
  assert.equal(single.id, clients[0].id)

  const groups = await transport.request<string[]>("/groups")
  assert.deepEqual(groups, ["默认分组", "设计工作室", "服务器"])

  const logs = await transport.request<Array<{ id: string }>>("/logs?limit=5")
  assert.equal(logs.length, 5)
  const sources = await transport.request<string[]>("/logs/sources")
  assert.ok(sources.length >= 4)

  const notifications = await transport.request<NotificationShape[]>("/notifications?limit=10&grouped=true")
  assert.ok(notifications.length >= 4)
  assert.ok(notifications.some((notice) => Array.isArray(notice.items) && notice.items.length > 1))

  const tasks = await transport.request<Array<{ enabled: boolean }>>("/tasks")
  assert.equal(tasks.length, 3)
  assert.equal(tasks.filter((task) => task.enabled).length, 2)

  const plugins = await transport.request<Array<{ status: string }>>("/plugins")
  assert.equal(plugins.length, 4)
  assert.ok(plugins.some((plugin) => plugin.status === "installed"))

  const findings = await transport.request<Array<{ read: boolean }>>("/health/findings")
  assert.equal(findings.length, 5)
  assert.equal(findings.filter((finding) => !finding.read).length, 3)

  const packages = await transport.request<Array<{ status: string }>>("/health/packages")
  assert.equal(packages.length, 2)

  const settings = await transport.request<{ security: { openEnrollment: boolean } }>("/settings")
  assert.equal(settings.security.openEnrollment, false)

  const runtime = await transport.request<{ version: string; updateExecutor: boolean }>("/runtime-info")
  assert.equal(runtime.updateExecutor, false)
  assert.match(runtime.version, /^\d+\.\d+\.\d+$/)

  const profiles = await transport.request<Array<{ id: string }>>("/install-profiles")
  assert.equal(profiles.length, 2)
  const revisions = await transport.request<Array<{ profileId: string }>>(`/install-profiles/${encodeURIComponent(profiles[0].id)}/revisions`)
  assert.ok(revisions.every((revision) => revision.profileId === profiles[0].id))

  const updates = await transport.request<{ release: { version: string }; clients: Array<{ id: string }> }>("/agent-updates")
  assert.match(updates.release.version, /^\d+\.\d+\.\d+$/)
  assert.equal(updates.clients.length, clients.length)

  assert.deepEqual(await transport.request<unknown[]>("/commands?clientId=x"), [])
  assert.deepEqual(await transport.request<unknown[]>("/managed-artifacts?kind=package"), [])
  assert.deepEqual(await transport.request<unknown[]>("/deployment-batches?kind=file&limit=1"), [])
})

test("预览传输的写操作更新内存演示数据", async () => {
  const transport = createDeveloperPreviewTransport({ now: () => FIXED_NOW })

  const beforeNotifications = await transport.request<NotificationShape[]>("/notifications?grouped=true")
  const first = beforeNotifications[0]
  const targetId = first.items?.[0]?.id ?? first.id
  await transport.request(`/notifications/${encodeURIComponent(targetId)}/read`, { method: "POST" })
  const afterNotifications = await transport.request<NotificationShape[]>("/notifications?grouped=true")
  const isRead = afterNotifications.some((notice) =>
    notice.id === targetId
    || notice.items?.some((item) => item.id === targetId && item.read),
  )
  assert.equal(isRead, true)

  const beforeClients = await transport.request<Array<{ id: string }>>("/clients")
  const created = await transport.request<{ id: string; name: string }>("/clients", {
    method: "POST",
    body: JSON.stringify({ name: "PREVIEW-PC", os: "Windows", group: "服务器" }),
  })
  const afterClients = await transport.request<Array<{ id: string }>>("/clients")
  assert.equal(afterClients.length, beforeClients.length + 1)
  assert.equal(afterClients[0].id, created.id)
  const overviewAfterAdd = await transport.request<OverviewShape>("/overview")
  assert.equal(overviewAfterAdd.clients.total, afterClients.length)

  const createdTask = await transport.request<{ id: string; enabled: boolean }>("/tasks", {
    method: "POST",
    body: JSON.stringify({ name: "预览任务", os: "windows", clientIds: [created.id] }),
  })
  await transport.request(`/tasks/${encodeURIComponent(createdTask.id)}/enabled`, {
    method: "POST",
    body: JSON.stringify({ enabled: false }),
  })
  const tasks = await transport.request<Array<{ id: string; enabled: boolean }>>("/tasks")
  assert.equal(tasks.find((task) => task.id === createdTask.id)?.enabled, false)

  const plugin = (await transport.request<Array<{ id: string; status: string }>>("/plugins"))[0]
  await transport.request(`/plugins/${encodeURIComponent(plugin.id)}/status`, {
    method: "POST",
    body: JSON.stringify({ status: "disabled" }),
  })
  const plugins = await transport.request<Array<{ id: string; status: string }>>("/plugins")
  assert.equal(plugins.find((item) => item.id === plugin.id)?.status, "disabled")

  const profile = (await transport.request<Array<{ id: string; revision: number; isDefault: boolean }>>("/install-profiles"))
    .find((item) => !item.isDefault)
  assert.ok(profile)
  const updatedProfile = await transport.request<{ revision: number; activeRevision: number }>(
    `/install-profiles/${encodeURIComponent(profile.id)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        name: "预览档案（已更新）",
        runMode: "silent",
        agentServerUrl: null,
        heartbeatSeconds: 30,
        pollSeconds: 15,
        clientName: null,
        group: "服务器",
        tags: [],
        overwriteExisting: false,
        reEnrollOnServerChange: false,
        note: "预览保存",
      }),
    },
  )
  assert.equal(updatedProfile.revision, profile.revision + 1)

  await transport.request("/health/findings/read-all", { method: "POST" })
  const findings = await transport.request<Array<{ read: boolean }>>("/health/findings")
  assert.ok(findings.every((finding) => finding.read))
})

test("预览传输对未覆盖接口给出明确错误", async () => {
  const transport = createDeveloperPreviewTransport({ now: () => FIXED_NOW })

  await assert.rejects(
    transport.request("/clients/preview-client-win-001/commands", { method: "POST", body: "{}" }),
    (error: unknown) => error instanceof Error && error.message.includes("开发者预览模式不支持该操作"),
  )
  await assert.rejects(
    transport.request("/product-updates/server", { method: "POST", body: "{}" }),
    /开发者预览模式不支持该操作/,
  )
  assert.match(developerPreviewUnsupportedMessage("上传文件"), /开发者预览模式不支持该操作/)
})

test("云端对接表单在真实 fetch 前识别开发者预览凭据", () => {
  const source = readFileSync(new URL("../components/onboarding/server-register.tsx", import.meta.url), "utf8")
  assert.match(source, /isDeveloperPreviewCredentials\(baseUrl, apiKey\)/)
  assert.match(source, /onDeveloperPreview/)
  const previewIndex = source.indexOf("isDeveloperPreviewCredentials(baseUrl, apiKey)")
  const fetchIndex = source.indexOf("fetch(`${baseUrl}/api/panel/overview`")
  assert.ok(previewIndex > -1 && fetchIndex > -1)
  assert.ok(previewIndex < fetchIndex, "开发者预览判定必须早于真实 fetch")
})

test("数据提供者用预览传输替换真实请求并暴露预览标记", () => {
  const source = readFileSync(new URL("../components/server-data-context.tsx", import.meta.url), "utf8")
  assert.match(source, /isDeveloperPreviewSource\(serverSource\)/)
  assert.match(source, /createDeveloperPreviewTransport\(\)/)
  assert.match(source, /previewTransport\.request<T>\(path, init\)/)
  assert.match(source, /developerPreview: boolean/)
})

test("引导上下文提供进入与退出开发者预览", () => {
  const source = readFileSync(new URL("../components/onboarding/onboarding-context.tsx", import.meta.url), "utf8")
  assert.match(source, /enterDeveloperPreview: \(\) => Promise<void>/)
  assert.match(source, /exitDeveloperPreview: \(\) => Promise<void>/)
  assert.match(source, /DEVELOPER_PREVIEW_API/)
  assert.match(source, /DEVELOPER_PREVIEW_LOGIN_SECRET/)
})

test("预览模式界面具备标识、退出与更新降级入口", () => {
  const topbar = readFileSync(new URL("../components/topbar.tsx", import.meta.url), "utf8")
  assert.match(topbar, /开发者预览<\/span>?|开发者预览/)
  assert.match(topbar, /DeveloperPreviewBadge/)
  const connection = readFileSync(new URL("../components/settings/connection-panel.tsx", import.meta.url), "utf8")
  assert.match(connection, /exitDeveloperPreview/)
  assert.match(connection, /退出开发者预览/)
  const updates = readFileSync(new URL("../components/settings/updates-panel.tsx", import.meta.url), "utf8")
  assert.match(updates, /开发者预览模式不检查更新/)
})
