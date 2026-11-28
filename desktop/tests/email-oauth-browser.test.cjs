const assert = require("node:assert/strict")
const test = require("node:test")
const { registerEmailOAuthBrowserIpc } = require("../src/email-oauth-browser.cjs")

const GMAIL = "https://accounts.google.com/o/oauth2/v2/auth?state=opaque"
const OUTLOOK = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=opaque"

function makeFixture() {
  const mainFrame = { url: "http://127.0.0.1:43119/?tab=notifications" }
  const sender = { mainFrame }
  const opened = []
  let invoke
  registerEmailOAuthBrowserIpc({
    ipcMain: { handle(channel, handler) { assert.equal(channel, "email-oauth:open-browser"); invoke = handler } },
    getMainWindow: () => ({ webContents: sender }),
    getPanelOrigin: () => "http://127.0.0.1:43119",
    openExternal: async (url) => { opened.push(url) },
  })
  return { invoke, opened, event: { sender, senderFrame: mainFrame } }
}

test("OAuth IPC 只从已知主窗口的可信顶级文档启动允许的系统浏览器页面", async () => {
  const { invoke, opened, event } = makeFixture()
  await invoke(event, "gmail", GMAIL)
  await invoke(event, "outlook", OUTLOOK)
  assert.deepEqual(opened, [GMAIL, OUTLOOK])
  await assert.rejects(async () => invoke({ ...event, sender: { mainFrame: event.senderFrame } }, "gmail", GMAIL), /来源/)
  await assert.rejects(async () => invoke({ ...event, senderFrame: { ...event.senderFrame } }, "gmail", GMAIL), /来源/)
  await assert.rejects(async () => invoke({ ...event, senderFrame: null }, "gmail", GMAIL), /来源/)
  event.senderFrame.url = "https://untrusted.example.test/"
  await assert.rejects(async () => invoke(event, "gmail", GMAIL), /来源/)
  event.senderFrame.url = "http://127.0.0.1:43120/"
  await assert.rejects(async () => invoke(event, "gmail", GMAIL), /来源/)
  event.senderFrame.url = "blob:http://127.0.0.1:43119/opaque"
  await assert.rejects(async () => invoke(event, "gmail", GMAIL), /来源/)
  assert.deepEqual(opened, [GMAIL, OUTLOOK])
})

test("系统浏览器入口拒绝其余协议、端口、路径、提供商和伪装域名", async () => {
  const { invoke, opened, event } = makeFixture()
  const rejected = [
    ["gmail", OUTLOOK], ["smtp", GMAIL], ["gmail", "mailto:example@domain.test"], ["gmail", "file:///C:/Windows/"],
    ["gmail", "https://accounts.google.com:456/o/oauth2/v2/auth"], ["gmail", "https://accounts.google.com.test/o/oauth2/v2/auth"],
    ["gmail", "https://accounts.google.com.test@accounts.google.com/o/oauth2/v2/auth"],
    ["gmail", "https://accounts.google.com/o/oauth2/v2/auth/other"], ["outlook", "https://login.microsoftonline.com/evil/oauth2/v2.0/authorize"],
    ["outlook", "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize"],
  ]
  for (const [provider, url] of rejected) await assert.rejects(async () => invoke(event, provider, url), /授权地址/)
  assert.deepEqual(opened, [])
})
