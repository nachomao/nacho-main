import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { setImmediate } from "node:timers/promises"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import type { useServerData } from "../components/server-data-context"

const providerUrl = new URL("../components/server-data-context.tsx", import.meta.url)
const { outputText: provider } = ts.transpileModule(readFileSync(providerUrl, "utf8"), {
  fileName: "server-data-context.tsx",
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
})

type Mode = "online" | "silent" | "bad-key" | "silent-notifications"
type Status = Pick<ReturnType<typeof useServerData>, "error" | "loading" | "refreshing">

// 执行实际 Provider。时间、HTTP 和 React hook 宿主由测试控制，不访问真实服务端。
function mountProvider(initialMode: Mode) {
  let mode = initialMode
  let time = 0
  let timerId = 0
  const timers = new Map<number, { at: number; run: () => void; interval: number }>()
  const startTimer = (run: () => void, ms: number, interval = 0) => {
    timers.set(++timerId, { at: time + ms, run, interval })
    return timerId
  }
  async function advanceTo(target: number) {
    for (;;) {
      const item = [...timers].sort(([, a], [, b]) => a.at - b.at)[0]
      if (!item || item[1].at > target) break
      const [id, timer] = item
      time = timer.at
      if (timer.interval) timer.at += timer.interval
      else timers.delete(id)
      timer.run()
      await setImmediate()
    }
    time = target
    await setImmediate()
  }

  const values: unknown[] = []
  const refs: { current: unknown }[] = []
  const effects: (() => void)[] = []
  let stateIndex = 0
  let refIndex = 0
  let mounted = false
  const source = { mode: "cloud", api: "http://panel-fixture.invalid", key: "fixture-key" }
  const settings = { notificationCenter: { maxItems: 10, retentionDays: 1, autoPurge: false } }
  const imports: Record<string, unknown> = {
    react: {
      createContext: () => ({ Provider: Symbol() }),
      useCallback: (fn: unknown) => fn,
      useMemo: (fn: () => unknown) => fn(),
      useRef: (value: unknown) => { const i = refIndex++; return refs[i] ??= { current: value } },
      useState: (value: unknown) => {
        const i = stateIndex++
        if (!(i in values)) values[i] = value
        return [values[i], (next: unknown) => { values[i] = next }]
      },
      useEffect: (fn: () => void) => { if (!mounted) effects.push(fn) },
    },
    "react/jsx-runtime": { jsx: (_type: unknown, props: unknown) => ({ props }) },
    "@/components/onboarding/onboarding-context": { useOnboarding: () => ({ serverSource: source, hydrated: true }) },
    "@/components/local-settings-provider": { useLocalSettings: () => ({ settings }) },
    "@/lib/server-connection": { normalizeServerBaseUrl: (url: string) => url },
    "@/lib/notification-state": { canApplyNotificationSnapshot: () => true },
    "@/lib/panel-version": { PANEL_VERSION: "fixture-version" },
    "@/lib/developer-preview": { isDeveloperPreviewSource: () => false },
    "@/lib/developer-preview-transport": {},
  }
  const overview = {
    clients: { total: 0, online: 0, warning: 0, offline: 0, realtimeConnections: 0 },
    tasks: { total: 0, enabled: 0 }, plugins: { installed: 0 }, commands: { pending: 0 },
    resources: { cpu: 0, memory: 0, disk: 0 },
    health: { unread: 0, critical: 0, error: 0, packages: 0 }, updatedAt: 0,
  }
  const exports = {} as { ServerDataProvider: (props: { children: null }) => { props: { value: Status } } }
  const env = {
    exports,
    require: (id: string) => { assert.ok(id in imports, id); return imports[id] },
    window: {
      setInterval: (run: () => void, ms: number) => startTimer(run, ms, ms),
      clearInterval: (id: number) => timers.delete(id),
    },
    AbortSignal: {
      timeout: (ms: number) => {
        const controller = new AbortController()
        startTimer(() => controller.abort(), ms)
        return controller.signal
      },
    },
    fetch: (url: string, { signal }: { signal: AbortSignal }) => {
      const path = new URL(url).pathname
      if ((mode === "silent" && path === "/api/panel/overview") ||
          (mode === "silent-notifications" && path === "/api/panel/notifications")) {
        return new Promise<Response>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
      }
      if (mode === "bad-key" && path === "/api/panel/overview") {
        return Promise.resolve(Response.json({ ok: false, message: "API Key 无效" }, { status: 401 }))
      }
      return Promise.resolve(Response.json({ ok: true, data: path === "/api/panel/overview" ? overview : [] }))
    },
  }
  runInNewContext(provider, env, { filename: providerUrl.pathname })
  function status() {
    stateIndex = 0
    refIndex = 0
    return exports.ServerDataProvider({ children: null }).props.value
  }
  status()
  mounted = true
  for (const run of effects) run()
  return { status, advanceTo, setMode: (next: Mode) => { mode = next } }
}

test("首次无响应：一轮 8 秒超时就发布连接错误，不被轮询覆盖", async () => {
  const panel = mountProvider("silent")
  await panel.advanceTo(7_999)
  assert.equal(panel.status().error, null)
  await panel.advanceTo(8_000)
  assert.equal(panel.status().error, "连接服务端失败，请检查服务端地址和网络")
  assert.equal(panel.status().loading, false)
  assert.equal(panel.status().refreshing, false)
})

test("已连接后掉线：保留错误到概览接口恢复，不等待通知接口", async () => {
  const panel = mountProvider("online")
  await panel.advanceTo(0)
  assert.equal(panel.status().error, null)

  panel.setMode("silent")
  await panel.advanceTo(11_000)
  const disconnected = panel.status().error
  assert.equal(disconnected, "连接服务端失败，请检查服务端地址和网络")
  await panel.advanceTo(12_000)
  assert.equal(panel.status().refreshing, true)
  assert.equal(panel.status().error, disconnected)
  await panel.advanceTo(20_000)
  assert.equal(panel.status().error, disconnected)

  panel.setMode("bad-key")
  await panel.advanceTo(21_000)
  assert.equal(panel.status().error, "API Key 无效")

  panel.setMode("silent-notifications")
  await panel.advanceTo(24_000)
  assert.equal(panel.status().error, null)
  assert.equal(panel.status().refreshing, true)
})

