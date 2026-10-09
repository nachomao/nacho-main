import { randomBytes, randomUUID } from "node:crypto"
import { execFile, spawn } from "node:child_process"
import { createServer } from "node:net"
import { constants } from "node:fs"
import { access, cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fetchSignedProductIndex } from "./signed-product-index"
import { cloneGitHub, downloadFile, fetchGitHubJson } from "../../desktop/src/github-download.cjs"
import { promisify } from "node:util"
import {
  LOCAL_CONTROL_UNINSTALL_CONFIRMATION,
  type LocalControlAccessMode,
  type LocalControlInstallLog,
  type LocalControlInstallOptions,
  type LocalControlServerStatus,
} from "./local-control-server-types"

const execFileAsync = promisify(execFile)
const DEFAULT_PORT = 8443
const MIN_PORT = 1024
const MAX_PORT = 65535
const HEALTH_TIMEOUT_MS = 15_000
const POWERSHELL_TIMEOUT_MS = 60_000
const STATUS_POWERSHELL_TIMEOUT_MS = 5_000
export const NACHO_SERVER_REPOSITORY = "https://github.com/nachomao/nacho-server.git"
export const NACHO_SERVER_BRANCH = "main"

export class LocalControlServerError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message)
  }
}

type LocalControlProgressReporter = (entry: LocalControlInstallLog) => void

type WindowsRuntimeState = {
  probeError?: string
  running?: boolean
  pid?: number | null
  startedAt?: string | null
  autoStartEnabled?: boolean
  firewallPorts?: number[]
  listeningPorts?: number[]
  portOwnerPid?: number | null
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

export function isLocalControlPortAvailable(port: number, host = "0.0.0.0") {
  return new Promise<boolean>((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(false)
      else reject(error)
    })
    probe.listen({ port, host, exclusive: true }, () => {
      probe.close((error) => (error ? reject(error) : resolve(true)))
    })
  })
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

function managedServerDirectory() {
  if (process.env.NACHO_LOCAL_SERVER_DIR) return path.resolve(process.env.NACHO_LOCAL_SERVER_DIR)
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
  return path.join(localAppData, "NachoPanel", "server")
}

function legacyServerDirectoryCandidates() {
  return [path.resolve(process.cwd(), "server"), path.resolve(process.cwd(), "..", "server")]
}

async function isTrustedServerDirectory(candidate: string) {
  if (path.basename(candidate).toLowerCase() !== "server") return false
  try {
    const manifest = JSON.parse(await readFile(path.join(candidate, "package.json"), "utf8")) as { name?: string }
    return manifest.name === "nacho-server" &&
      await exists(path.join(candidate, "src", "index.ts")) &&
      await exists(path.join(candidate, "deploy", "windows"))
  } catch {
    return false
  }
}

export async function resolveLocalServerDirectory() {
  const candidates = process.env.NACHO_LOCAL_SERVER_DIR
    ? [managedServerDirectory()]
    : [managedServerDirectory(), ...legacyServerDirectoryCandidates()]
  for (const candidate of candidates) {
    if (await isTrustedServerDirectory(candidate)) return candidate
  }
  throw new LocalControlServerError("未找到可信的 server 项目目录，请先从 GitHub 获取服务端代码", 404)
}

async function resolveManagementServerDirectory() {
  const managed = managedServerDirectory()
  if (await isTrustedServerDirectory(managed)) return managed

  // 兼容旧版已安装实例：只有检测到旧目录确实承载过本地服务时才继续使用。
  for (const candidate of legacyServerDirectoryCandidates()) {
    if (!(await isTrustedServerDirectory(candidate))) continue
    if (await exists(managementPaths(candidate).env) || await exists(managementPaths(candidate).distEntry)) {
      return candidate
    }
  }
  return managed
}

async function isGitAvailable() {
  try {
    await execFileAsync("git", ["--version"], { timeout: 10_000, windowsHide: true })
    return true
  } catch {
    return false
  }
}

export function gitCloneArguments(destination: string, repository = NACHO_SERVER_REPOSITORY) {
  return ["clone", "--depth", "1", "--branch", NACHO_SERVER_BRANCH, "--progress", repository, destination]
}

