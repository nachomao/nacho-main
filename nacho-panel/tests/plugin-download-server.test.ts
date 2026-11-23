import assert from "node:assert/strict"
import { test } from "node:test"
import {
  PLUGIN_DOWNLOAD_SERVER_STORAGE_KEY,
  normalizePluginDownloadServer,
  readPluginDownloadServer,
  writePluginDownloadServer,
} from "../lib/plugin-download-server"

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

test("写入后可以读回，刷新/重启面板后地址仍在", () => {
  const storage = memoryStorage()
  assert.equal(writePluginDownloadServer(storage, " http://repo.example.com:8443 "), "http://repo.example.com:8443")
  assert.equal(storage.data.get(PLUGIN_DOWNLOAD_SERVER_STORAGE_KEY), "http://repo.example.com:8443")
  const reopened = memoryStorage(Object.fromEntries(storage.data))
  assert.equal(readPluginDownloadServer(reopened), "http://repo.example.com:8443")
})

test("地址做去空白规范化，空串表示清空但保留键", () => {
  const storage = memoryStorage()
  assert.equal(writePluginDownloadServer(storage, "   "), "")
  assert.equal(storage.data.get(PLUGIN_DOWNLOAD_SERVER_STORAGE_KEY), "")
  assert.equal(readPluginDownloadServer(storage), "")
  assert.equal(normalizePluginDownloadServer(undefined), "")
  assert.equal(normalizePluginDownloadServer(123), "")
})

test("没有可用存储时不抛错，退回内存值", () => {
  assert.equal(readPluginDownloadServer(null), "")
  assert.equal(readPluginDownloadServer(undefined), "")
  assert.equal(writePluginDownloadServer(null, "http://repo.example.com"), "http://repo.example.com")
})

test("存储读写抛错（隐私模式/配额不足）时不冒泡", () => {
  const broken = {
    getItem: () => {
      throw new Error("denied")
    },
    setItem: () => {
      throw new Error("quota")
    },
  }
  assert.equal(readPluginDownloadServer(broken), "")
  assert.equal(writePluginDownloadServer(broken, "http://repo.example.com"), "http://repo.example.com")
})
