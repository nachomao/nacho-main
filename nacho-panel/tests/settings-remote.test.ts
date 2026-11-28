import assert from "node:assert/strict"
import test from "node:test"
import { defaultSettings } from "../components/settings/settings-data"
import { applyRemoteSettings, buildSettingsUpdate, syncSavedEmail } from "../components/settings/settings-remote"

test("非对象响应保留完整本地默认值", () => {
  assert.deepEqual(applyRemoteSettings(null, defaultSettings), defaultSettings)
  assert.deepEqual(applyRemoteSettings("invalid", defaultSettings), defaultSettings)
  assert.deepEqual(applyRemoteSettings([], defaultSettings), defaultSettings)
})

test("完整响应覆盖默认值并保留 false 与 0", () => {
  const remote = {
    general: { ...defaultSettings.general, concurrency: 8, commandTimeout: 240, autoCleanTasks: false },
    email: { ...defaultSettings.email, enabled: false, mode: "gmail", port: 465, password: "old-server-secret" },
    conditions: { ...defaultSettings.conditions, cpuAlert: false, cpuThreshold: 70, quietHours: true },
    security: { ...defaultSettings.security, openEnrollment: false, sessionTimeout: 15 },
  }
  const merged = applyRemoteSettings(remote, defaultSettings)
  assert.equal(merged.general.concurrency, 8)
  assert.equal(merged.general.commandTimeout, 240)
  assert.equal(merged.general.autoCleanTasks, false)
  assert.equal(merged.email.enabled, false)
  assert.equal(merged.email.port, 465)
  assert.equal(merged.email.mode, "gmail")
  assert.equal(merged.email.password, "")
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
    email: { encryption: "starttls", mode: "unknown" },
    security: { openEnrollment: "false" },
  }
  const merged = applyRemoteSettings(remote, defaultSettings)
  assert.equal(merged.general.concurrency, defaultSettings.general.concurrency)
  assert.equal(merged.general.channelTimeout, defaultSettings.general.channelTimeout)
  assert.equal(merged.email.encryption, defaultSettings.email.encryption)
  assert.equal(merged.email.mode, "smtp")
  assert.equal(merged.security.openEnrollment, defaultSettings.security.openEnrollment)
})

test("旧服务、未确认连接与非邮件修改都不会提交 email 分组", () => {
  const local = { ...defaultSettings, email: { ...defaultSettings.email, password: "draft" } }
  assert.equal("email" in buildSettingsUpdate(local, defaultSettings, false), false)
  assert.equal("email" in buildSettingsUpdate(defaultSettings, defaultSettings, true), false)
  assert.deepEqual(
    buildSettingsUpdate(local, defaultSettings, false).conditions,
    defaultSettings.conditions,
  )
})

test("SMTP 只提交明确输入的密码；切换 OAuth 不覆盖任何 SMTP 配置", () => {
  const draft = { ...defaultSettings, email: { ...defaultSettings.email, to: "alert@example.test", password: "draft" } }
  assert.equal(buildSettingsUpdate(draft, defaultSettings, true).email?.password, "draft")
  const withoutPassword = { ...draft, email: { ...draft.email, password: "" } }
  assert.equal("password" in (buildSettingsUpdate(withoutPassword, defaultSettings, true).email ?? {}), false)
  const oauth = { ...draft, email: { ...draft.email, mode: "outlook" as const } }
  assert.deepEqual(buildSettingsUpdate(oauth, defaultSettings, true).email, { mode: "outlook", to: "alert@example.test" })
})

test("OAuth 终态同步新的已保存状态，不丢弃表单改动或把旧告警开关写回", () => {
  const saved = { ...defaultSettings.email, mode: "gmail" as const, enabled: true, to: "old@example.test" }
  const draft = { ...saved, to: "new@example.test" }
  const remote = { ...saved, enabled: false }
  assert.deepEqual(syncSavedEmail(draft, saved, remote), { ...remote, to: "new@example.test" })
  assert.deepEqual(buildSettingsUpdate({ ...defaultSettings, email: draft }, { ...defaultSettings, email: saved }, true).email, { to: "new@example.test" })
})

test("缺失邮件字段也不把上一次的密码留在响应合并结果", () => {
  const draft = { ...defaultSettings, email: { ...defaultSettings.email, password: "draft" } }
  assert.equal(applyRemoteSettings({}, draft).email.password, "")
  assert.equal(applyRemoteSettings(null, draft).email.password, "")
})
