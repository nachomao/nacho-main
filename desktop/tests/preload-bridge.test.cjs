const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const test = require("node:test")

const desktopDir = path.resolve(__dirname, "..")
const electronPath = path.join(desktopDir, "node_modules", "electron", "dist", "electron.exe")

test("sandbox preload exposes desktop bridges and panel install state with removable progress listeners", (context) => {
  assert.ok(fs.existsSync(electronPath), `找不到 Electron：${electronPath}`)
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-preload-"))
  context.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const mainPath = path.join(tempDir, "main.cjs")
  fs.writeFileSync(mainPath, `
    const { app, BrowserWindow, ipcMain } = require("electron")
    const path = require("node:path")
    app.setPath("userData", path.join(__dirname, "user-data"))
    app.whenReady().then(async () => {
      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: process.env.NACHO_PRELOAD_PATH,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
      window.webContents.on("preload-error", (_event, preloadPath, error) => {
        console.error(\`preload-error \${preloadPath}: \${error.message}\`)
      })
      await window.loadURL("data:text/html,<title>bridge</title>")
      const state = { revision: 4, phase: "downloading", version: "0.2.7",
        downloadedBytes: 50, totalBytes: 100, error: null }
      ipcMain.handle("updates:panel-install-state", (event) => {
        if (event.sender !== window.webContents) throw new Error("窗口来源无效")
        return state
      })
      const result = JSON.parse(await window.webContents.executeJavaScript(
        "JSON.stringify({ updates: typeof window.nachoUpdates, windowBridge: typeof window.nachoWindow, connectionBridge: typeof window.nachoConnection, connectionGet: typeof window.nachoConnection?.get, connectionSet: typeof window.nachoConnection?.set, connectionClear: typeof window.nachoConnection?.clear, connectionRetry: typeof window.nachoConnection?.retry, connectionReinitialize: typeof window.nachoConnection?.reinitialize })",
      ))
      await window.webContents.executeJavaScript(
        "window.progressEvents=[]; window.stopProgress=window.nachoUpdates.onPanelInstallProgress(state=>window.progressEvents.push(state)); true",
      )
      window.webContents.send("updates:panel-install-progress", state)
      result.installProgress = JSON.parse(await window.webContents.executeJavaScript(
        "(async()=>JSON.stringify({snapshot:await window.nachoUpdates.getPanelInstallState(),events:window.progressEvents}))()",
      ))
      await window.webContents.executeJavaScript("window.stopProgress(); true")
      window.webContents.send("updates:panel-install-progress", { ...state, revision: 5 })
      result.eventsAfterUnsubscribe = await window.webContents.executeJavaScript("window.progressEvents.length")
      process.stdout.write(JSON.stringify(result))
      app.quit()
    }).catch((error) => {
      console.error(error.stack || error.message)
      app.exit(1)
    })
  `, "utf8")
  const result = spawnSync(electronPath, [mainPath], {
    env: { ...process.env, NACHO_PRELOAD_PATH: path.join(desktopDir, "app", "preload.cjs") },
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    updates: "object",
    windowBridge: "object",
    connectionBridge: "object",
    connectionGet: "function",
    connectionSet: "function",
    connectionClear: "function",
    connectionRetry: "function",
    connectionReinitialize: "function",
    installProgress: {
      snapshot: { revision: 4, phase: "downloading", version: "0.2.7", downloadedBytes: 50, totalBytes: 100, error: null },
      events: [{ revision: 4, phase: "downloading", version: "0.2.7", downloadedBytes: 50, totalBytes: 100, error: null }],
    },
    eventsAfterUnsubscribe: 1,
  })
})
