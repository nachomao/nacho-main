import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ClientCard } from "@/components/clients/client-card"
import type { Client } from "@/components/clients/client-data"
import { ClientManagementPanel } from "@/components/clients/extensions-panel"
import { resolveOsBrand } from "@/components/clients/os-logos"

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
  assert.match(html, /单机模式 · 测试计算姬 · 11 项管理功能/)
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

test("按上报的具体系统名解析对应发行版标识", () => {
  // Windows：显式版本号与内部版本号都应判定为 Windows 11
  assert.equal(resolveOsBrand("Windows", "Windows 11 专业版 24H2").label, "Windows 11 专业版 24H2")
  assert.equal(resolveOsBrand("Windows", "Microsoft Windows 10.0.22631").path, resolveOsBrand("Windows", "Windows 11").path)
  // Windows 10 应使用旧版四窗格旗标，与 Windows 11 的方块标识不同
  assert.notEqual(resolveOsBrand("Windows", "Windows 10 企业版").path, resolveOsBrand("Windows", "Windows 11").path)

  // Linux 发行版按关键字匹配，且各自 logo 互不相同
  const distros: [string, string][] = [
    ["Ubuntu 24.04 LTS", "Ubuntu"],
    ["debian", "Debian"],
    ["CentOS Stream 9", "CentOS"],
    ["kali", "Kali Linux"],
    ["fedora", "Fedora"],
    ["arch", "Arch Linux"],
  ]
  const paths = new Set<string>()
  for (const [osName, expected] of distros) {
    const brand = resolveOsBrand("Linux", osName)
    assert.equal(brand.label, osName)
    assert.equal(resolveOsBrand("Linux", expected).label, expected)
    paths.add(brand.path)
  }
  assert.equal(paths.size, distros.length)

  // 未上报或无法识别时回落到通用标识
  assert.equal(resolveOsBrand("Linux", null).label, "Linux")
  assert.equal(resolveOsBrand("Linux", "some-unknown-distro").path, resolveOsBrand("Linux", "").path)
})

test("客户端卡片渲染发行版标识而非通用图标", () => {
  const ubuntuHtml = renderToStaticMarkup(
    createElement(ClientCard, { client: { ...windowsClient, os: "Linux", osName: "Ubuntu 24.04 LTS" } }),
  )
  assert.match(ubuntuHtml, /Ubuntu 24\.04 LTS/)
  assert.match(ubuntuHtml, new RegExp(escapeRegExp(resolveOsBrand("Linux", "ubuntu").path.slice(0, 40))))
})

test("Windows 11 客户端卡片渲染具体版本与等宽四窗格标识", () => {
  const osName = "Windows 11 Pro 25H2"
  const win11Brand = resolveOsBrand("Windows", osName)
  const legacyBrand = resolveOsBrand("Windows", "Windows 10 Pro 22H2")
  const html = renderToStaticMarkup(
    createElement(ClientCard, { client: { ...windowsClient, osName, version: "1.1.3" } }),
  )

  assert.match(html, /Windows 11 Pro 25H2/)
  assert.match(html, new RegExp(escapeRegExp(win11Brand.path)))
  assert.doesNotMatch(html, new RegExp(escapeRegExp(legacyBrand.path)))
})

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
