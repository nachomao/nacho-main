import assert from "node:assert/strict"
import test from "node:test"
import { defaultSettings } from "../components/settings/settings-data"
import { applyRemoteSettings } from "../components/settings/settings-remote"

test("非对象响应保留完整本地默认值", () => {
  assert.deepEqual(applyRemoteSettings(null, defaultSettings), defaultSettings)
  assert.deepEqual(applyRemoteSettings("invalid", defaultSettings), defaultSettings)
  assert.deepEqual(applyRemoteSettings([], defaultSettings), defaultSettings)
})

test("完整响应覆盖默认值并保留 false 与 0", () => {
  const remote = {
    general: { ...defaultSettings.general, concurrency: 8, commandTimeout: 240, autoCleanTasks: false },
    email: { ...defaultSettings.email, enabled: false, port: 465, password: "smtp-secret" },
    conditions: { ...defaultSettings.conditions, cpuAlert: false, cpuThreshold: 70, quietHours: true },
    security: { ...defaultSettings.security, openEnrollment: false, sessionTimeout: 15 },
  }
  const merged = applyRemoteSettings(remote, defaultSettings)
  assert.equal(merged.general.concurrency, 8)
  assert.equal(merged.general.commandTimeout, 240)
  assert.equal(merged.general.autoCleanTasks, false)
  assert.equal(merged.email.enabled, false)
  assert.equal(merged.email.port, 465)
  assert.equal(merged.email.password, "smtp-secret")
  assert.equal(merged.conditions.cpuAlert, false)
  assert.equal(merged.conditions.cpuThreshold, 70)
  assert.equal(merged.conditions.quietHours, true)
  assert.equal(merged.security.openEnrollment, false)
  assert.equal(merged.security.sessionTimeout, 15)
})

test("部分响应按字段合并，缺失或类型不符的字段回退本地值", () => {
  const remote = {
    general: { concurrency: 6, commandTimeout: "240" as unknown, unknownFutureFlag: true },
    conditions: { diskThreshold: 75 },
  }
  const merged = applyRemoteSettings(remote, defaultSettings)
  assert.equal(merged.general.concurrency, 6)
  assert.equal(merged.general.commandTimeout, defaultSettings.general.commandTimeout)
  assert.equal(merged.general.offlineThreshold, defaultSettings.general.offlineThreshold)
  assert.equal(merged.conditions.diskThreshold, 75)
  assert.equal(merged.conditions.cpuThreshold, defaultSettings.conditions.cpuThreshold)
  assert.equal(merged.email.host, defaultSettings.email.host)
  assert.equal(merged.security.openEnrollment, defaultSettings.security.openEnrollment)
  assert.equal("unknownFutureFlag" in merged.general, false)
})

test("非法值与非法加密方式不会进入面板状态", () => {
  const remote = {
    general: { concurrency: Number.NaN, channelTimeout: -5 },
    email: { encryption: "starttls" },
    security: { openEnrollment: "false" },
  }
  const merged = applyRemoteSettings(remote, defaultSettings)
  assert.equal(merged.general.concurrency, defaultSettings.general.concurrency)
  assert.equal(merged.general.channelTimeout, defaultSettings.general.channelTimeout)
  assert.equal(merged.email.encryption, defaultSettings.email.encryption)
  assert.equal(merged.security.openEnrollment, defaultSettings.security.openEnrollment)
})
