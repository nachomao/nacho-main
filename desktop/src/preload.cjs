const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("nachoWindow", {
  minimize() {
    ipcRenderer.send("window:minimize")
  },
  toggleMaximize() {
    return ipcRenderer.invoke("window:toggle-maximize")
  },
  close() {
    ipcRenderer.send("window:close")
  },
  isMaximized() {
    return ipcRenderer.invoke("window:is-maximized")
  },
  beginResize(edges) {
    ipcRenderer.send("window:resize-begin", Array.isArray(edges) ? edges : [])
  },
  resizeTo(dx, dy) {
    ipcRenderer.send("window:resize-apply", Number(dx) || 0, Number(dy) || 0)
  },
  endResize() {
    ipcRenderer.send("window:resize-end")
  },
  onMaximizedChange(callback) {
    if (typeof callback !== "function") return undefined
    const listener = (_event, maximized) => callback(Boolean(maximized))
    ipcRenderer.on("window:maximized-change", listener)
    return () => ipcRenderer.removeListener("window:maximized-change", listener)
  },
})

contextBridge.exposeInMainWorld("nachoUpdates", {
  check(force = false) { return ipcRenderer.invoke("updates:check", Boolean(force)) },
  installPanel(target) { return ipcRenderer.invoke("updates:install-panel", target) },
  installLocalServer(target) { return ipcRenderer.invoke("updates:install-local", target) },
  getPanelInstallState() { return ipcRenderer.invoke("updates:panel-install-state") },
  onPanelInstallProgress(callback) {
    if (typeof callback !== "function") return undefined
    const listener = (_event, state) => callback(state)
    ipcRenderer.on("updates:panel-install-progress", listener)
    return () => ipcRenderer.removeListener("updates:panel-install-progress", listener)
  },
  transferRelease(kind, target) {
    return ipcRenderer.invoke("updates:transfer", kind, target)
  },
  onTransferProgress(callback) {
    if (typeof callback !== "function") return undefined
    const listener = (_event, value) => callback(value)
    ipcRenderer.on("updates:transfer-progress", listener)
    return () => ipcRenderer.removeListener("updates:transfer-progress", listener)
  },
  onAvailable(callback) {
    if (typeof callback !== "function") return undefined
    const listener = (_event, result) => callback(result)
    ipcRenderer.on("updates:available", listener)
    return () => ipcRenderer.removeListener("updates:available", listener)
  },
  readSettings() { return ipcRenderer.invoke("updates:settings") },
  select(profileId, channel) { return ipcRenderer.invoke("updates:select", profileId, channel) },
  trustProfile(profileJson, fingerprint) { return ipcRenderer.invoke("updates:trust", profileJson, fingerprint) },
  removeProfile(id) { return ipcRenderer.invoke("updates:remove-profile", id) },
})

contextBridge.exposeInMainWorld("nachoConnection", {
  get() { return ipcRenderer.invoke("connection:get") },
  set(snapshot) { return ipcRenderer.invoke("connection:set", snapshot) },
  clear() { return ipcRenderer.invoke("connection:clear") },
  retry() { return ipcRenderer.invoke("connection:retry") },
  reinitialize(confirmation) { return ipcRenderer.invoke("connection:reinitialize", confirmation) },
})

contextBridge.exposeInMainWorld("nachoEmailOAuth", {
  openBrowser(provider, authorizationUrl) { return ipcRenderer.invoke("email-oauth:open-browser", provider, authorizationUrl) },
})
