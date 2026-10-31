import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { resolveAIModel } from "./config-shared"
import { AGENTS_MARKDOWN, buildOpencodeConfig } from "./opencode-config"
import {
  ensureAIDirectories,
  getAIDataDirectory,
  getAIWorkspacePath,
  getCredentialProtectorPath,
  getOpencodeBinary,
  getOpencodeCachePath,
  getOpencodeConfigPath,
  getOpencodeDataPath,
  getOpencodeHomePath,
  getOpencodeRoot,
  getOpencodeStatePath,
  getPanelLocalBaseUrl,
  getAIRuntimePath,
  getAIEngineLogPath,
  hasOpencodeBinary,
  isDesktopEnvironment,
} from "./runtime-paths"
import { redactSecrets } from "./redact"
import { getAISettingsStore } from "./settings-store"
import type { StoredAIConfig } from "./settings-schema"

export type AIRuntimeState = "stopped" | "starting" | "ready" | "error"

export type AIRuntimeStatus = {
  state: AIRuntimeState
  version?: string
  error?: string
}

export type RuntimeHandle = {
  child: ChildProcess
  pid: number
  port: number
  url: string
  username: string
  password: string
  proxyToken: string
  brokerToken: string
  version: string
  startedAt: number
  mcpEnv: Record<string, string>
}

export class AIRuntimeError extends Error {
  constructor(message: string, readonly code: "desktop-only" | "not-installed" | "not-configured" | "start-failed") {
    super(message)
    this.name = "AIRuntimeError"
  }
}

let current: RuntimeHandle | null = null
let starting: Promise<RuntimeHandle> | null = null
let stale = false
let lastError: string | null = null

function basicHeader(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = net.createServer()
    probe.unref()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      const port = typeof address === "object" && address ? address.port : 0
      probe.close((error) => (error ? reject(error) : port ? resolve(port) : reject(new Error("无法分配 AI 端口"))))
    })
  })
}

function killTree(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
    return
  }
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    // already gone
  }
}

function runtimeFile() {
  return getAIRuntimePath()
}

async function writeRuntimeState(handle: RuntimeHandle | null, error?: string) {
  const file = runtimeFile()
  if (!handle) {
    await fsp.unlink(file).catch(() => undefined)
    return
  }
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await fsp.writeFile(temporary, `${JSON.stringify({
    version: 1,
    pid: handle.pid,
    port: handle.port,
    url: handle.url,
    engineVersion: handle.version,
    startedAt: handle.startedAt,
    state: error ? "error" : "ready",
    ...(error ? { error } : {}),
  })}\n`, { encoding: "utf8", mode: 0o600 })
  await fsp.rename(temporary, file)
  await fsp.chmod(file, 0o600).catch(() => undefined)
}

async function cleanupStaleRuntime() {
  const file = runtimeFile()
  try {
    const raw = await fsp.readFile(file, "utf8")
    const state = JSON.parse(raw) as { pid?: unknown }
    if (typeof state.pid === "number" && Number.isInteger(state.pid)) killTree(state.pid)
  } catch {
    // missing or corrupt
  }
  await fsp.unlink(file).catch(() => undefined)
}

function childEnvironment(settings: StoredAIConfig, handle: Pick<RuntimeHandle, "proxyToken" | "brokerToken" | "mcpEnv">, password: string): Record<string, string> {
  const env: Record<string, string> = { NODE_ENV: "production" }
  for (const key of [
    "PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "ComSpec", "PATHEXT",
    "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "LANG",
  ]) {
    const value = process.env[key]
    if (value) env[key] = value
  }
  const home = getOpencodeHomePath()
  env.HOME = home
  env.USERPROFILE = home
  env.APPDATA = path.join(home, "AppData", "Roaming")
  env.LOCALAPPDATA = path.join(home, "AppData", "Local")
  env.XDG_CONFIG_HOME = path.join(getOpencodeRoot(), "config")
  env.XDG_DATA_HOME = getOpencodeDataPath()
  env.XDG_CACHE_HOME = getOpencodeCachePath()
  env.XDG_STATE_HOME = getOpencodeStatePath()
  env.OPENCODE_SERVER_USERNAME = "opencode"
  env.OPENCODE_SERVER_PASSWORD = password
  env.NACHO_PROXY_TOKEN = handle.proxyToken
  env.NACHO_BROKER_TOKEN = handle.brokerToken
  for (const [key, value] of Object.entries(handle.mcpEnv)) env[key] = value
  // --pure 已阻止插件安装；这里再加一道保险，避免任何运行时 npm 安装。
  env.npm_config_registry = "http://127.0.0.1:1"
  env.npm_config_offline = "true"
  env.OPENCODE_DISABLE_AUTOUPDATE = "1"
  env.NO_COLOR = "1"
  return env
}

async function waitForHealth(url: string, username: string, password: string, child: ChildProcess, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = "AI 引擎未就绪"
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`AI 引擎提前退出（code=${child.exitCode}）`)
    try {
      const response = await fetch(`${url}/global/health`, {
        headers: { Authorization: basicHeader(username, password) },
        signal: AbortSignal.timeout(2_000),
      })
      if (response.ok) {
        const body = await response.json().catch(() => null) as { healthy?: boolean; version?: string } | null
        if (body?.healthy !== false) return { version: body?.version || "unknown" }
      }
      lastError = `AI 引擎健康检查失败（HTTP ${response.status}）`
    } catch (error) {
      lastError = error instanceof Error ? error.message : "AI 引擎健康检查失败"
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(lastError)
}

function logTail(secrets: string[]) {
  try {
    const raw = fs.readFileSync(getAIEngineLogPath(), "utf8")
    return redactSecrets(raw.slice(-4_000), secrets)
  } catch {
    return ""
  }
}

