import assert from "node:assert/strict"
import { test } from "node:test"
import {
  newerPanelInstallState, panelDownloadPercent, panelInstallActive, PANEL_INSTALL_LABELS,
  type PanelInstallState,
} from "../lib/panel-install-progress"

const state: PanelInstallState = {
  revision: 8, phase: "downloading", version: "0.2.7", downloadedBytes: 75, totalBytes: 100, error: null,
}

test("返回更新页以快照恢复实际字节，延迟快照和旧消息不能覆盖新状态", () => {
  const old = { ...state, revision: 7, downloadedBytes: 50 }
  assert.equal(newerPanelInstallState(null, state), state)
  assert.equal(newerPanelInstallState(state, old), state)
  assert.equal(newerPanelInstallState(state, { ...old, revision: 8 }), state)
  const retry = { ...state, revision: 9, phase: "retrying" as const, downloadedBytes: 0 }
  assert.equal(newerPanelInstallState(state, retry), retry)
})

test("下载百分比来自真实字节，准备和重试不显示虚构百分比", () => {
  assert.equal(panelDownloadPercent(state), 75)
  assert.equal(panelDownloadPercent({ ...state, downloadedBytes: 100 }), 100)
  assert.equal(panelDownloadPercent({ ...state, downloadedBytes: 200 }), 100)
  assert.equal(panelDownloadPercent({ ...state, phase: "preparing" }), null)
  assert.equal(panelDownloadPercent({ ...state, phase: "retrying", downloadedBytes: 0 }), null)
  assert.equal(panelDownloadPercent({ ...state, totalBytes: null }), null)
})

test("100% 下载后校验和安装期间继续忙碌，失败后恢复重试", () => {
  assert.ok(panelInstallActive({ ...state, downloadedBytes: 100 }))
  assert.ok(panelInstallActive({ ...state, phase: "verifying" }))
  assert.ok(panelInstallActive({ ...state, phase: "installing" }))
  assert.equal(panelInstallActive({ ...state, phase: "failed", error: "网络中断" }), false)
  assert.equal(panelInstallActive({ ...state, phase: "idle" }), false)
  assert.equal(panelInstallActive(null), false)
  assert.equal(PANEL_INSTALL_LABELS.verifying, "正在校验安装包")
  assert.equal(PANEL_INSTALL_LABELS.installing, "即将退出并安装")
})
