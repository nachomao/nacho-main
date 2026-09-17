import { randomBytes, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { constants } from "node:fs"
import { access, cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import {
  LOCAL_CONTROL_UNINSTALL_CONFIRMATION,
  type LocalControlAccessMode,
  type LocalControlInstallOptions,
  type LocalControlServerStatus,
} from "./local-control-server-types"

const execFileAsync = promisify(execFile)
const DEFAULT_PORT = 8443
const MIN_PORT = 1024
const MAX_PORT = 65535
const HEALTH_TIMEOUT_MS = 15_000
const POWERSHELL_TIMEOUT_MS = 60_000

export class LocalControlServerError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message)
  }
}

type WindowsRuntimeState = {
  running?: boolean
  pid?: number | null
  startedAt?: string | null
  autoStartEnabled?: boolean
  firewallPorts?: number[]
  listeningPorts?: number[]
  nodeReady?: boolean
  nodeVersion?: string
  npmAvailable?: boolean
  runtimeInstallerAvailable?: boolean
}

export type EnvironmentMap = Map<string, string>

const WEAK_SECRETS = new Set(["change-me-panel-api-key", "change-me-enrollment-key"])

function exists(filePath: string) {
  return access(filePath, constants.F_OK).then(
    () => true,
    () => false,
  )
}

export function isValidLocalControlPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_PORT && value <= MAX_PORT
}

export function parseEnvironmentFile(raw: string): EnvironmentMap {
  const values = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const separator = trimmed.indexOf("=")
    if (separator <= 0) continue
    values.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1))
  }
  return values
}

function serializeEnvironment(values: EnvironmentMap) {
  return `${[...values].map(([key, value]) => `${key}=${value}`).join("\n")}\n`
}

function generateSecret() {
  return randomBytes(32).toString("base64url")
}

function localIpv4Addresses() {
  const addresses = new Set<string>()
  for (const records of Object.values(os.networkInterfaces())) {
    for (const record of records || []) {
      if (record.family === "IPv4" && !record.internal) addresses.add(record.address)
    }
  }
  return [...addresses]
}

function serverDirectoryCandidates() {
  if (process.env.NACHO_LOCAL_SERVER_DIR) return [path.resolve(process.env.NACHO_LOCAL_SERVER_DIR)]
  return [path.resolve(process.cwd(), "server"), path.resolve(process.cwd(), "..", "server")]
}

export async function resolveLocalServerDirectory() {
  for (const candidate of serverDirectoryCandidates()) {
    if (path.basename(candidate).toLowerCase() !== "server") continue
    try {
      const manifest = JSON.parse(await readFile(path.join(candidate, "package.json"), "utf8")) as { name?: string }
      if (manifest.name !== "nacho-server") continue
      if (!(await exists(path.join(candidate, "src", "index.ts")))) continue
      if (!(await exists(path.join(candidate, "deploy", "windows")))) continue
      return candidate
    } catch {
      // 继续检查下一个可信候选目录。
    }
  }
  throw new LocalControlServerError("未找到可信的 server 项目目录", 404)
}

function managementPaths(serverDir: string) {
  const stateDir = path.join(serverDir, ".nacho-local")
  return {
    env: path.join(serverDir, ".env"),
    distEntry: path.join(serverDir, "dist", "index.js"),
    packageLock: path.join(serverDir, "package-lock.json"),
    script: path.join(serverDir, "deploy", "windows", "local-control-server.ps1"),
    stateDir,
    backupDist: path.join(stateDir, "backup-dist"),
    backupEnv: path.join(stateDir, "backup.env"),
  }
}

async function readEnvironment(serverDir: string) {
  const envPath = managementPaths(serverDir).env
  if (!(await exists(envPath))) return new Map<string, string>()
  return parseEnvironmentFile(await readFile(envPath, "utf8"))
}

async function writeEnvironment(serverDir: string, values: EnvironmentMap) {
  const envPath = managementPaths(serverDir).env
  const temporary = `${envPath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, serializeEnvironment(values), { encoding: "utf8", mode: 0o600 })
  await rename(temporary, envPath)
}

function accessModeFromEnvironment(values: EnvironmentMap): LocalControlAccessMode {
  return values.get("HOST") === "127.0.0.1" ? "loopback" : "lan"
}

function portFromEnvironment(values: EnvironmentMap) {
  const parsed = Number(values.get("PORT"))
  return isValidLocalControlPort(parsed) ? parsed : DEFAULT_PORT
}

function databasePathFromEnvironment(serverDir: string, values: EnvironmentMap) {
  const configured = values.get("DATABASE_PATH")?.trim() || "./data/nacho.db"
  return path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(serverDir, configured)
}

function localApi(port: number) {
  return `http://127.0.0.1:${port}`
}