async function installGitForWindows(onProgress?: LocalControlProgressReporter) {
  reportProgress(onProgress, "system", "未检测到 Git，正在下载并静默安装 Git for Windows…\n")
  const onLog = (line: string) => reportProgress(onProgress, "system", `${line}\n`)
  type GitRelease = { tag_name: string; assets: Array<{
    name: string; size: number; browser_download_url: string; digest?: string
  }> }
  const release = await fetchGitHubJson<GitRelease>(
    "https://api.github.com/repos/git-for-windows/git/releases/latest", {
      onLog,
      validate: (value) => !!value && typeof value === "object" &&
        typeof (value as GitRelease).tag_name === "string" && Array.isArray((value as GitRelease).assets),
    })
  const asset = release.assets.find((item) => /^Git-[0-9.]+-64-bit\.exe$/.test(item.name))
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size < 1 ||
      asset.size > 300 * 1024 * 1024 ||
      asset.browser_download_url !== `https://github.com/git-for-windows/git/releases/download/${release.tag_name}/${asset.name}` ||
      (asset.digest && !/^sha256:[a-f0-9]{64}$/.test(asset.digest))) {
    throw new LocalControlServerError("Git for Windows 发布安装包无效", 502)
  }
  const temporary = path.join(os.tmpdir(), `nacho-git-installer-${randomUUID()}`)
  const installer = path.join(temporary, asset.name)
  try {
    await downloadFile(asset.browser_download_url, installer, {
      sizeBytes: asset.size, sha256: asset.digest?.slice(7), timeoutMs: 15 * 60_000, onLog,
    })
    const quoted = installer.replaceAll("'", "''")
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `$process = Start-Process -FilePath '${quoted}' -ArgumentList '/VERYSILENT','/NORESTART','/SUPPRESSMSGBOXES' -Wait -PassThru -WindowStyle Hidden`,
      "if ($process.ExitCode -ne 0) { throw \"Git for Windows 安装失败（退出码 $($process.ExitCode)）\" }",
    ].join("; ")
    await runExecutable("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
      "-ExecutionPolicy", "Bypass", "-Command", command], process.cwd(), 15 * 60_000, onProgress)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  const gitCandidates = [
    path.join(process.env.ProgramFiles || "", "Git", "cmd"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Git", "cmd"),
  ].filter(Boolean)
  process.env.PATH = [...gitCandidates, process.env.PATH || ""].join(path.delimiter)
}

async function ensureGit(onProgress?: LocalControlProgressReporter) {
  if (await isGitAvailable()) {
    reportProgress(onProgress, "system", "已检测到 Git。\n")
    return
  }
  if (process.platform !== "win32") throw new LocalControlServerError("当前系统未检测到 Git，请先安装 Git", 409)
  await installGitForWindows(onProgress)
  if (!(await isGitAvailable())) throw new LocalControlServerError("Git 安装完成后仍未检测到 git 命令", 409)
  reportProgress(onProgress, "system", "Git 安装完成。\n")
}

async function validateClonedServerDirectory(serverDir: string) {
  if (!(await isTrustedServerDirectory(serverDir))) {
    throw new LocalControlServerError("GitHub 服务端源码不完整或项目名不匹配", 502)
  }
  const required = [
    path.join(serverDir, "package-lock.json"),
    path.join(serverDir, "deploy", "windows", "local-control-server.ps1"),
    path.join(serverDir, "deploy", "windows", "start-local-control-server.cjs"),
  ]
  if (!(await Promise.all(required.map(exists))).every(Boolean)) {
    throw new LocalControlServerError("GitHub 服务端源码缺少 Windows 管理文件", 502)
  }
}

async function cloneServerSource(
  serverDir: string,
  onProgress?: LocalControlProgressReporter,
  replaceExisting = false,
) {
  await ensureGit(onProgress)
  const parent = path.dirname(serverDir)
  await mkdir(parent, { recursive: true })
  const temporary = `${serverDir}.download-${randomUUID()}`
  const backup = replaceExisting && await exists(serverDir) ? `${serverDir}.backup-${randomUUID()}` : null
  try {
    reportProgress(onProgress, "system", `正在从 GitHub 获取服务端代码（${NACHO_SERVER_BRANCH}）…\n`)
    await cloneGitHub(NACHO_SERVER_REPOSITORY, temporary, {
      branch: NACHO_SERVER_BRANCH, cwd: parent, timeoutMs: 15 * 60_000,
      onLog: (line) => reportProgress(onProgress, "system", `${line}\n`),
    })
    await validateClonedServerDirectory(temporary)
    if (backup) await rename(serverDir, backup)
    await rename(temporary, serverDir)
    // Git 仓库历史制品不属于服务端升级；保留此前已验证的 Agent 制品。
    await rm(path.join(serverDir, "artifacts"), { recursive: true, force: true })
    if (backup) {
      for (const item of [".env", "data", ".nacho-local", ".nacho-runtime", "artifacts"]) {
        const previous = path.join(backup, item)
        if (await exists(previous)) await cp(previous, path.join(serverDir, item), { recursive: true })
      }
    }
    await mkdir(path.join(serverDir, "artifacts", "windows"), { recursive: true })
    reportProgress(onProgress, "system", "GitHub 服务端源码校验完成。\n")
    return backup
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    if (backup && await exists(backup)) {
      await rm(serverDir, { recursive: true, force: true })
      await rename(backup, serverDir)
    }
    throw error
  }
}

