const { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, safeStorage, shell, utilityProcess } = require("electron")
const { randomBytes } = require("node:crypto")
const http = require("node:http")
const net = require("node:net")
const path = require("node:path")
const fs = require("node:fs")
const { createUpdater, CHECK_INTERVAL_MS } = require("./updates.cjs")
const { compareVersions } = require("./release-manifest.cjs")
const { createConnectionStore, registerConnectionIpc } = require("./connection-store.cjs")
const { configureConnectionContext } = require("./connection-context.cjs")
const { createCredentialProtector } = require("./credential-protector.cjs")
const { normalizeResizeEdges, resolveResizeBounds } = require("./window-resize.cjs")
const { killRuntimeProcess } = require("./ai-process.cjs")
const { registerEmailOAuthBrowserIpc } = require("./email-oauth-browser.cjs")

// 必须在 app.ready 及 safeStorage 初始化之前固定 profile，避免不同启动方式共用密文却使用不同密钥。
const connectionPaths = configureConnectionContext(app)
const aiRuntimePath = path.join(connectionPaths.dataDirectory, "ai-runtime.json")

let mainWindow = null
// 边缘缩放会话：记录拖动起点时的窗口边界与最小尺寸。
let resizeSession = null
let connectionStore = null
let panelProcess = null
let panelPort = null
let panelProcessExited = true
let isQuitting = false
let updateTimer = null
let firstUpdateCheck = null
const localUpdateToken = randomBytes(32).toString("hex")
const announcedReleases = new Set()

async function applyLocalUpdate(leaseId) {
  if (!panelPort || panelProcessExited) throw new Error("本机升级服务不可用")
  const origin = `http://127.0.0.1:${panelPort}`
  const response = await fetch(`${origin}/api/local-control-server`, {
    method: "POST", credentials: "omit", redirect: "error",
    headers: { Origin: origin, "Content-Type": "application/json", "X-Nacho-Local-Update": localUpdateToken },
    body: JSON.stringify({ action: "update", leaseId }),
    signal: AbortSignal.timeout(45 * 60 * 1000),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.ok) throw new Error(body?.message || "本机服务升级失败")
  // renderer 只需要操作结果，不返回本地 API 凭据。
  return { version: body.data?.version, healthy: Boolean(body.data?.healthy) }
}

function publishUpdateCheck(result) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updates:available", result)
  if (!Notification.isSupported()) return
  const panel = result.components.panel
  if (panel?.status !== "available" || compareVersions(panel.release.target.version, result.currentVersion) <= 0) return
  const { release } = panel
  if (announcedReleases.has(release.target.digest)) return
  announcedReleases.add(release.target.digest)
  const notice = new Notification({
    title: release.official ? "NachoPanel 有可用更新" : "第三方 NachoPanel 更新",
    body: `v${release.target.version} · ${release.repository}。请在「设置 → 更新」查看并确认。`,
  })
  notice.on("click", () => { mainWindow?.show(); mainWindow?.focus() })
  notice.show()
}

const updates = createUpdater(app, {
  dataDirectory: connectionPaths.dataDirectory,
  ageResources: path.join(app.isPackaged ? process.resourcesPath : __dirname, "age"),
  safeStorage,
  applyLocal: applyLocalUpdate,
  onCheck: publishUpdateCheck,
  async approveThirdParty(release) {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "确认第三方更新",
      message: "此制品不是官方发布。更新将运行第三方提供的代码。",
      detail: `${release.label} · ${release.repository}\n${release.channel} · v${release.version} · ${release.kind}\nEd25519 SHA-256: ${release.fingerprint}`,
      buttons: ["取消", "信任并继续本次更新"],
      defaultId: 0, cancelId: 0, noLink: true,
    })
    return result.response === 1
  },
  onPanelInstallProgress(state) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updates:panel-install-progress", state)
  },
})

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

function getUnpackedPath(fileName) {
  const base = __dirname.replace(/app\.asar(?=$|[\\/])/, "app.asar.unpacked")
  return path.join(base, fileName)
}

function getOpencodeBinaryPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "opencode", "opencode.exe")
    : path.join(__dirname, "opencode", "opencode.exe")
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
      NACHO_PANEL_DESKTOP: "1",
      NACHO_AI_DATA_DIR: connectionPaths.dataDirectory,
      NACHO_CREDENTIAL_PROTECTOR: getUnpackedPath("nacho-credential-protector.exe"),
      NACHO_OPENCODE_BINARY: getOpencodeBinaryPath(),
      NACHO_LOCAL_UPDATE_DIR: connectionPaths.dataDirectory,
      NACHO_LOCAL_UPDATE_VERIFIER: path.join(panelDir, "update-verifier", "release-manifest.cjs"),
      NACHO_LOCAL_UPDATE_TOKEN: localUpdateToken,
      NACHO_LOCAL_UPDATE_PANEL_VERSION: app.getVersion(),
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
    killRuntimeProcess(aiRuntimePath, getOpencodeBinaryPath())
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
  registerEmailOAuthBrowserIpc({
    ipcMain,
    getMainWindow: () => mainWindow,
    getPanelOrigin: () => panelPort ? `http://127.0.0.1:${panelPort}` : null,
    openExternal: (url) => shell.openExternal(url),
  })
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
  // 透明窗口在 Windows 上会失去 WS_THICKFRAME 原生缩放边框，窗口缩放改由面板侧边缘拖动经 IPC 驱动。
  ipcMain.on("window:resize-begin", (event, edges) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed() || window.isMaximized() || window.isFullScreen()) {
      resizeSession = null
      return
    }
    resizeSession = {
      window,
      edges: normalizeResizeEdges(edges),
      startBounds: window.getBounds(),
      minSize: window.getMinimumSize(),
    }
  })
  ipcMain.on("window:resize-apply", (event, dx, dy) => {
    const session = resizeSession
    if (!session || session.window.isDestroyed()) return
    if (BrowserWindow.fromWebContents(event.sender) !== session.window) return
    session.window.setBounds(resolveResizeBounds(session, dx, dy))
  })
  ipcMain.on("window:resize-end", (event) => {
    const session = resizeSession
    if (!session) return
    if (BrowserWindow.fromWebContents(event.sender) !== session.window) return
    resizeSession = null
  })
  function updateIpc(channel, handler) {
    ipcMain.handle(`updates:${channel}`, (event, ...args) => {
      if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents ||
          !event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
          new URL(event.senderFrame.url).origin !== `http://127.0.0.1:${panelPort}`) throw new Error("窗口来源无效")
      return handler(...args)
    })
  }
  updateIpc("check", (force) => updates.check(force === true))
  updateIpc("install-panel", (target) => updates.installPanel(target))
  updateIpc("install-local", (target) => {
    if (connectionStore?.read()?.snapshot?.serverSource?.mode !== "local") throw new Error("请先连接本机服务")
    return updates.installLocalServer(target)
  })
  updateIpc("panel-install-state", () => updates.getPanelInstallState())
  updateIpc("transfer", (kind, target) => {
    const source = connectionStore?.read()?.snapshot?.serverSource
    if (!source || (kind === "server" && source.mode !== "cloud")) throw new Error("请先连接目标控制服务")
    return updates.transferRelease(kind, source.api, source.key, target, (percent) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updates:transfer-progress", percent)
    })
  })
  updateIpc("settings", () => updates.readSettings())
  updateIpc("select", (profileId, channel) => updates.select(profileId, channel))
  updateIpc("trust", (raw, fingerprint) => {
    if (typeof raw !== "string" || raw.length > 8192) throw new Error("第三方更新来源配置无效")
    let profile
    try { profile = JSON.parse(raw) } catch { throw new Error("第三方更新来源必须使用 JSON") }
    return updates.trustProfile(profile, fingerprint)
  })
  updateIpc("remove-profile", (id) => updates.removeProfile(id))
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    // 窗口四角由面板侧圆角裁切透出桌面：窗口必须透明；thickFrame 保留 WS_THICKFRAME，
    // 维持无边框窗口的边缘缩放与系统阴影。
    transparent: true,
    thickFrame: true,
    backgroundColor: "#00000000",
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
    resizeSession = null
    mainWindow = null
  })
}

async function boot() {
  log("开始启动桌面面板")
  await startPanelServer()
  createMainWindow()
  await mainWindow.loadURL(`http://127.0.0.1:${panelPort}/`)
  log("桌面面板页面已加载")
  const checkInBackground = () => {
    // 未建立桌面连接时不为开发者预览启动后台更新请求。
    try {
      if (connectionStore?.read()?.snapshot?.serverSource) void updates.check(true).catch(() => {})
    } catch { /* 连接存储故障不会回退到其他更新来源 */ }
  }
  firstUpdateCheck = setTimeout(checkInBackground, 3_000).unref()
  updateTimer = setInterval(checkInBackground, CHECK_INTERVAL_MS).unref()
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
    clearTimeout(firstUpdateCheck)
    clearInterval(updateTimer)
    killRuntimeProcess(aiRuntimePath, getOpencodeBinaryPath())
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
