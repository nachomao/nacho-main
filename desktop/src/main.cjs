const { app, BrowserWindow, dialog, ipcMain, safeStorage, utilityProcess } = require("electron")
const http = require("node:http")
const net = require("node:net")
const path = require("node:path")
const fs = require("node:fs")
if (!process.env.NACHO_UPDATE_ORIGIN) {
  const builtInSource = path.join(__dirname, "update-source.json")
  if (fs.existsSync(builtInSource)) {
    const value = JSON.parse(fs.readFileSync(builtInSource, "utf8")).origin
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(value)) throw new Error("内置更新服务器地址无效")
    process.env.NACHO_UPDATE_ORIGIN = value
  }
}
const { createUpdater } = require("./updates.cjs")
const { createConnectionStore, registerConnectionIpc } = require("./connection-store.cjs")
const { configureConnectionContext } = require("./connection-context.cjs")
const { createCredentialProtector } = require("./credential-protector.cjs")

// 必须在 app.ready 及 safeStorage 初始化之前固定 profile，避免不同启动方式共用密文却使用不同密钥。
const connectionPaths = configureConnectionContext(app)

let mainWindow = null
let connectionStore = null
let panelProcess = null
let panelPort = null
let panelProcessExited = true
let isQuitting = false
const updates = createUpdater(app)

function log(message, error) {
  const detail = error instanceof Error ? error.stack || error.message : error ? String(error) : ""
  const line = `[${new Date().toISOString()}] ${message}${detail ? `\n${detail}` : ""}\n`
  try {
    fs.appendFileSync(path.join(app.getPath("temp"), "nacho-panel-desktop.log"), line, "utf8")
  } catch {}
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.unref()
    probe.once("error", reject)
    probe.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = probe.address()
      const port = typeof address === "object" && address ? address.port : null
      probe.close((error) => {
        if (error) reject(error)
        else if (!port) reject(new Error("无法分配面板端口"))
        else resolve(port)
      })
    })
  })
}

function requestPanel(pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: "127.0.0.1",
        port: panelPort,
        path: pathname,
        timeout: 1000,
      },
      (response) => {
        response.resume()
        response.once("end", () => resolve(response.statusCode || 500))
      },
    )
    request.once("error", reject)
    request.once("timeout", () => request.destroy(new Error("面板请求超时")))
  })
}

async function waitForPanel() {
  const deadline = Date.now() + 30_000
  let lastError = null
  while (Date.now() < deadline) {
    if (panelProcess && panelProcessExited) {
      throw new Error("面板服务提前退出")
    }
    try {
      const statusCode = await requestPanel("/")
      if (statusCode >= 200 && statusCode < 500) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`面板服务启动超时：${lastError instanceof Error ? lastError.message : "未知错误"}`)
}

function killPanelProcess() {
  if (!panelProcess || panelProcessExited) return Promise.resolve()
  const child = panelProcess
  panelProcess = null

  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    child.once("exit", finish)
    child.kill()
    setTimeout(finish, 2000).unref()
  })
}

async function startPanelServer() {
  panelPort = await getFreePort()
  const panelDir = app.isPackaged
    ? path.join(process.resourcesPath, "panel")
    : path.join(__dirname, "panel")
  const panelDependenciesDir = app.isPackaged
    ? path.join(process.resourcesPath, "panel-deps")
    : path.join(__dirname, "panel-deps")
  const serverEntry = path.join(panelDir, "panel-runner.cjs")
  log(`启动面板服务：${serverEntry} port=${panelPort}`)

  panelProcess = utilityProcess.fork(serverEntry, [], {
    cwd: panelDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(panelPort),
      NODE_PATH: [panelDependenciesDir, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
      NACHO_PANEL_SETTINGS_PATH: process.env.NACHO_PANEL_SETTINGS_PATH || path.join(connectionPaths.dataDirectory, "panel-settings.json"),
    },
    stdio: "pipe",
  })
  panelProcessExited = false
  log(`面板服务 PID=${panelProcess.pid}`)

  let errorOutput = ""
  panelProcess.stderr?.on("data", (chunk) => {
    errorOutput += chunk.toString()
    if (errorOutput.length > 8_000) errorOutput = errorOutput.slice(-8_000)
  })
  panelProcess.once("error", (error) => {
    log("面板服务进程错误", error)
    errorOutput += `\n${error.stack || error.message}`
  })
  panelProcess.once("exit", (code, signal) => {
    panelProcessExited = true
    log(`面板服务退出 code=${code} signal=${signal}`, errorOutput)
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      void dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "Nacho 面板服务已停止",
        message: "面板运行时意外退出。",
        detail: `${code === null ? `signal=${signal}` : `exit=${code}`}\n${errorOutput}`,
      })
    }
  })

  try {
    await waitForPanel()
  } catch (error) {
    await killPanelProcess()
    throw error
  }
}

function broadcastMaximizedState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("window:maximized-change", mainWindow.isMaximized())
  }
}

function registerWindowBridge() {
  registerConnectionIpc({
    ipcMain,
    getMainWindow: () => mainWindow,
    store: connectionStore,
  })
  ipcMain.on("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle("window:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  ipcMain.handle("window:is-maximized", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })
  ipcMain.on("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle("updates:check", (event, force) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("窗口来源无效")
    return updates.check(force === true)
  })
  ipcMain.handle("updates:install-panel", (event, sequence, version) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("窗口来源无效")
    return updates.installPanel(sequence, version)
  })
  ipcMain.handle("updates:transfer", (event, kind, serverUrl, apiKey, sequence, version) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("窗口来源无效")
    return updates.transferRelease(kind, serverUrl, apiKey, sequence, version, (percent) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updates:transfer-progress", percent)
    })
  })
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: "#0e1715",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.on("maximize", broadcastMaximizedState)
  mainWindow.on("unmaximize", broadcastMaximizedState)
  mainWindow.once("ready-to-show", () => mainWindow.show())
  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

async function boot() {
  log("开始启动桌面面板")
  await startPanelServer()
  createMainWindow()
  await mainWindow.loadURL(`http://127.0.0.1:${panelPort}/`)
  log("桌面面板页面已加载")
  updates.subscribe((checked) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updates:available", checked)
  })
  setTimeout(() => void updates.check().catch((error) => log("发布检查失败", error)), 45_000).unref()
  setInterval(() => void updates.check().catch((error) => log("发布检查失败", error)),
    24 * 60 * 60 * 1000).unref()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    connectionStore = createConnectionStore({
      safeStorage,
      filePath: connectionPaths.filePath,
      protector: createCredentialProtector(),
      archivedPath: connectionPaths.archivedPath,
    })
    // 启动校验与每次读取均验证磁盘记录，缓存不掩盖持久化错误。
    try {
      connectionStore.load()
    } catch (error) {
      // 继续启动面板，但损坏的密文不会回退到 localStorage；显式新连接可覆盖修复。
      log(`加密连接配置读取失败 code=${error.code || "read-failed"}`)
    }
    registerWindowBridge()
    try {
      await boot()
    } catch (error) {
      log("桌面面板启动失败", error)
      await dialog.showMessageBox({
        type: "error",
        title: "Nacho 面板启动失败",
        message: "无法启动面板运行时。",
        detail: error instanceof Error ? error.stack || error.message : String(error),
      })
      app.quit()
    }
  })

  app.on("before-quit", (event) => {
    updates.unsubscribe()
    if (isQuitting) return
    isQuitting = true
    if (panelProcess && !panelProcessExited) {
      event.preventDefault()
      void killPanelProcess().finally(() => app.quit())
    }
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })
}
