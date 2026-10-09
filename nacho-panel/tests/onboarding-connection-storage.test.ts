import assert from "node:assert/strict"
import { test } from "node:test"
import {
  clearOnboardingSnapshot,
  EMPTY_ONBOARDING_SNAPSHOT,
  ONBOARDING_STORAGE_KEYS,
  persistOnboardingSnapshot,
  restoreOnboardingSnapshot,
  type ConnectionStorageBridge,
  type KeyValueStorage,
  type OnboardingSnapshot,
} from "../lib/onboarding-connection-storage"

class MemoryStorage implements KeyValueStorage {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

function createBridge(initial: OnboardingSnapshot | null = null): ConnectionStorageBridge {
  let saved = initial
  return {
    async get() {
      return { snapshot: saved ?? EMPTY_ONBOARDING_SNAPSHOT, persisted: saved !== null }
    },
    async set(snapshot) {
      saved = structuredClone(snapshot)
      return { snapshot: saved, persisted: true }
    },
    async clear() {
      saved = null
      return { snapshot: EMPTY_ONBOARDING_SNAPSHOT, persisted: false }
    },
  }
}

test("桌面加密桥优先恢复并在首次迁移成功后删除旧 localStorage 键", async () => {
  const storage = new MemoryStorage()
  storage.setItem(ONBOARDING_STORAGE_KEYS.serverSource, JSON.stringify({
    mode: "local",
    api: "http://127.0.0.1:8443",
    agentApi: "http://127.0.0.1:8443",
    key: "legacy-api-key",
  }))
  storage.setItem(ONBOARDING_STORAGE_KEYS.auth, JSON.stringify({ mode: "key", secret: "legacy-login" }))
  storage.setItem(ONBOARDING_STORAGE_KEYS.locked, "1")
  const bridge = createBridge()

  const restored = await restoreOnboardingSnapshot(bridge, storage)
  assert.deepEqual(restored.snapshot, {
    serverSource: {
      mode: "local",
      api: "http://127.0.0.1:8443",
      agentApi: "http://127.0.0.1:8443",
      key: "legacy-api-key",
    },
    auth: { mode: "key", secret: "legacy-login" },
    locked: true,
  })
  assert.equal(restored.hasLegacyData, true)
  assert.equal(storage.values.size, 0)
  assert.deepEqual(await bridge.get(), { snapshot: restored.snapshot, persisted: true })
})

test("已有桌面记录优先于当前 origin 的陈旧明文配置", async () => {
  const storage = new MemoryStorage()
  storage.setItem(ONBOARDING_STORAGE_KEYS.serverSource, JSON.stringify({
    mode: "cloud",
    api: "https://stale.example",
    key: "stale-key",
  }))
  const current: OnboardingSnapshot = {
    serverSource: { mode: "cloud", api: "https://current.example", key: "current-key" },
    auth: null,
    locked: false,
  }
  const restored = await restoreOnboardingSnapshot(createBridge(current), storage)
  assert.deepEqual(restored.snapshot, current)
  assert.equal(storage.getItem(ONBOARDING_STORAGE_KEYS.serverSource), null)
})

test("桌面加密读取错误时不回退或删除明文旧值", async () => {
  const storage = new MemoryStorage()
  storage.setItem(ONBOARDING_STORAGE_KEYS.serverSource, JSON.stringify({
    mode: "cloud",
    api: "https://legacy.example",
    key: "legacy-key",
  }))
  let writes = 0
  const bridge: ConnectionStorageBridge = {
    async get() { throw new Error("tampered ciphertext") },
    async set() { writes += 1; return { snapshot: EMPTY_ONBOARDING_SNAPSHOT, persisted: true } },
    async clear() { return { snapshot: EMPTY_ONBOARDING_SNAPSHOT, persisted: false } },
  }
  await assert.rejects(restoreOnboardingSnapshot(bridge, storage), /tampered ciphertext/)
  assert.equal(writes, 0)
  assert.equal(storage.getItem(ONBOARDING_STORAGE_KEYS.serverSource) !== null, true)
})

test("浏览器开发版保留 localStorage 恢复与保存回退", async () => {
  const storage = new MemoryStorage()
  const snapshot: OnboardingSnapshot = {
    serverSource: { mode: "cloud", api: "https://dev.example", key: "dev-key" },
    auth: { mode: "password", secret: "dev-password" },
    locked: true,
  }
  await persistOnboardingSnapshot(undefined, storage, snapshot)
  assert.deepEqual((await restoreOnboardingSnapshot(undefined, storage)).snapshot, snapshot)
  await clearOnboardingSnapshot(undefined, storage)
  assert.equal(storage.values.size, 0)
})

test("桌面迁移写入失败时保留旧值供下一次启动重试", async () => {
  const storage = new MemoryStorage()
  storage.setItem(ONBOARDING_STORAGE_KEYS.auth, JSON.stringify({ mode: "key", secret: "legacy-login" }))
  const bridge: ConnectionStorageBridge = {
    async get() { return { snapshot: EMPTY_ONBOARDING_SNAPSHOT, persisted: false } },
    async set() { throw new Error("DPAPI write failed") },
    async clear() { return { snapshot: EMPTY_ONBOARDING_SNAPSHOT, persisted: false } },
  }
  await assert.rejects(restoreOnboardingSnapshot(bridge, storage), /DPAPI write failed/)
  assert.equal(storage.getItem(ONBOARDING_STORAGE_KEYS.auth) !== null, true)
})
