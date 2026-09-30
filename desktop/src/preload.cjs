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
  onMaximizedChange(callback) {
    if (typeof callback !== "function") return undefined
    const listener = (_event, maximized) => callback(Boolean(maximized))
    ipcRenderer.on("window:maximized-change", listener)
    return () => ipcRenderer.removeListener("window:maximized-change", listener)
  },
})

contextBridge.exposeInMainWorld("nachoUpdates", {
  version: require("./package.json").version,
  check(force = false) { return ipcRenderer.invoke("updates:check", Boolean(force)) },
  setChannel(channel) { return ipcRenderer.invoke("updates:set-channel", channel) },
  installPanel() { return ipcRenderer.invoke("updates:install-panel") },
})
