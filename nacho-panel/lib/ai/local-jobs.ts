/* 面板本机后台任务：给 AI 提供“启动长命令并立即返回”的能力。
 * 任务在独立子进程中运行，stdout/stderr 写入受控日志；AI 通过 jobId 查询状态和日志 tail，
 * 不需要用同步 bash 阻塞回合。本文件仅由 Next 服务端（broker / chat route）引用。 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { redactSecrets, truncateMiddle } from "./redact"
import { getAIDataDirectory, getAIWorkspacePath } from "./runtime-paths"

export type LocalJobStatus = "running" | "exited" | "failed" | "stopped"
export type LocalJobShell = "powershell" | "cmd"

type LocalJob = {
  id: string
  uiSessionId: string
  label: string
  command: string
  shell: LocalJobShell
  cwd: string
  pid: number
  child: ChildProcess | null
  logPath: string
  startedAt: number
  endedAt?: number
  exitCode?: number | null
  exitSignal?: NodeJS.Signals | null
  status: LocalJobStatus
  logTruncated: boolean
}

export type LocalJobView = Omit<LocalJob, "child">

export type StartLocalJobInput = {
  uiSessionId: string
  command: string
  cwd?: string
  shell?: LocalJobShell
  label?: string
}

export type LocalJobsManager = {
  directory: string
  start: (input: StartLocalJobInput) => LocalJobView
  get: (jobId: string) => LocalJobView | null
  stop: (jobId: string) => LocalJobView | null
  list: (uiSessionId?: string) => LocalJobView[]
  hasActive: (uiSessionId: string) => boolean
  describe: (jobId: string, tailLines?: number) => string | null
}

const MAX_JOBS = 20
const MAX_LOG_BYTES = 32 * 1024 * 1024
const MAX_TAIL_BYTES = 64 * 1024
const MAX_TAIL_TEXT_BYTES = 8 * 1024
const RETENTION_MS = 24 * 60 * 60 * 1000

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`
}

function view(job: LocalJob): LocalJobView {
  const { child: _child, ...rest } = job
  return rest
}

function readTail(filePath: string, tailLines: number): string {
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    return ""
  }
  if (stat.size <= 0) return ""
  const start = Math.max(0, stat.size - MAX_TAIL_BYTES)
  const length = stat.size - start
  const buffer = Buffer.alloc(length)
  let fd: number
  try {
    fd = fs.openSync(filePath, "r")
  } catch {
    // Windows 上子进程仍以追加模式占用日志时可能暂时无法读；返回空而不破坏工具调用。
    return ""
  }
  try {
    fs.readSync(fd, buffer, 0, length, start)
  } catch {
    return ""
  } finally {
    try {
      fs.closeSync(fd)
    } catch {
      // ignore
    }
  }
  let text = buffer.toString("utf8")
  if (start > 0) {
    const newline = text.indexOf("\n")
    if (newline >= 0) text = text.slice(newline + 1)
  }
  const lines = text.split(/\r?\n/)
  const limit = Math.min(200, Math.max(1, Math.round(tailLines)))
  const tail = lines.slice(-limit).join("\n").trimEnd()
  if (!tail) return ""
  return truncateMiddle(redactSecrets(tail), MAX_TAIL_TEXT_BYTES).text
}

function logIsLarge(logPath: string) {
  try {
    return fs.statSync(logPath).size > MAX_LOG_BYTES
  } catch {
    return false
  }
}

function killJobTree(pid: number) {
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

export function createLocalJobsManager(options: { directory: string; defaultCwd?: string }): LocalJobsManager {
  const jobs = new Map<string, LocalJob>()
  const directory = options.directory
  const defaultCwd = options.defaultCwd || getAIWorkspacePath()

  function ensureDirectory() {
    fs.mkdirSync(directory, { recursive: true })
  }

  function removeJob(job: LocalJob) {
    jobs.delete(job.id)
    try {
      fs.unlinkSync(job.logPath)
    } catch {
      // log already gone
    }
  }

  function prune() {
    const now = Date.now()
    for (const job of [...jobs.values()]) {
      if (job.status === "running") continue
      if (now - (job.endedAt ?? job.startedAt) > RETENTION_MS) removeJob(job)
    }
    while (jobs.size >= MAX_JOBS) {
      const ended = [...jobs.values()]
        .filter((job) => job.status !== "running")
        .sort((a, b) => a.startedAt - b.startedAt)[0]
      if (!ended) break
      removeJob(ended)
    }
  }

  function syncExit(job: LocalJob) {
    if (!job.child) return
    if (job.status !== "running") return
    if (job.child.exitCode === null) return
    job.exitCode = job.child.exitCode
    job.exitSignal = job.child.signalCode
    job.endedAt = job.endedAt ?? Date.now()
    job.status = job.child.exitCode === 0 ? "exited" : "failed"
  }

  function start(input: StartLocalJobInput): LocalJobView {
    const command = input.command?.trim()
    if (!command) throw new Error("command 不能为空")
    const cwd = input.cwd?.trim() || defaultCwd
    let stat: fs.Stats
    try {
      stat = fs.statSync(cwd)
    } catch {
      throw new Error(`工作目录不存在：${cwd}`)
    }
    if (!stat.isDirectory()) throw new Error(`工作目录不是目录：${cwd}`)
    prune()
    ensureDirectory()
    const id = `job-${randomUUID()}`
    const logPath = path.join(directory, `${id}.log`)
    const shell: LocalJobShell = input.shell === "cmd" ? "cmd" : "powershell"
    const executable = shell === "cmd" ? "cmd.exe" : "powershell.exe"
    const args = shell === "cmd"
      ? ["/d", "/s", "/c", command]
      : ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command]
    // 直接把子进程 stdout/stderr 指向日志文件：面板退出或事件循环暂时繁忙时不会丢日志，
    // 也避免两个 pipe 都 end 同一个 Writable 导致输出被提前截断。
    const logFd = fs.openSync(logPath, "a", 0o600)
    let child: ChildProcess
    try {
      child = spawn(executable, args, {
        cwd,
        windowsHide: true,
        detached: false,
        // cmd 的 /c 命令需要原样传递，避免 Node 二次转义；PowerShell 的 -Command 交给默认引号处理。
        windowsVerbatimArguments: process.platform === "win32" && shell === "cmd",
        stdio: ["ignore", logFd, logFd],
      })
    } finally {
      fs.closeSync(logFd)
    }
    // 启动失败（例如可执行文件不存在）会异步触发 error；先挂一个空监听，避免未处理事件。
    child.once("error", () => undefined)
    if (!child.pid) throw new Error("启动本地后台任务失败")
    const job: LocalJob = {
      id,
      uiSessionId: input.uiSessionId,
      label: (input.label?.trim() || command).slice(0, 80),
      command,
      shell,
      cwd,
      pid: child.pid,
      child,
      logPath,
      startedAt: Date.now(),
      status: "running",
      logTruncated: false,
    }
    jobs.set(id, job)
    child.once("exit", (code, signal) => {
      job.exitCode = code
      job.exitSignal = signal
      job.endedAt = Date.now()
      if (job.status !== "stopped") job.status = code === 0 ? "exited" : "failed"
    })
    child.once("close", () => {
      job.child = null
      job.logTruncated = logIsLarge(logPath)
      try {
        fs.appendFileSync(logPath, `\n[nacho] job ${job.status} code=${job.exitCode ?? job.exitSignal ?? "unknown"}\n`)
      } catch {
        // log unavailable
      }
    })
    child.once("error", () => {
      job.endedAt = Date.now()
      job.status = "failed"
    })
    return view(job)
  }

  function get(jobId: string): LocalJobView | null {
    const job = jobs.get(jobId)
    if (!job) return null
    syncExit(job)
    job.logTruncated = logIsLarge(job.logPath)
    return view(job)
  }

  function stop(jobId: string): LocalJobView | null {
    const job = jobs.get(jobId)
    if (!job) return null
    syncExit(job)
    if (job.status === "running") {
      job.status = "stopped"
      job.endedAt = Date.now()
      killJobTree(job.pid)
    }
    return view(job)
  }

  function list(uiSessionId?: string): LocalJobView[] {
    const result: LocalJobView[] = []
    for (const job of [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt)) {
      if (uiSessionId && job.uiSessionId !== uiSessionId) continue
      syncExit(job)
      result.push(view(job))
    }
    return result
  }

  function hasActive(uiSessionId: string): boolean {
    for (const job of jobs.values()) {
      if (job.uiSessionId !== uiSessionId) continue
      syncExit(job)
      if (job.status === "running") return true
    }
    return false
  }

  function describe(jobId: string, tailLines = 80): string | null {
    const job = jobs.get(jobId)
    if (!job) return null
    syncExit(job)
    job.logTruncated = logIsLarge(job.logPath)
    const duration = formatDuration((job.endedAt ?? Date.now()) - job.startedAt)
    const tail = readTail(job.logPath, tailLines)
    return [
      `jobId=${job.id} status=${job.status} pid=${job.pid} shell=${job.shell}`,
      `label=${job.label}`,
      `started=${new Date(job.startedAt).toISOString()} duration=${duration}`,
      ...(job.exitCode !== undefined ? [`exitCode=${job.exitCode ?? "null"}`] : []),
      ...(job.logTruncated ? [`log=large（超过 ${MAX_LOG_BYTES} 字节，仅读取 tail）`] : []),
      `logPath=${job.logPath}`,
      "--- log tail ---",
      tail || "(empty)",
    ].join("\n")
  }

  return { directory, start, get, stop, list, hasActive, describe }
}

let singleton: LocalJobsManager | null = null

export function getLocalJobsManager() {
  if (!singleton) {
    singleton = createLocalJobsManager({
      directory: path.join(getAIDataDirectory(), "ai-jobs"),
      defaultCwd: getAIWorkspacePath(),
    })
  }
  return singleton
}
