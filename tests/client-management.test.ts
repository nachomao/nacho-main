import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ClientCard } from "@/components/clients/client-card"
import type { Client } from "@/components/clients/client-data"
import { ClientManagementPanel } from "@/components/clients/extensions-panel"

const windowsClient: Client = {
  id: "client-1",
  name: "测试计算姬",
  hostname: "TEST-HOST",
  ip: "127.0.0.1",
  os: "Windows",
  status: "online",
  tags: [],
  group: "默认分组",
  version: "1.1.1",
  lastSeen: Date.now(),
  registeredAt: Date.now(),
  metrics: null,
  connected: true,
}

test("客户端卡片提供直接管理入口", () => {
  const html = renderToStaticMarkup(
    createElement(ClientCard, {
      client: windowsClient,
      onManage: () => undefined,
      onDelete: () => undefined,
    }),
  )

  assert.match(html, /aria-label="管理客户端 测试计算姬"/)
  assert.match(html, />管理<\/button>/)
})

test("单机管理页展示 Windows 客户端的全部管理项", () => {
  const html = renderToStaticMarkup(
    createElement(ClientManagementPanel, {
      client: windowsClient,
      onBack: () => undefined,
    }),
  )

  assert.match(html, /客户端管理/)
  assert.match(html, /测试计算姬 · TEST-HOST · 11 项管理功能/)
  assert.match(html, /aria-label="返回客户端列表"/)

  for (const label of [
    "服务控制",
    "进程终止",
    "系统重启",
    "日志采集",
    "批量安装",
    "文件下发",
    "命令执行",
    "消息推送",
    "用户管理",
    "打开网页",
    "注册表",
  ]) {
    assert.match(html, new RegExp(`>${label}<`))
  }
})
