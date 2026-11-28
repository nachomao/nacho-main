import assert from "node:assert/strict"
import test from "node:test"
import { defaultSettings } from "../components/settings/settings-data"
import { emailTestBlockReason, getEmailAuthorizationUrl, isTrustedEmailService, readEmailStatus } from "../components/settings/email-settings"

const gmail = "https://accounts.google.com/o/oauth2/v2/auth?state=opaque"
const outlook = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=opaque"

test("邮件操作只走 HTTPS 或可信回环地址，不把远程 HTTP 主机误认成回环", () => {
  for (const url of ["https://mail.example.test:8443", "http://localhost:8443", "http://127.0.0.1:8443", "http://[::1]:8443"]) {
    assert.equal(isTrustedEmailService(url), true, url)
  }
  for (const url of ["http://127.example.test", "http://192.168.1.5", "http://127.0.0.1.example.test", "file:///settings", "https://user:pass@example.test", "garbage"]) {
    assert.equal(isTrustedEmailService(url), false, url)
  }
})

test("浏览器只导航到当前提供商的允许授权端点", () => {
  assert.equal(getEmailAuthorizationUrl("gmail", gmail), gmail)
  assert.equal(getEmailAuthorizationUrl("outlook", outlook), outlook)
  assert.equal(getEmailAuthorizationUrl("gmail", outlook), null)
  for (const url of ["http://accounts.google.com/o/oauth2/v2/auth", "https://accounts.google.com.evil.test/o/oauth2/v2/auth", "https://foo@accounts.google.com/o/oauth2/v2/auth", "https://accounts.google.com:3000/o/oauth2/v2/auth", "https://accounts.google.com/o/oauth2/v2/auth/extra", "javascript:alert(0)", "https://accounts.google.com/o/oauth2/v2/auth#abc"]) {
    assert.equal(getEmailAuthorizationUrl("gmail", url), null, url)
  }
  assert.equal(getEmailAuthorizationUrl("outlook", "https://login.microsoftonline.com/evil/oauth2/v2.0/authorize"), null)
})

const connected = { available: true, state: "connected", account: "sender@example.test" } as const
const status = { configurable: true, reason: null, hasPassword: true, providers: { gmail: connected, outlook: connected }, attempt: null }

test("只接受完整类型明确的能力响应，不把旧服务的空对象当作邮件支持", () => {
  assert.equal(readEmailStatus({}), null)
  assert.equal(readEmailStatus({ ...status, hasPassword: "true" }), null)
  assert.equal(readEmailStatus({ ...status, providers: { ...status.providers, gmail: { ...connected, state: "unknown" } } }), null)
  assert.deepEqual(readEmailStatus(status), status)
  const metadata = { id: "testing", state: "expired", message: null } as const
  assert.deepEqual(readEmailStatus({ ...status, providers: { ...status.providers, gmail: { ...connected, accessToken: "never-retain" } }, attempt: { ...metadata, stateSecret: "never-retain" } }), { ...status, attempt: metadata })
})

test("发送测试邮件只使用已保存、已就绪的配置，告警总开关不影响测试", () => {
  const smtp = { ...defaultSettings.email, enabled: false, host: "smtp.example.test", username: "sender@example.test", from: "sender@example.test", to: "alert@example.test" }
  assert.equal(emailTestBlockReason(smtp, status, false), null)
  assert.match(emailTestBlockReason(smtp, status, true) ?? "", /保存/)
  assert.match(emailTestBlockReason({ ...smtp, encryption: "none" }, status, false) ?? "", /加密/)
  assert.match(emailTestBlockReason(smtp, { ...status, hasPassword: false }, false) ?? "", /密码/)
  assert.equal(emailTestBlockReason({ ...smtp, mode: "gmail", host: "" }, status, false), null)
  const reconnect = { ...connected, state: "reauthorize" } as const
  assert.match(emailTestBlockReason({ ...smtp, mode: "gmail" }, { ...status, providers: { ...status.providers, gmail: reconnect } }, false) ?? "", /授权/)
})
