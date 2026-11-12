import assert from "node:assert/strict"
import test from "node:test"
import {
  UPDATE_SOURCE_STATE_LABELS, serverUpdateIssue, updateSourceServerText, updateSourceState,
} from "../lib/product-update-status"
import { formatReleaseVersion } from "../lib/panel-version"

test("更新类型来自各组件发布信息，并可显示服务器新增的类型", () => {
  assert.equal(formatReleaseVersion("0.2.4", "beta"), "0.2.4 Beta")
  assert.equal(formatReleaseVersion("1.1.24", "stable"), "1.1.24 Stable")
  assert.equal(formatReleaseVersion("0.2.5", "preview"), "0.2.5 preview")
})

test("更新源状态区分面板本地、服务端 env、面板保存与不支持", () => {
  assert.equal(updateSourceState(null), "disconnected")
  assert.equal(updateSourceState({ capabilities: {} }), "unsupported")
  assert.equal(updateSourceState({ capabilities: { updateSourceManagement: true }, updateSourceOrigin: "panel" }), "server-panel")
  assert.equal(updateSourceState({ capabilities: { updateSourceManagement: true }, updateSourceOrigin: "env" }), "server-env")
  assert.equal(updateSourceState({ capabilities: { updateSourceManagement: true }, updateSourceOrigin: "none" }), "panel-local")
  assert.equal(UPDATE_SOURCE_STATE_LABELS["server-panel"], "面板已保存")
})

test("服务端更新源文案使用 runtime-info 的真实来源", () => {
  assert.equal(updateSourceServerText(null), "未连接")
  assert.equal(updateSourceServerText({ capabilities: {} }), "服务端 1.2.1 起支持面板管理")
  assert.equal(updateSourceServerText({
    capabilities: { updateSourceManagement: true }, updateSourceOrigin: "panel", updateSource: "https://panel.example.test",
  }), "https://panel.example.test")
  assert.equal(updateSourceServerText({
    capabilities: { updateSourceManagement: true }, updateSourceOrigin: "env", updateSource: "https://env.example.test",
  }), "https://env.example.test（来自 .env）")
  assert.equal(updateSourceServerText({
    capabilities: { updateSourceManagement: true }, updateSourceOrigin: "none", updateSource: null,
  }), "未配置")
})

test("更新源缺失、旧协议与旧执行器分别提示；Agent 准备不依赖 Linux 执行器", () => {
  assert.match(serverUpdateIssue({ updateSourceConfigured: false }, false)!, /未配置更新源/)
  assert.match(serverUpdateIssue({
    updateSourceConfigured: false, capabilities: { updateSourceManagement: true },
  }, false)!, /“更新服务器”/)
  assert.match(serverUpdateIssue({
    updateSourceConfigured: false, capabilities: {},
  }, false)!, /1\.2\.1/)
  assert.match(serverUpdateIssue({}, false)!, /旧更新协议/)
  const runtime = { updateMode: "recommended", updateSourceConfigured: true, updateExecutorProtocol: 3 }
  assert.match(serverUpdateIssue(runtime, false)!, /执行器需要迁移/)
  assert.equal(serverUpdateIssue(runtime, false, "agent"), null)
  assert.equal(serverUpdateIssue({ ...runtime, updateExecutorProtocol: 4 }, false), null)
  assert.equal(serverUpdateIssue({}, true), null, "本机管理器可以独立迁移旧版服务")
  assert.match(serverUpdateIssue({}, true, "agent")!, /旧更新协议/)
})