function managementPaths(serverDir: string) {
  const stateDir = path.join(serverDir, ".nacho-local")
  return {
    env: path.join(serverDir, ".env"),
    distEntry: path.join(serverDir, "dist", "index.js"),
    packageLock: path.join(serverDir, "package-lock.json"),
    script: path.join(serverDir, "deploy", "windows", "local-control-server.ps1"),
    launcher: path.join(serverDir, "deploy", "windows", "start-local-control-server.cjs"),
    stateDir,
    backupDist: path.join(stateDir, "backup-dist"),
    backupEnv: path.join(stateDir, "backup.env"),
    managedRuntime: path.join(serverDir, ".nacho-runtime"),
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
  values.set("ALLOW_OPEN_ENROLLMENT", "true")
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
    ["ALLOW_OPEN_ENROLLMENT", "true"],
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

function reportProgress(
  onProgress: LocalControlProgressReporter | undefined,
  stream: LocalControlInstallLog["stream"],
  message: string,
) {
  if (!message || !onProgress) return
  try {
    onProgress({ stream, message })
  } catch {}
}

function formatCommandArgument(value: string) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value
  return `"${value.replaceAll('"', '\\"')}"`
}

export function formatExecutableCommand(file: string, args: string[]) {
  return [file, ...args].map(formatCommandArgument).join(" ")
}

export async function runExecutable(
  file: string,
  args: string[],
  cwd: string,
  timeout = POWERSHELL_TIMEOUT_MS,
  onProgress?: LocalControlProgressReporter,
  completion: "close" | "exit" = "close",
) {
  try {
    if (!onProgress && completion === "close") {
      return await execFileAsync(file, args, {
        cwd,
        timeout,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      })
    }

    reportProgress(onProgress, "command", `$ ${formatExecutableCommand(file, args)}\n`)
    return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(file, args, { cwd, windowsHide: true })
      let stdout = ""
      let stderr = ""
      let outputBytes = 0
      let timedOut = false
      let outputExceeded = false
      let finished = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill()
      }, timeout)
      timer.unref()

      const append = (stream: "stdout" | "stderr", chunk: Buffer | string) => {
        const value = chunk.toString()
        outputBytes += Buffer.byteLength(value)
        if (stream === "stdout") stdout += value
        else stderr += value
        reportProgress(onProgress, stream, value)
        if (outputBytes > 4 * 1024 * 1024) {
          outputExceeded = true
          child.kill()
        }
      }
      child.stdout.on("data", (chunk) => append("stdout", chunk))
      child.stderr.on("data", (chunk) => append("stderr", chunk))
      const finish = (code: number | null) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        if (timedOut) reject(new Error(`命令执行超时（${Math.ceil(timeout / 1000)} 秒）`))
        else if (outputExceeded) reject(new Error("命令输出超过 4 MiB 限制"))
        else if (code === 0) resolve({ stdout, stderr })
        else reject(new Error(stderr.trim() || stdout.trim() || `命令执行失败（退出码 ${code ?? "未知"}）`))
      }
      child.once("error", (error) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        reject(error)
      })
      child.once("exit", (code) => {
        if (completion !== "exit") return
        finish(code)
        child.stdout.destroy()
        child.stderr.destroy()
      })
      child.once("close", finish)
    })
  } catch (error) {
    if (error instanceof LocalControlServerError) throw error
    const detail = error as { stderr?: string; stdout?: string; message?: string }
    const message = detail.stderr?.trim() || detail.stdout?.trim() || detail.message || "本地命令执行失败"
    throw new LocalControlServerError(message)
  }
}

async function runPowerShell(
  serverDir: string,
  action: string,
  port?: number,
  timeout = POWERSHELL_TIMEOUT_MS,
  onProgress?: LocalControlProgressReporter,
) {
  const script = managementPaths(serverDir).script
  if (!(await exists(script))) throw new LocalControlServerError("缺少 Windows 本地服务管理脚本", 500)
  const args = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-Action",
    action,
  ]
  if (port !== undefined) args.push("-Port", String(port))
  if (process.platform === "win32") args.push("-PanelNodePath", process.execPath)
  try {
    return await runExecutable(
      "powershell.exe",
      args,
      serverDir,
      timeout,
      onProgress,
      action === "Start" ? "exit" : "close",
    )
  } catch (error) {
    if (error instanceof LocalControlServerError && /端口 \d+ 已被其他进程占用/.test(error.message)) {
      throw new LocalControlServerError(error.message, 409)
    }
    throw error
  }
}