async function startRuntime(): Promise<RuntimeHandle> {
  if (!isDesktopEnvironment()) throw new AIRuntimeError("AI Mode 仅支持 Windows 桌面版", "desktop-only")
  if (!hasOpencodeBinary()) throw new AIRuntimeError("未找到 AI 引擎", "not-installed")
  if (!getCredentialProtectorPath()) throw new AIRuntimeError("缺少 Windows 凭据保护组件", "desktop-only")
  const snapshot = await getAISettingsStore().read()
  const settings = snapshot.config
  const model = resolveAIModel(settings)
  if (!settings.enabled) throw new AIRuntimeError("AI Mode 已在设置中停用", "not-configured")
  if (!settings.baseUrl || !settings.apiKey) throw new AIRuntimeError("请先配置 API 地址与 API Key", "not-configured")
  if (!model) throw new AIRuntimeError("请先选择模型", "not-configured")

  await cleanupStaleRuntime()
  ensureAIDirectories()
  const workspace = getAIWorkspacePath()
  const port = await freePort()
  const username = "opencode"
  const password = randomBytes(24).toString("hex")
  const proxyToken = randomBytes(24).toString("hex")
  const brokerToken = randomBytes(24).toString("hex")
  const url = `http://127.0.0.1:${port}`

  const built = buildOpencodeConfig(settings, {
    panelBaseUrl: getPanelLocalBaseUrl(),
    brokerToken,
  })
  const configText = `${JSON.stringify(built.config, null, 2)}\n`
  await fsp.writeFile(path.join(workspace, "opencode.json"), configText, { encoding: "utf8", mode: 0o600 })
  await fsp.writeFile(path.join(workspace, "AGENTS.md"), AGENTS_MARKDOWN, { encoding: "utf8", mode: 0o600 })
  await fsp.mkdir(getOpencodeConfigPath(), { recursive: true })
  await fsp.writeFile(path.join(getOpencodeConfigPath(), "opencode.json"), configText, { encoding: "utf8", mode: 0o600 })

  const logPath = getAIEngineLogPath()
  await fsp.mkdir(path.dirname(logPath), { recursive: true })
  try {
    const stat = await fsp.stat(logPath)
    if (stat.size > 2 * 1024 * 1024) await fsp.truncate(logPath, 0)
  } catch {
    // no log yet
  }
  const logStream = fs.createWriteStream(logPath, { flags: "a", mode: 0o600 })
  logStream.write(`\n=== ${new Date().toISOString()} AI engine (${built.model}) ===\n`)

  const handleBase = {
    proxyToken,
    brokerToken,
    mcpEnv: built.mcpEnv,
  }
  const child = spawn(getOpencodeBinary(), [
    "serve",
    "--pure",
    "--hostname", "127.0.0.1",
    "--port", String(port),
  ], {
    cwd: workspace,
    env: childEnvironment(settings, handleBase, password) as NodeJS.ProcessEnv,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout?.pipe(logStream, { end: false })
  child.stderr?.pipe(logStream, { end: false })

  const secrets = [settings.apiKey, proxyToken, brokerToken, ...Object.values(built.mcpEnv)]
  const startingHandle: RuntimeHandle = {
    child,
    pid: child.pid || 0,
    port,
    url,
    username,
    password,
    proxyToken,
    brokerToken,
    version: "starting",
    startedAt: Date.now(),
    mcpEnv: built.mcpEnv,
  }
  await writeRuntimeState(startingHandle)
  try {
    const health = await waitForHealth(url, username, password, child)
    const handle: RuntimeHandle = { ...startingHandle, version: health.version }
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      logStream.write(`\n=== AI engine exited code=${code} signal=${signal} ===\n`)
      logStream.end()
      if (current?.child === child) {
        current = null
        lastError = `AI 引擎已退出（${code ?? signal ?? "unknown"}）`
        void writeRuntimeState(null)
      }
    })
    await writeRuntimeState(handle)
    current = handle
    lastError = null
    stale = false
    return handle
  } catch (error) {
    killTree(child.pid || 0)
    logStream.write(`\n=== AI engine start failed: ${error instanceof Error ? error.message : "unknown"} ===\n`)
    logStream.end()
    await writeRuntimeState(null)
    const tail = logTail(secrets)
    throw new AIRuntimeError(
      `AI 引擎启动失败：${redactSecrets(error instanceof Error ? error.message : "未知错误", secrets)}${tail ? `\n${tail}` : ""}`,
      "start-failed",
    )
  }
}

export async function ensureRuntime(): Promise<RuntimeHandle> {
  if (current && !stale) return current
  if (starting) return starting
  starting = (async () => {
    if (current) await stopRuntime()
    const handle = await startRuntime()
    starting = null
    return handle
  })()
  try {
    return await starting
  } catch (error) {
    starting = null
    lastError = error instanceof Error ? error.message : "AI 引擎启动失败"
    throw error
  }
}

export async function stopRuntime() {
  const handle = current
  current = null
  starting = null
  if (handle) {
    killTree(handle.pid)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  await writeRuntimeState(null)
}

export function markRuntimeStale() {
  stale = true
}

export function getRuntimeStatus(): AIRuntimeStatus {
  if (current) return { state: "ready", version: current.version }
  if (starting) return { state: "starting" }
  if (lastError) return { state: "error", error: lastError }
  return { state: "stopped" }
}

export function getRuntimeTokens(): { proxyToken: string; brokerToken: string } | null {
  return current ? { proxyToken: current.proxyToken, brokerToken: current.brokerToken } : null
}

export function getRuntimeHandle() {
  return current
}

export function getRuntimeDataDirectory() {
  return getAIDataDirectory()
}

process.once("exit", () => {
  if (current) killTree(current.pid)
})
