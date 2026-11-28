const CHANNEL = "email-oauth:open-browser"

function allowedAuthorizationUrl(provider, value) {
  if (typeof value !== "string" || !value.startsWith("https://") || /[\s\\]/.test(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return null
    if (provider === "gmail" && url.hostname === "accounts.google.com" && url.pathname === "/o/oauth2/v2/auth") return url.href
    if (provider === "outlook" && url.hostname === "login.microsoftonline.com" && url.pathname === "/common/oauth2/v2.0/authorize") return url.href
  } catch {}
  return null
}

function registerEmailOAuthBrowserIpc({ ipcMain, getMainWindow, getPanelOrigin, openExternal }) {
  ipcMain.handle(CHANNEL, async (event, provider, value) => {
    const window = getMainWindow()
    const frame = event.senderFrame
    const panelOrigin = getPanelOrigin()
    if (!window || window.isDestroyed?.() || event.sender !== window.webContents ||
      !frame || frame !== window.webContents.mainFrame || !panelOrigin) {
      throw new Error("面板窗口来源无效")
    }
    let frameUrl
    try { frameUrl = new URL(frame.url) } catch {}
    if (frameUrl?.protocol !== "http:" || frameUrl.origin !== panelOrigin) throw new Error("面板窗口来源无效")

    const url = allowedAuthorizationUrl(provider, value)
    if (!url) throw new Error("邮箱授权地址不受信任")
    await openExternal(url)
  })
}

module.exports = { registerEmailOAuthBrowserIpc }