async function windowsRuntimeState(serverDir: string, port = DEFAULT_PORT): Promise<WindowsRuntimeState> {
  if (process.platform !== "win32") return {}
  if (!(await exists(managementPaths(serverDir).script))) return {}
  try {
    const { stdout } = await runPowerShell(serverDir, "Status", port, STATUS_POWERSHELL_TIMEOUT_MS)
    const line = stdout.trim().split(/\r?\n/).at(-1)
    if (!line) return { probeError: "状态命令未返回结果" }
    return JSON.parse(line) as WindowsRuntimeState
  } catch (error) {
    return { probeError: error instanceof Error ? error.message : "状态命令执行失败" }
  }
}

export function resolveLocalControlRuntimeStatus(input: {
  platformSupported: boolean
  installed: boolean
  runtimeProbeSucceeded: boolean
  running: boolean
  healthy: boolean
}): LocalControlServerStatus["runtimeStatus"] {
  if (!input.platformSupported) return "unsupported"
  if (!input.installed) return "not-installed"
  if (!input.runtimeProbeSucceeded) return "unhealthy"
  if (!input.running) return "stopped"
  return input.healthy ? "running" : "unhealthy"
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

async function runNpm(
  args: string[],
  serverDir: string,
  timeout: number,
  onProgress?: LocalControlProgressReporter,
) {
  const invocation = createNpmInvocation(args)
  return runExecutable(invocation.file, invocation.args, serverDir, timeout, onProgress)
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
  const serverDir = await resolveManagementServerDirectory()

  const paths = managementPaths(serverDir)
  const values = await readEnvironment(serverDir)
  const port = portFromEnvironment(values)
  const [envExists, distExists, lockExists, scriptExists, launcherExists, git, runtime] = await Promise.all([
    exists(paths.env),
    exists(paths.distEntry),
    exists(paths.packageLock),
    exists(paths.script),
    exists(paths.launcher),
    isGitAvailable(),
    windowsRuntimeState(serverDir, port),
  ])
  const node = runtime.nodeReady === true
  const npm = runtime.npmAvailable === true
  const runtimeProbeSucceeded = runtime.probeError === undefined
  const source = lockExists && scriptExists && launcherExists
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
  const portOwnerPid = runtime.portOwnerPid || null
  const issues: string[] = []

  if (!platformSupported) issues.push("本地控制服务管理仅支持 Windows")
  if (!runtimeProbeSucceeded) issues.push("本机服务状态检测失败，请刷新后重试")
  if (!git) issues.push("未检测到 Git，安装时将自动下载并安装")
  if (runtimeProbeSucceeded && !node) issues.push("安装时将重新检测并补齐 Node.js 22+")
  if (runtimeProbeSucceeded && !npm) issues.push("安装时将从 Node.js 目录与 cmd.exe 重新检测并补齐 npm")
  if (!source) issues.push("安装时将从 GitHub 获取服务端源码")
  if (envExists !== distExists) issues.push("本地服务安装不完整，需要修复")
  if (configNeedsRepair) issues.push("本地服务配置缺失或不安全，需要修复")
  if (running && !ownsConfiguredListener) issues.push(`受管进程未监听配置端口 ${port}`)
  else if (running && !healthy) issues.push("进程正在运行，但健康检查失败")
  if (accessMode === "lan" && !firewallEnabled) issues.push("局域网模式尚未完成 Windows 防火墙放行")
  if (firewallNeedsCleanup) issues.push("检测到不再需要的 Windows 防火墙规则")
  if (!running && portOwnerPid) issues.push(`端口 ${port} 已被进程 ${portOwnerPid} 占用`)

  const runtimeStatus = resolveLocalControlRuntimeStatus({
    platformSupported,
    installed,
    runtimeProbeSucceeded,
    running,
    healthy,
  })

  const key = values.get("PANEL_API_KEY")
  let version: string | null = null
  try {
    const manifest = JSON.parse(await readFile(path.join(serverDir, "package.json"), "utf8")) as { version?: string }
    if (typeof manifest.version === "string" && /^\d+\.\d+\.\d+$/.test(manifest.version)) version = manifest.version
  } catch { /* 未安装时没有版本 */ }
  const localAddresses = localIpv4Addresses()
  return {
    platformSupported,
    runtimeStatus,
    installed,
    running,
    healthy,
    needsRepair: (runtimeProbeSucceeded && installed && (!node || !npm)) || envExists !== distExists || configNeedsRepair || firewallNeedsCleanup || (running && !healthy),
    pid: runtime.pid || null,
    startedAt: runtime.startedAt || null,
    autoStartEnabled: runtime.autoStartEnabled === true,
    accessMode,
    host: values.get("HOST") || "127.0.0.1",
    port,
    firewallEnabled,
    firewallNeedsCleanup,
    portOwnerPid,
    serverDir,
    version,
    databasePath: databasePathFromEnvironment(serverDir, values),
    localAddresses,
    connection: installed && key ? { api: localApi(port), agentApi: localAgentApi(accessMode, port, localAddresses), key } : null,
    prerequisites: {
      git,
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

async function startUnlocked(
  serverDir: string,
  values: EnvironmentMap,
  onProgress?: LocalControlProgressReporter,
) {
  if (!(await exists(managementPaths(serverDir).distEntry))) {
    throw new LocalControlServerError("缺少服务端构建产物，请先安装或修复", 409)
  }
  const port = portFromEnvironment(values)
  if (!(await isLocalControlPortAvailable(port))) {
    throw new LocalControlServerError(`端口 ${port} 已被其他进程占用，请更换监听端口后重试`, 409)
  }
  await runPowerShell(serverDir, "Start", port, POWERSHELL_TIMEOUT_MS, onProgress)
  reportProgress(onProgress, "system", `正在等待端口 ${port} 通过健康检查…\n`)
  await waitForHealth(serverDir, port)
  reportProgress(onProgress, "system", `控制服务已在端口 ${port} 上通过健康检查。\n`)
}

async function ensureRuntimePrerequisites(
  serverDir: string,
  onProgress?: LocalControlProgressReporter,
) {
  reportProgress(onProgress, "system", "正在检查 Node.js 22+ 与 npm…\n")
  const runtime = await windowsRuntimeState(serverDir)
  if (runtime.nodeReady && runtime.npmAvailable) {
    reportProgress(onProgress, "system", `已检测到可用运行环境：Node.js ${runtime.nodeVersion || "22+"}、npm。\n`)
    return
  }

  reportProgress(onProgress, "system", "未检测到完整运行环境，正在安装并校验 Node.js LTS 与 npm…\n")
  await runPowerShell(serverDir, "InstallRuntime", undefined, 15 * 60_000, onProgress)
  const installedRuntime = await windowsRuntimeState(serverDir)
  if (!installedRuntime.nodeReady || !installedRuntime.npmAvailable) {
    throw new LocalControlServerError("Node.js LTS 安装完成后仍未检测到可用的 Node.js 22+ 与 npm", 409)
  }
  reportProgress(onProgress, "system", `运行环境准备完成：Node.js ${installedRuntime.nodeVersion || "22+"}、npm。\n`)
}

async function buildServer(serverDir: string, onProgress?: LocalControlProgressReporter) {
  reportProgress(onProgress, "system", "正在安装服务端依赖并生成构建产物…\n")
  if (process.platform === "win32") {
    await runPowerShell(serverDir, "Build", undefined, 15 * 60_000, onProgress)
  } else {
    await runNpm(["ci", "--no-audit", "--no-fund"], serverDir, 10 * 60_000, onProgress)
    await runNpm(["run", "build"], serverDir, 5 * 60_000, onProgress)
  }
  reportProgress(onProgress, "system", "依赖安装与服务端构建已完成。\n")
}

let mutationQueue: Promise<unknown> = Promise.resolve()
function withMutationLock<T>(operation: () => Promise<T>) {
  const result = mutationQueue.then(operation, operation)
  mutationQueue = result.catch(() => undefined)
  return result
}

export function installLocalControlServer(
  options: LocalControlInstallOptions,
  onProgress?: LocalControlProgressReporter,
) {
  return withMutationLock(async () => {
    reportProgress(onProgress, "system", "正在检查本机安装环境与监听端口…\n")
    const port = options.port ?? DEFAULT_PORT
    if (!isValidLocalControlPort(port)) throw new LocalControlServerError("端口必须是 1024-65535 之间的整数", 400)
    if (options.accessMode !== "loopback" && options.accessMode !== "lan") {
      throw new LocalControlServerError("连接范围无效", 400)
    }
    const status = await getLocalControlServerStatus()
    requireWindows(status)
    if (!(await isLocalControlPortAvailable(port))) {
      throw new LocalControlServerError(`端口 ${port} 已被其他进程占用，请更换监听端口后重试`, 409)
    }
    if (status.installed) throw new LocalControlServerError("本地服务已经安装", 409)
    if (status.needsRepair) throw new LocalControlServerError("检测到已有配置或构建产物，请使用修复功能以保留现有数据与密钥", 409)

    const serverDir = status.serverDir
    const sourceExisted = await exists(serverDir)
    const [environmentExisted, distDirectoryExisted, nodeModulesExisted, managedRuntimeExisted, stateDirectoryExisted] = await Promise.all([
      exists(path.join(serverDir, ".env")),
      exists(path.join(serverDir, "dist")),
      exists(path.join(serverDir, "node_modules")),
      exists(path.join(serverDir, ".nacho-runtime")),
      exists(path.join(serverDir, ".nacho-local")),
    ])

    let firewallConfigured = false
    let autoStartConfigured = false
    let sourceBackup: string | null = null
    let sourceCloned = false
    try {
      if (!status.prerequisites.source) {
        sourceBackup = await cloneServerSource(serverDir, onProgress, sourceExisted)
        sourceCloned = true
      }
      const paths = managementPaths(serverDir)
      await runPowerShell(serverDir, "AssertPortAvailable", port, POWERSHELL_TIMEOUT_MS, onProgress)
      reportProgress(onProgress, "system", `端口 ${port} 可用，开始安装。\n`)
      await ensureRuntimePrerequisites(serverDir, onProgress)
      await buildServer(serverDir, onProgress)
      if (options.accessMode === "lan") {
        reportProgress(onProgress, "system", "正在配置仅限 Private 网络与 LocalSubnet 的防火墙规则…\n")
        await runPowerShell(serverDir, "SetFirewall", port, POWERSHELL_TIMEOUT_MS, onProgress)
        firewallConfigured = true
      }
      reportProgress(onProgress, "system", "正在写入本机服务配置…\n")
      const values = createInitialEnvironment({ accessMode: options.accessMode, autoStart: options.autoStart, port })
      await writeEnvironment(serverDir, values)
      if (options.autoStart) {
        reportProgress(onProgress, "system", "正在配置当前 Windows 用户登录后自动启动…\n")
        await runPowerShell(serverDir, "EnableAutostart", port, POWERSHELL_TIMEOUT_MS, onProgress)
        autoStartConfigured = true
      }
      reportProgress(onProgress, "system", "正在启动本机控制服务…\n")
      await startUnlocked(serverDir, values, onProgress)
      if (sourceBackup) await rm(sourceBackup, { recursive: true, force: true })
      const finalStatus = await getLocalControlServerStatus()
      reportProgress(onProgress, "system", "安装完成，正在载入运行状态与访问参数。\n")
      return finalStatus
    } catch (error) {
      reportProgress(onProgress, "system", "安装未完成，正在回滚本次创建的文件与设置…\n")
      if (await exists(managementPaths(serverDir).script)) {
        await runPowerShell(serverDir, "ForceStop", port).catch(() => undefined)
        if (autoStartConfigured) await runPowerShell(serverDir, "DisableAutostart", port).catch(() => undefined)
        if (firewallConfigured) await runPowerShell(serverDir, "RemoveFirewall", port).catch(() => undefined)
      }
      await Promise.all([
        environmentExisted ? Promise.resolve() : rm(path.join(serverDir, ".env"), { force: true }),
        distDirectoryExisted ? Promise.resolve() : rm(path.join(serverDir, "dist"), { recursive: true, force: true }),
        nodeModulesExisted ? Promise.resolve() : rm(path.join(serverDir, "node_modules"), { recursive: true, force: true }),
        managedRuntimeExisted ? Promise.resolve() : rm(path.join(serverDir, ".nacho-runtime"), { recursive: true, force: true }),
        stateDirectoryExisted ? Promise.resolve() : rm(path.join(serverDir, ".nacho-local"), { recursive: true, force: true }),
      ])
      if (sourceCloned) {
        await rm(serverDir, { recursive: true, force: true })
        if (sourceBackup) await rename(sourceBackup, serverDir)
      }
      reportProgress(onProgress, "system", "回滚完成。\n")
      throw error
    }
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
    const previousPaths = managementPaths(serverDir)
    const envExisted = await exists(previousPaths.env)
    const previousValues = envExisted ? await readEnvironment(serverDir) : new Map<string, string>()
    const values = envExisted
      ? ensureManagedEnvironment(previousValues)
      : createInitialEnvironment({ accessMode: "loopback", autoStart: true, port: DEFAULT_PORT })
    const wasRunning = status.running
    if (wasRunning) await stopUnlocked(serverDir, previousValues)
    let sourceBackup: string | null = null
    try {
      sourceBackup = await cloneServerSource(serverDir, undefined, await exists(serverDir))
      const paths = managementPaths(serverDir)
      if (!status.installed && !wasRunning) {
        await runPowerShell(serverDir, "AssertPortAvailable", portFromEnvironment(values))
      }
      await ensureRuntimePrerequisites(serverDir)
      await buildServer(serverDir)
      if (accessModeFromEnvironment(values) === "lan") {
        await runPowerShell(serverDir, "SetFirewall", portFromEnvironment(values))
      } else if (status.firewallNeedsCleanup) {
        await runPowerShell(serverDir, "RemoveFirewall", portFromEnvironment(values))
      }
      await writeEnvironment(serverDir, values)
      if (wasRunning || !status.installed) await startUnlocked(serverDir, values)
      if (sourceBackup) await rm(sourceBackup, { recursive: true, force: true })
    } catch (error) {
      if (sourceBackup && await exists(sourceBackup)) {
        await rm(serverDir, { recursive: true, force: true })
        await rename(sourceBackup, serverDir)
      }
      if (wasRunning && (await exists(managementPaths(serverDir).distEntry))) {
        await startUnlocked(serverDir, previousValues).catch(() => undefined)
      }
      throw error
    }
    return getLocalControlServerStatus()
  })
}

/** Windows 本机服务只安装签名索引中固定版本的预构建制品，不克隆 main 分支。 */
export function updateLocalControlServer(version: string, panelVersion: string) {
  return withMutationLock(async () => {
    const status = await getLocalControlServerStatus()
    requireWindows(status)
    if (!status.installed) throw new LocalControlServerError("本机服务尚未安装", 409)
    const index = await fetchSignedProductIndex()
    const target = index.releases.server
    const strict = /^\d+\.\d+\.\d+$/
    if (!strict.test(version) || version !== target.version) throw new LocalControlServerError("目标不是已签名的服务端发布", 409)
    const compare = (a: string, b: string) => {
      const left = a.split(".").map(Number), right = b.split(".").map(Number)
      for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1
      return 0
    }
    if (!strict.test(panelVersion) || compare(panelVersion, target.minPanelVersion) < 0) {
      throw new LocalControlServerError("请先升级面板", 409)
    }
    if (!status.connection) throw new LocalControlServerError("无法验证本机服务连接", 409)
    const clientsResponse = await fetch(`${status.connection.api}/api/panel/clients`, {
      headers: { Authorization: `Bearer ${status.connection.key}` },
      signal: AbortSignal.timeout(8_000),
    })
    if (!clientsResponse.ok) throw new LocalControlServerError("无法验证现有 Agent 兼容性", 409)
    const clientsEnvelope = await clientsResponse.json() as {
      ok: boolean
      data?: Array<{ os: string; status: string; version: string }>
    }
    if (!clientsEnvelope.ok || !Array.isArray(clientsEnvelope.data)) {
      throw new LocalControlServerError("无法验证现有 Agent 兼容性", 409)
    }
    const incompatible = clientsEnvelope.data.filter((client) => client.os === "Windows" && client.status !== "unregistered" &&
      (!strict.test(client.version) || compare(client.version, target.minAgentVersion) < 0))
    if (incompatible.length) throw new LocalControlServerError(`有 ${incompatible.length} 台 Agent 不兼容目标服务端，请先手动升级`, 409)
    const serverDir = status.serverDir
    const current = JSON.parse(await readFile(path.join(serverDir, "package.json"), "utf8")) as { version: string }
    if (!strict.test(current.version) || compare(current.version, version) >= 0) {
      throw new LocalControlServerError("目标版本必须高于当前本机服务", 409)
    }
    const temporary = `${serverDir}.release-${randomUUID()}`
    const archive = `${temporary}.zip`
    const backup = path.join(serverDir, `.nacho-update-backup-${randomUUID()}`)
    const items = ["dist", "node_modules", "package.json", "package-lock.json", "deploy"]
    const values = await readEnvironment(serverDir)
    const wasRunning = status.running
    const database = status.databasePath
    const databaseFiles = [database, `${database}-wal`, `${database}-shm`]
    let stopped = false
    let backedUp = false
    let switched = false
    try {
      await mkdir(temporary, { recursive: true })
      const sourceAsset = index.schemaVersion === 3 ? target.source : target.windows
      if (!sourceAsset) throw new LocalControlServerError("服务端发布缺少源码制品", 502)
      await downloadFile(sourceAsset.url, archive, {
        sizeBytes: sourceAsset.sizeBytes, sha256: sourceAsset.sha256, timeoutMs: 15 * 60_000,
        onLog: (line) => console.info(line),
      })
      const entries = (await runExecutable("tar", ["-tf", archive], path.dirname(serverDir), 60_000)).stdout
      if (entries.split(/\r?\n/).filter(Boolean).some((entry) => {
        const name = entry.replaceAll("\\", "/")
        return name.startsWith("/") || /(^|\/)\.\.(\/|$)/.test(name) ||
          !(index.schemaVersion === 3
            ? /^(src|deploy|client|package\.json|package-lock\.json|tsconfig\.json)(\/|$)/.test(name)
            : /^(dist|node_modules|package\.json|package-lock\.json|deploy)(\/|$)/.test(name))
      })) throw new LocalControlServerError("Windows 发布包包含无效路径", 502)
      const types = (await runExecutable("tar", ["-tvf", archive], path.dirname(serverDir), 60_000)).stdout
      if (types.split(/\r?\n/).filter(Boolean).some((line) => !["-", "d"].includes(line[0]))) {
        throw new LocalControlServerError("发布包包含链接或特殊文件", 502)
      }
      await runExecutable("tar", ["-xf", archive, "-C", temporary], path.dirname(serverDir), 5 * 60_000)
      if (index.schemaVersion === 3) {
        await runNpm(["ci", "--no-audit", "--no-fund"], temporary, 10 * 60_000)
        await runNpm(["run", "build"], temporary, 10 * 60_000)
        await rm(path.join(temporary, "node_modules"), { recursive: true, force: true })
        await runNpm(["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
          temporary, 10 * 60_000)
      }
      const manifest = JSON.parse(await readFile(path.join(temporary, "package.json"), "utf8")) as { name: string; version: string }
      if (manifest.name !== "nacho-server" || manifest.version !== version ||
          !(await exists(path.join(temporary, "dist", "index.js"))) ||
          !(await exists(path.join(temporary, "deploy", "windows", "local-control-server.ps1"))) ||
          !(await exists(path.join(temporary, "node_modules")))) {
        throw new LocalControlServerError("Windows 发布包内容不完整", 502)
      }
      if (wasRunning) {
        await stopUnlocked(serverDir, values)
        stopped = true
      }
      await mkdir(backup, { recursive: true })
      await mkdir(path.join(backup, "database"), { recursive: true })
      for (let i = 0; i < databaseFiles.length; i++) {
        if (await exists(databaseFiles[i])) await cp(databaseFiles[i], path.join(backup, "database", String(i)))
      }
      backedUp = true
      for (const item of items) {
        const oldFile = path.join(serverDir, item)
        if (await exists(oldFile)) await rename(oldFile, path.join(backup, item))
        switched = true
        await rename(path.join(temporary, item), oldFile)
      }
      if (wasRunning) await startUnlocked(serverDir, values)
      const installed = JSON.parse(await readFile(path.join(serverDir, "package.json"), "utf8")) as { version: string }
      if (installed.version !== version) throw new LocalControlServerError("升级后版本验证失败", 502)
      await rm(backup, { recursive: true, force: true })
      return getLocalControlServerStatus()
    } catch (error) {
      if (switched) {
        if (wasRunning) await stopUnlocked(serverDir, values).catch(() => undefined)
        for (const item of items) {
          const oldFile = path.join(backup, item)
          if (await exists(oldFile)) {
            await rm(path.join(serverDir, item), { recursive: true, force: true })
            await rename(oldFile, path.join(serverDir, item))
          }
        }
      }
      if (backedUp && stopped) {
        for (let i = 0; i < databaseFiles.length; i++) {
          const snapshot = path.join(backup, "database", String(i))
          if (await exists(snapshot)) await cp(snapshot, databaseFiles[i])
          else await rm(databaseFiles[i], { force: true })
        }
      }
      if (stopped && wasRunning) await startUnlocked(serverDir, values).catch(() => undefined)
      throw error
    } finally {
      await rm(archive, { force: true })
      await rm(temporary, { recursive: true, force: true })
    }
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

export function setLocalControlPort(port: number) {
  return withMutationLock(async () => {
    if (!isValidLocalControlPort(port)) throw new LocalControlServerError("端口必须是 1024-65535 之间的整数", 400)
    const status = await getLocalControlServerStatus()
    requireWindows(status)
    if (!status.installed) throw new LocalControlServerError("本地服务尚未安装", 409)
    if (status.port === port) return status
    if (!(await isLocalControlPortAvailable(port))) {
      throw new LocalControlServerError(`端口 ${port} 已被其他进程占用，请更换监听端口后重试`, 409)
    }

    const previousValues = await readEnvironment(status.serverDir)
    const values = new Map(previousValues)
    const wasRunning = status.running
    let wroteEnvironment = false
    let startedWithNewPort = false
    try {
      if (wasRunning) await stopUnlocked(status.serverDir, previousValues)
      values.set("PORT", String(port))
      await writeEnvironment(status.serverDir, values)
      wroteEnvironment = true
      if (status.autoStartEnabled) await runPowerShell(status.serverDir, "EnableAutostart", port)
      if (status.accessMode === "lan") await runPowerShell(status.serverDir, "SetFirewall", port)
      if (wasRunning) {
        await startUnlocked(status.serverDir, values)
        startedWithNewPort = true
      }
      return getLocalControlServerStatus()
    } catch (error) {
      if (startedWithNewPort) await stopUnlocked(status.serverDir, values).catch(() => undefined)
      if (wroteEnvironment) await writeEnvironment(status.serverDir, previousValues).catch(() => undefined)
      if (status.autoStartEnabled) await runPowerShell(status.serverDir, "EnableAutostart", status.port).catch(() => undefined)
      if (status.accessMode === "lan") await runPowerShell(status.serverDir, "SetFirewall", status.port).catch(() => undefined)
      if (wasRunning) await startUnlocked(status.serverDir, previousValues).catch(() => undefined)
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
      rm(paths.managedRuntime, { recursive: true, force: true }),
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