function localAgentApi(accessMode: LocalControlAccessMode, port: number, addresses: string[]) {
  if (accessMode === "lan" && addresses[0]) return `http://${addresses[0]}:${port}`
  return localApi(port)
}

function hasStrongSecret(values: EnvironmentMap, key: string) {
  const value = values.get(key)?.trim() || ""
  return value.length >= 24 && !WEAK_SECRETS.has(value)
}

export function createInitialEnvironment(options: Required<LocalControlInstallOptions>) {
  const values = new Map<string, string>()
  values.set("HOST", options.accessMode === "lan" ? "0.0.0.0" : "127.0.0.1")
  values.set("PORT", String(options.port))
  values.set("CORS_ORIGIN", "*")
  values.set("DATABASE_PATH", "./data/nacho.db")
  values.set("PANEL_API_KEY", generateSecret())
  values.set("ENROLLMENT_KEY", generateSecret())
  values.set("ALLOW_OPEN_ENROLLMENT", "false")
  values.set("PUBLIC_BASE_URL", "")
  values.set("TRUST_PROXY", "false")
  values.set("ARTIFACTS_PATH", "./artifacts")
  values.set("HEALTH_ARTIFACTS_PATH", "./data/health-artifacts")
  values.set("OFFLINE_THRESHOLD", "60")
  values.set("LOG_RETENTION_MAX", "100000")
  values.set("LOCAL_CONTROL_TOKEN", generateSecret())
  values.set("NODE_ENV", "production")
  return values
}

export function ensureManagedEnvironment(input: EnvironmentMap) {
  const values = new Map(input)
  const host = values.get("HOST")
  if (host !== "127.0.0.1" && host !== "0.0.0.0") values.set("HOST", "127.0.0.1")
  if (!isValidLocalControlPort(Number(values.get("PORT")))) values.set("PORT", String(DEFAULT_PORT))

  const defaults = new Map<string, string>([
    ["CORS_ORIGIN", "*"],
    ["DATABASE_PATH", "./data/nacho.db"],
    ["ALLOW_OPEN_ENROLLMENT", "false"],
    ["PUBLIC_BASE_URL", ""],
    ["TRUST_PROXY", "false"],
    ["ARTIFACTS_PATH", "./artifacts"],
    ["HEALTH_ARTIFACTS_PATH", "./data/health-artifacts"],
    ["OFFLINE_THRESHOLD", "60"],
    ["LOG_RETENTION_MAX", "100000"],
    ["NODE_ENV", "production"],
  ])
  for (const [key, value] of defaults) {
    if (!values.has(key) || (key !== "PUBLIC_BASE_URL" && !values.get(key)?.trim())) values.set(key, value)
  }
  for (const key of ["PANEL_API_KEY", "ENROLLMENT_KEY", "LOCAL_CONTROL_TOKEN"]) {
    if (!hasStrongSecret(values, key)) values.set(key, generateSecret())
  }
  return values
}

function configurationNeedsRepair(values: EnvironmentMap, envExists: boolean) {
  if (!envExists) return false
  const host = values.get("HOST")
  return (
    (host !== "127.0.0.1" && host !== "0.0.0.0") ||
    !isValidLocalControlPort(Number(values.get("PORT"))) ||
    !values.get("DATABASE_PATH")?.trim() ||
    !hasStrongSecret(values, "PANEL_API_KEY") ||
    !hasStrongSecret(values, "ENROLLMENT_KEY") ||
    !hasStrongSecret(values, "LOCAL_CONTROL_TOKEN")
  )
}

