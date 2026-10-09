const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const test = require("node:test")

const desktopDir = path.resolve(__dirname, "..")
const electronPath = path.join(desktopDir, "node_modules", "electron", "dist", "electron.exe")

test("sandbox preload exposes both desktop bridges", () => {
  assert.ok(fs.existsSync(electronPath), `找不到 Electron：${electronPath}`)
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-preload-"))
  const mainPath = path.join(tempDir, "main.cjs")
  fs.writeFileSync(mainPath, `
    const { app, BrowserWindow } = require("electron")
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
      const result = await window.webContents.executeJavaScript(
        "JSON.stringify({ updates: typeof window.nachoUpdates, windowBridge: typeof window.nachoWindow, connectionBridge: typeof window.nachoConnection, connectionGet: typeof window.nachoConnection?.get, connectionSet: typeof window.nachoConnection?.set, connectionClear: typeof window.nachoConnection?.clear })",
      )
      process.stdout.write(result)
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
  })
})