async function runExecutable(file: string, args: string[], cwd: string, timeout = POWERSHELL_TIMEOUT_MS) {
  try {
    return await execFileAsync(file, args, {
      cwd,
      timeout,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
  } catch (error) {
    const detail = error as { stderr?: string; stdout?: string; message?: string }
    const message = detail.stderr?.trim() || detail.stdout?.trim() || detail.message || "本地命令执行失败"
    throw new LocalControlServerError(message)
  }
}

async function runPowerShell(serverDir: string, action: string, port?: number, timeout = POWERSHELL_TIMEOUT_MS) {
  const script = managementPaths(serverDir).script
  if (!(await exists(script))) throw new LocalControlServerError("缺少 Windows 本地服务管理脚本", 500)
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Action", action]
  if (port !== undefined) args.push("-Port", String(port))
  return runExecutable("powershell.exe", args, serverDir, timeout)
}

async function windowsRuntimeState(serverDir: string, port = DEFAULT_PORT): Promise<WindowsRuntimeState> {
  if (process.platform !== "win32") return {}
  try {
    const { stdout } = await runPowerShell(serverDir, "Status", port)
    const line = stdout.trim().split(/\r?\n/).at(-1)
    return line ? (JSON.parse(line) as WindowsRuntimeState) : {}
  } catch {
    return {}
  }
}

export function createNpmInvocation(
  args: string[],
  platform: NodeJS.Platform = process.platform,
  commandShell = process.env.ComSpec || process.env.COMSPEC || "cmd.exe",
) {
  if (platform === "win32") {
    return { file: commandShell, args: ["/d", "/s", "/c", "npm.cmd", ...args] }
  }
  return { file: "npm", args }
}

async function runNpm(args: string[], serverDir: string, timeout: number) {
  const invocation = createNpmInvocation(args)
  return runExecutable(invocation.file, invocation.args, serverDir, timeout)
}

async function healthCheck(port: number) {
  try {
    const response = await fetch(`${localApi(port)}/health`, { signal: AbortSignal.timeout(2_500), cache: "no-store" })
    const body = (await response.json().catch(() => null)) as { ok?: boolean; service?: string } | null
    return response.ok && body?.ok === true && body.service === "nacho-server"
  } catch {
    return false
  }
}

async function waitForHealth(serverDir: string, port: number) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    const runtime = await windowsRuntimeState(serverDir, port)
    if (runtime.running && runtime.listeningPorts?.includes(port) && (await healthCheck(port))) return
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  throw new LocalControlServerError(`受管本地服务未能在端口 ${port} 上通过健康检查`)
}

export async function getLocalControlServerStatus(): Promise<LocalControlServerStatus> {
  let serverDir: string
  try {
    serverDir = await resolveLocalServerDirectory()
  } catch (error) {
    const message = error instanceof Error ? error.message : "未找到 server 项目目录"
    const platformSupported = process.platform === "win32"
    return {
      platformSupported,
      runtimeStatus: platformSupported ? "not-installed" : "unsupported",
      installed: false,
      running: false,
      healthy: false,
      needsRepair: false,
      pid: null,
      startedAt: null,
      autoStartEnabled: false,
      accessMode: "loopback",
      host: "127.0.0.1",
      port: DEFAULT_PORT,
      firewallEnabled: false,
      firewallNeedsCleanup: false,
      serverDir: "",
      databasePath: "",
      localAddresses: [],
      connection: null,
      prerequisites: {
        node: false,
        nodeVersion: "未检测到",
        npm: false,
        source: false,
        installerAvailable: false,
      },
      issues: [message],
    }
  }

  const paths = managementPaths(serverDir)
  const values = await readEnvironment(serverDir)
  const port = portFromEnvironment(values)
  const [envExists, distExists, lockExists, scriptExists, runtime] = await Promise.all([
    exists(paths.env),
    exists(paths.distEntry),
    exists(paths.packageLock),
    exists(paths.script),
    windowsRuntimeState(serverDir, port),
  ])
  const node = runtime.nodeReady === true
  const npm = runtime.npmAvailable === true
  const source = lockExists && scriptExists
  const platformSupported = process.platform === "win32"
  const accessMode = accessModeFromEnvironment(values)
  const running = runtime.running === true
  const ownsConfiguredListener = runtime.listeningPorts?.includes(port) === true
  const healthy = running && ownsConfiguredListener && (await healthCheck(port))
  const installed = envExists && distExists
  const configNeedsRepair = configurationNeedsRepair(values, envExists)
  const firewallPorts = runtime.firewallPorts || []
  const firewallEnabled = firewallPorts.includes(port)
  const firewallNeedsCleanup = accessMode === "loopback" && firewallPorts.length > 0
  const issues: string[] = []

  if (!platformSupported) issues.push("本地控制服务管理仅支持 Windows")
  if (!node) issues.push(runtime.runtimeInstallerAvailable ? "安装时将自动补齐 Node.js 22+" : "需要 Node.js 22 或更高版本")
  if (!npm) issues.push(runtime.runtimeInstallerAvailable ? "安装时将自动补齐 npm" : "未检测到 npm")
  if (!source) issues.push("server 项目源码或 Windows 管理脚本不完整")
  if (envExists !== distExists) issues.push("本地服务安装不完整，需要修复")
  if (configNeedsRepair) issues.push("本地服务配置缺失或不安全，需要修复")
  if (running && !ownsConfiguredListener) issues.push(`受管进程未监听配置端口 ${port}`)
  else if (running && !healthy) issues.push("进程正在运行，但健康检查失败")
  if (accessMode === "lan" && !firewallEnabled) issues.push("局域网模式尚未完成 Windows 防火墙放行")
  if (firewallNeedsCleanup) issues.push("检测到不再需要的 Windows 防火墙规则")

  let runtimeStatus: LocalControlServerStatus["runtimeStatus"] = "unsupported"
  if (platformSupported) {
    if (!installed) runtimeStatus = "not-installed"
    else if (!running) runtimeStatus = "stopped"
    else if (!healthy) runtimeStatus = "unhealthy"
    else runtimeStatus = "running"
  }

  const key = values.get("PANEL_API_KEY")
  const localAddresses = localIpv4Addresses()
  return {
    platformSupported,
    runtimeStatus,
    installed,
    running,
    healthy,
    needsRepair: !node || !npm || envExists !== distExists || configNeedsRepair || firewallNeedsCleanup || (running && !healthy),
    pid: runtime.pid || null,
    startedAt: runtime.startedAt || null,
    autoStartEnabled: runtime.autoStartEnabled === true,
    accessMode,
    host: values.get("HOST") || "127.0.0.1",
    port,
    firewallEnabled,
    firewallNeedsCleanup,
    serverDir,
    databasePath: databasePathFromEnvironment(serverDir, values),
    localAddresses,
    connection: installed && key ? { api: localApi(port), agentApi: localAgentApi(accessMode, port, localAddresses), key } : null,
    prerequisites: {
      node,
      nodeVersion: runtime.nodeVersion || "未检测到",
      npm,
      source,
      installerAvailable: runtime.runtimeInstallerAvailable === true,
    },
    issues,
  }
}

function requireWindows(status: LocalControlServerStatus) {
  if (!status.platformSupported) {
    throw new LocalControlServerError(status.issues[0] || "当前环境不支持 Windows 本地服务管理", 409)
  }
}

async function stopUnlocked(serverDir: string, values: EnvironmentMap) {
  const port = portFromEnvironment(values)
  const token = values.get("LOCAL_CONTROL_TOKEN")
  if (token) {
    try {
      await fetch(`${localApi(port)}/_local-control/shutdown`, {
        method: "POST",
        headers: { "x-nacho-local-control": token },
        signal: AbortSignal.timeout(3_000),
      })
    } catch {
      // 服务可能已经退出；随后由固定脚本核验 PID 并兜底终止。
    }
    const deadline = Date.now() + 4_000
    while (Date.now() < deadline) {
      const state = await windowsRuntimeState(serverDir)
      if (!state.running) return
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  await runPowerShell(serverDir, "ForceStop")
}

async function startUnlocked(serverDir: string, values: EnvironmentMap) {
  if (!(await exists(managementPaths(serverDir).distEntry))) {
    throw new LocalControlServerError("缺少服务端构建产物，请先安装或修复", 409)
  }
  const port = portFromEnvironment(values)
  await runPowerShell(serverDir, "Start", port)
  await waitForHealth(serverDir, port)
}

async function ensureRuntimePrerequisites(serverDir: string) {
  const runtime = await windowsRuntimeState(serverDir)
  if (runtime.nodeReady && runtime.npmAvailable) return
  if (!runtime.runtimeInstallerAvailable) {
    throw new LocalControlServerError("未找到 Windows Package Manager，无法自动安装 Node.js LTS 与 npm", 409)
  }

  await runPowerShell(serverDir, "InstallRuntime", undefined, 15 * 60_000)
  const installedRuntime = await windowsRuntimeState(serverDir)
  if (!installedRuntime.nodeReady || !installedRuntime.npmAvailable) {
    throw new LocalControlServerError("Node.js LTS 安装完成后仍未检测到可用的 Node.js 22+ 与 npm", 409)
  }
}

async function buildServer(serverDir: string) {
  if (process.platform === "win32") {
    await runPowerShell(serverDir, "Build", undefined, 15 * 60_000)
    return
  }
  await runNpm(["ci", "--no-audit", "--no-fund"], serverDir, 10 * 60_000)
  await runNpm(["run", "build"], serverDir, 5 * 60_000)
}

let mutationQueue: Promise<unknown> = Promise.resolve()
function withMutationLock<T>(operation: () => Promise<T>) {
  const result = mutationQueue.then(operation, operation)
  mutationQueue = result.catch(() => undefined)
  return result
}

export function installLocalControlServer(options: LocalControlInstallOptions) {
  return withMutationLock(async () => {
    const port = options.port ?? DEFAULT_PORT
    if (!isValidLocalControlPort(port)) throw new LocalControlServerError("端口必须是 1024-65535 之间的整数", 400)
    if (options.accessMode !== "loopback" && options.accessMode !== "lan") {
      throw new LocalControlServerError("连接范围无效", 400)
    }
    const status = await getLocalControlServerStatus()
    requireWindows(status)
    if (!status.prerequisites.source) {
      throw new LocalControlServerError("请确保完整的 server 项目源码与 Windows 管理脚本可用", 409)
    }
    if (status.installed) throw new LocalControlServerError("本地服务已经安装", 409)
    if (status.needsRepair) throw new LocalControlServerError("检测到已有配置或构建产物，请使用修复功能以保留现有数据与密钥", 409)

    const serverDir = status.serverDir
    await ensureRuntimePrerequisites(serverDir)
    await buildServer(serverDir)
    if (options.accessMode === "lan") await runPowerShell(serverDir, "SetFirewall", port)
    const values = createInitialEnvironment({ accessMode: options.accessMode, autoStart: options.autoStart, port })
    await writeEnvironment(serverDir, values)
    if (options.autoStart) await runPowerShell(serverDir, "EnableAutostart", port)
    await startUnlocked(serverDir, values)
    return getLocalControlServerStatus()
  })
}

export function startLocalControlServer() {
  return withMutationLock(async () => {
    const status = await getLocalControlServerStatus()
    requireWindows(status)
    if (!status.installed) throw new LocalControlServerError("本地服务尚未安装", 409)
    const values = await readEnvironment(status.serverDir)
    await startUnlocked(status.serverDir, values)
    return getLocalControlServerStatus()
  })
}

export function stopLocalControlServer() {
  return withMutationLock(async () => {
    const status = await getLocalControlServerStatus()
    requireWindows(status)
    if (!status.installed) throw new LocalControlServerError("本地服务尚未安装", 409)
    await stopUnlocked(status.serverDir, await readEnvironment(status.serverDir))
    return getLocalControlServerStatus()
  })
}

export function restartLocalControlServer() {
  return withMutationLock(async () => {
    const status = await getLocalControlServerStatus()
    requireWindows(status)
    if (!status.installed) throw new LocalControlServerError("本地服务尚未安装", 409)
    const values = await readEnvironment(status.serverDir)
    await stopUnlocked(status.serverDir, values)
    await startUnlocked(status.serverDir, values)
    return getLocalControlServerStatus()
  })
}

export function repairLocalControlServer() {
  return withMutationLock(async () => {
    const status = await getLocalControlServerStatus()
    requireWindows(status)
    const serverDir = status.serverDir
    if (!status.prerequisites.source) {
      throw new LocalControlServerError("请确保完整的 server 项目源码与 Windows 管理脚本可用", 409)
    }
    await ensureRuntimePrerequisites(serverDir)
    const paths = managementPaths(serverDir)
    const envExisted = await exists(paths.env)
    const previousValues = envExisted ? await readEnvironment(serverDir) : new Map<string, string>()
    const values = envExisted
      ? ensureManagedEnvironment(previousValues)
      : createInitialEnvironment({ accessMode: "loopback", autoStart: true, port: DEFAULT_PORT })
    const wasRunning = status.running
    if (wasRunning) await stopUnlocked(serverDir, previousValues)
    await mkdir(paths.stateDir, { recursive: true })
    await Promise.all([
      rm(paths.backupDist, { recursive: true, force: true }),
      rm(paths.backupEnv, { force: true }),
    ])
    if (await exists(path.dirname(paths.distEntry))) await cp(path.dirname(paths.distEntry), paths.backupDist, { recursive: true })
    if (envExisted) await cp(paths.env, paths.backupEnv)
    try {
      await buildServer(serverDir)
      if (accessModeFromEnvironment(values) === "lan") {
        await runPowerShell(serverDir, "SetFirewall", portFromEnvironment(values))
      } else if (status.firewallNeedsCleanup) {
        await runPowerShell(serverDir, "RemoveFirewall", portFromEnvironment(values))
      }
      await writeEnvironment(serverDir, values)
      if (wasRunning || !status.installed) await startUnlocked(serverDir, values)
      await Promise.all([
        rm(paths.backupDist, { recursive: true, force: true }),
        rm(paths.backupEnv, { force: true }),
      ])
    } catch (error) {
      if (await exists(paths.backupDist)) {
        await rm(path.dirname(paths.distEntry), { recursive: true, force: true })
        await cp(paths.backupDist, path.dirname(paths.distEntry), { recursive: true })
      }
      if (envExisted && (await exists(paths.backupEnv))) await cp(paths.backupEnv, paths.env)
      else await rm(paths.env, { force: true })
      if (wasRunning && (await exists(paths.distEntry))) await startUnlocked(serverDir, previousValues).catch(() => undefined)
      throw error
    }
    return getLocalControlServerStatus()
  })
}

export function setLocalControlAutoStart(enabled: boolean) {
  return withMutationLock(async () => {
    const status = await getLocalControlServerStatus()
    requireWindows(status)
    if (!status.installed) throw new LocalControlServerError("本地服务尚未安装", 409)
    await runPowerShell(status.serverDir, enabled ? "EnableAutostart" : "DisableAutostart", status.port)
    return getLocalControlServerStatus()
  })
}

export function setLocalControlAccessMode(accessMode: LocalControlAccessMode) {
  return withMutationLock(async () => {
    if (accessMode !== "loopback" && accessMode !== "lan") throw new LocalControlServerError("连接范围无效", 400)
    const status = await getLocalControlServerStatus()
    requireWindows(status)
    if (!status.installed) throw new LocalControlServerError("本地服务尚未安装", 409)
    if (status.accessMode === accessMode && !(accessMode === "loopback" && status.firewallNeedsCleanup)) return status

    const previousValues = await readEnvironment(status.serverDir)
    const values = new Map(previousValues)
    const port = portFromEnvironment(values)
    let stopped = false
    let wroteEnvironment = false
    let startedWithNewEnvironment = false
    try {
      if (accessMode === "lan") await runPowerShell(status.serverDir, "SetFirewall", port)
      if (status.running) {
        await stopUnlocked(status.serverDir, previousValues)
        stopped = true
      }
      values.set("HOST", accessMode === "lan" ? "0.0.0.0" : "127.0.0.1")
      await writeEnvironment(status.serverDir, values)
      wroteEnvironment = true
      if (status.running) {
        await startUnlocked(status.serverDir, values)
        startedWithNewEnvironment = true
      }
      if (accessMode === "loopback") await runPowerShell(status.serverDir, "RemoveFirewall")
      return getLocalControlServerStatus()
    } catch (error) {
      if (startedWithNewEnvironment) await stopUnlocked(status.serverDir, values).catch(() => undefined)
      if (wroteEnvironment) await writeEnvironment(status.serverDir, previousValues).catch(() => undefined)
      if (status.running && (stopped || startedWithNewEnvironment)) {
        await startUnlocked(status.serverDir, previousValues).catch(() => undefined)
      }
      throw error
    }
  })
}

export function uninstallLocalControlServer(confirmation: string) {
  return withMutationLock(async () => {
    if (confirmation !== LOCAL_CONTROL_UNINSTALL_CONFIRMATION) {
      throw new LocalControlServerError("卸载确认文字不匹配", 400)
    }
    const status = await getLocalControlServerStatus()
    requireWindows(status)
    const serverDir = status.serverDir
    const paths = managementPaths(serverDir)
    await runPowerShell(serverDir, "DisableAutostart")
    if (status.running) await stopUnlocked(serverDir, await readEnvironment(serverDir))
    await runPowerShell(serverDir, "RemoveFirewall")
    await Promise.all([
      rm(paths.env, { force: true }),
      rm(path.join(serverDir, "data"), { recursive: true, force: true }),
      rm(path.join(serverDir, "dist"), { recursive: true, force: true }),
      rm(path.join(serverDir, "node_modules"), { recursive: true, force: true }),
      rm(paths.stateDir, { recursive: true, force: true }),
    ])
    return getLocalControlServerStatus()
  })
}

export async function getLocalControlDataModifiedAt() {
  const serverDir = await resolveLocalServerDirectory()
  try {
    return (await stat(path.join(serverDir, "data", "nacho.db"))).mtime.toISOString()
  } catch {
    return null
  }
}
