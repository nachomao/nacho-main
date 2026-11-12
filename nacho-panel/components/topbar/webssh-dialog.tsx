"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Eraser, FolderUp, Loader2, RotateCcw, SquareTerminal, Unplug, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { statusMeta, type Client } from "@/components/clients/client-data"
import { useServerData } from "@/components/server-data-context"
import { ModalShell, OverlayHeader } from "./overlay"
import { FilesPanel } from "./webssh-files-panel"
import {
  buildWebSocketUrl,
  parseTerminalServerMessage,
  splitTerminalChunk,
  terminalSizeFromPixels,
  TERMINAL_MAX_LINES,
  type TerminalServerMessage,
  type TerminalSessionResponse,
  type TerminalShell,
} from "@/lib/webssh"

type LineKind = "remote" | "cmd" | "sys" | "err"
type Line = { id: number; text: string; kind: LineKind }
type SessionStatus = "connecting" | "ready" | "reconnecting" | "closed" | "error"

type SessionView = {
  clientId: string
  sessionId: string | null
  shell: TerminalShell
  status: SessionStatus
  lines: Line[]
  partial: string
  history: string[]
  historyIndex: number
  startedAt: number | null
  lastSeq: number
  agentAttached: boolean
  cwd: string | null
  error: string | null
}

let lineId = 0
const mkLine = (text: string, kind: LineKind = "remote"): Line => ({ id: ++lineId, text, kind })
const MAX_RENDERED_LINES = TERMINAL_MAX_LINES
const MAX_RECONNECT_ATTEMPTS = 3

const emptySession = (clientId: string, shell: TerminalShell): SessionView => ({
  clientId,
  sessionId: null,
  shell,
  status: "connecting",
  lines: [],
  partial: "",
  history: [],
  historyIndex: -1,
  startedAt: null,
  lastSeq: 0,
  agentAttached: false,
  cwd: null,
  error: null,
})

const clampLines = (lines: Line[]) => (lines.length > MAX_RENDERED_LINES ? lines.slice(lines.length - MAX_RENDERED_LINES) : lines)

/** 把服务端结束原因转成面板文案。 */
function closeReasonLabel(reason: string): string {
  switch (reason) {
    case "shell-exit":
      return "Shell 已退出"
    case "panel-closed":
      return "会话已被关闭"
    case "idle-timeout":
      return "空闲超时，会话已结束"
    case "max-duration":
      return "达到最长会话时长，会话已结束"
    case "output-limit":
      return "输出超过上限，会话已结束"
    case "agent-disconnected":
    case "panel-disconnected":
      return "连接已断开，会话已结束"
    case "server-shutdown":
      return "服务端正在关闭，会话已结束"
    case "closed":
      return "会话已关闭"
    default:
      return `会话已结束（${reason}）`
  }
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const pad = (value: number) => String(value).padStart(2, "0")
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`
}

/** 当前 Agent 支持的真实 Shell 会话：仅在线且已建立实时通道的 Windows 设备。 */
function terminalReady(client: Client): boolean {
  return client.os === "Windows" && client.connected && (client.status === "online" || client.status === "warning")
}

function ineligibleReason(client: Client): string | null {
  if (client.os !== "Windows") return "当前仅 Windows Agent 支持实时终端"
  if (client.status === "unregistered") return "已注销设备不可用"
  if (client.status === "offline") return "设备离线"
  if (!client.connected) return "设备未建立实时通道"
  return null
}

const QUICK_COMMANDS = ["whoami", "hostname", "ipconfig", "dir", "tasklist"]

/**
 * 远程终端 WebSSH：
 * 面板创建终端会话后通过 WebSocket 连接服务端，由服务端转发到 Agent 的持久 Shell。
 * 支持多客户端会话、↑/↓ 历史、窗口尺寸同步、断线自动重连与输出回放。
 */
export function WebSSHDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { clients, apiRequest, serverBaseUrl, serverConnection, developerPreview } = useServerData()
  const [sessions, setSessions] = useState<Record<string, SessionView>>({})
  const [targetId, setTargetId] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [shell, setShell] = useState<TerminalShell>("powershell")
  const [mode, setMode] = useState<"term" | "files">("term")
  const [now, setNow] = useState(() => Date.now())
  const sessionsRef = useRef<Record<string, SessionView>>({})
  const socketsRef = useRef<Map<string, { ws: WebSocket | null; intentional: boolean; attempts: number; timer: number | null }>>(new Map())
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const sizeRef = useRef({ cols: 120, rows: 30 })
  const openSocketRef = useRef<((clientId: string, response: TerminalSessionResponse, wsPath: string) => void) | null>(null)

  sessionsRef.current = sessions

  const patchSession = useCallback((clientId: string, patch: (view: SessionView) => SessionView) => {
    setSessions((prev) => {
      const current = prev[clientId]
      if (!current) return prev
      return { ...prev, [clientId]: patch(current) }
    })
  }, [])

  const pushLine = useCallback((clientId: string, text: string, kind: LineKind) => {
    patchSession(clientId, (view) => {
      const lines = [...view.lines]
      if (view.partial) lines.push(mkLine(view.partial, "remote"))
      lines.push(mkLine(text, kind))
      return { ...view, lines: clampLines(lines), partial: "" }
    })
  }, [patchSession])

  const sendTo = useCallback((clientId: string, message: Record<string, unknown>) => {
    const state = socketsRef.current.get(clientId)
    if (!state?.ws || state.ws.readyState !== WebSocket.OPEN) return false
    try {
      state.ws.send(JSON.stringify(message))
      return true
    } catch {
      return false
    }
  }, [])

  const disconnectSession = useCallback((clientId: string, terminate: boolean, reason: string, silent = false) => {
    const state = socketsRef.current.get(clientId)
    if (state) {
      state.intentional = true
      if (state.timer) window.clearTimeout(state.timer)
      try { state.ws?.close() } catch { /* 已关闭 */ }
      socketsRef.current.delete(clientId)
    }
    if (terminate) {
      const sessionId = sessionsRef.current[clientId]?.sessionId
      if (sessionId) {
        void apiRequest(`/terminal/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch(() => {})
      }
    }
    if (!silent) pushLine(clientId, reason, "sys")
  }, [apiRequest, pushLine])

  const handleServerMessage = useCallback((clientId: string, message: TerminalServerMessage) => {
    switch (message.kind) {
      case "ready": {
        const state = socketsRef.current.get(clientId)
        if (state) state.attempts = 0
        patchSession(clientId, (view) => ({
          ...view,
          sessionId: message.sessionId,
          shell: message.shell,
          status: "ready",
          startedAt: message.startedAt,
          lastSeq: Math.max(view.lastSeq, message.seq),
          agentAttached: message.agentAttached,
          error: null,
          lines: message.reconnected
            ? clampLines([...view.lines, mkLine("已重新连接会话，断线期间的输出已回放。", "sys")])
            : view.lines,
        }))
        if (!message.agentAttached) pushLine(clientId, "等待 Agent 接入 Shell 会话…", "sys")
        requestAnimationFrame(() => inputRef.current?.focus())
        return
      }
      case "agent-connected":
        patchSession(clientId, (view) => ({ ...view, agentAttached: true }))
        return
      case "agent-ready":
        patchSession(clientId, (view) => ({ ...view, agentAttached: true, cwd: message.cwd }))
        pushLine(clientId, message.cwd ? `Shell 已就绪，当前目录 ${message.cwd}` : "Shell 已就绪", "sys")
        requestAnimationFrame(() => inputRef.current?.focus())
        return
      case "output":
        patchSession(clientId, (view) => {
          if (message.seq <= view.lastSeq) return view
          const chunk = splitTerminalChunk(view.partial, message.data)
          const lines = [...view.lines, ...chunk.lines.map((text) => mkLine(text, "remote"))]
          return { ...view, lastSeq: message.seq, lines: clampLines(lines), partial: chunk.partial }
        })
        return
      case "exit": {
        const state = socketsRef.current.get(clientId)
        if (state) {
          state.intentional = true
          if (state.timer) window.clearTimeout(state.timer)
          socketsRef.current.delete(clientId)
          try { state.ws?.close() } catch { /* 已关闭 */ }
        }
        patchSession(clientId, (view) => {
          const lines = [...view.lines]
          if (view.partial) lines.push(mkLine(view.partial, "remote"))
          lines.push(mkLine(closeReasonLabel(message.reason), "sys"))
          if (message.truncated) lines.push(mkLine("输出已截断。", "err"))
          return { ...view, status: "closed", agentAttached: false, partial: "", lines: clampLines(lines) }
        })
        return
      }
      case "error":
        pushLine(clientId, message.message, "err")
        return
      default:
        return
    }
  }, [patchSession, pushLine])

  const scheduleReconnect = useCallback((clientId: string) => {
    const state = socketsRef.current.get(clientId)
    if (!state) return
    if (state.attempts >= MAX_RECONNECT_ATTEMPTS) {
      socketsRef.current.delete(clientId)
      patchSession(clientId, (view) => ({ ...view, status: "error", agentAttached: false, error: "重连失败，请手动重新连接" }))
      pushLine(clientId, "自动重连失败，请点击「重新连接」。", "err")
      return
    }
    state.attempts += 1
    const attempt = state.attempts
    state.timer = window.setTimeout(() => {
      const view = sessionsRef.current[clientId]
      if (!view?.sessionId) return
      patchSession(clientId, (current) => ({ ...current, status: "reconnecting" }))
      void apiRequest<TerminalSessionResponse>(`/terminal/sessions/${encodeURIComponent(view.sessionId)}/reconnect`, { method: "POST" })
        .then((response) => {
          if (!sessionsRef.current[clientId]) return
          const since = sessionsRef.current[clientId]?.lastSeq ?? 0
          openSocketRef.current?.(clientId, response, `${response.wsPath}&since=${since}`)
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "重连失败"
          if (attempt >= MAX_RECONNECT_ATTEMPTS) {
            socketsRef.current.delete(clientId)
            patchSession(clientId, (current) => ({ ...current, status: "error", error: message }))
            pushLine(clientId, `重连失败：${message}`, "err")
          } else {
            scheduleReconnect(clientId)
          }
        })
    }, 800 * attempt)
  }, [apiRequest, patchSession, pushLine])

  const openSocket = useCallback((clientId: string, response: TerminalSessionResponse, wsPath: string) => {
    if (!serverConnection) return
    const url = buildWebSocketUrl(serverBaseUrl, wsPath)
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (error) {
      patchSession(clientId, (view) => ({
        ...view,
        status: "error",
        error: error instanceof Error ? error.message : "无法建立 WebSocket 连接",
      }))
      return
    }
    const state = { ws: ws as WebSocket | null, intentional: false, attempts: socketsRef.current.get(clientId)?.attempts ?? 0, timer: null }
    socketsRef.current.set(clientId, state)
    patchSession(clientId, (view) => ({ ...view, sessionId: response.session.id, shell: response.session.shell, status: "connecting" }))

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return
      const message = parseTerminalServerMessage(event.data)
      if (message) handleServerMessage(clientId, message)
    }
    ws.onclose = () => {
      const current = socketsRef.current.get(clientId)
      if (!current || current.ws !== ws) return
      if (current.intentional) return
      const view = sessionsRef.current[clientId]
      if (!view || view.status === "closed" || view.status === "error") return
      patchSession(clientId, (existing) => ({ ...existing, status: "reconnecting", agentAttached: false }))
      if (view.sessionId) {
        pushLine(clientId, "实时连接中断，正在尝试重连…", "sys")
        scheduleReconnect(clientId)
      } else {
        socketsRef.current.delete(clientId)
        patchSession(clientId, (existing) => ({ ...existing, status: "error", error: "连接中断" }))
        pushLine(clientId, "连接中断，请重新连接。", "err")
      }
    }
    ws.onerror = () => { /* close 事件负责重连 */ }
  }, [handleServerMessage, patchSession, pushLine, scheduleReconnect, serverBaseUrl, serverConnection])

  openSocketRef.current = openSocket

  const startSession = useCallback(async (clientId: string, shellKind: TerminalShell) => {
    if (!serverConnection) {
      patchSession(clientId, (view) => ({ ...view, status: "error", error: "尚未连接控制服务端" }))
      return
    }
    try {
      const size = sizeRef.current
      const response = await apiRequest<TerminalSessionResponse>("/terminal/sessions", {
        method: "POST",
        body: JSON.stringify({ clientId, shell: shellKind, cols: size.cols, rows: size.rows }),
      })
      openSocket(clientId, response, response.wsPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建终端会话失败"
      patchSession(clientId, (view) => ({ ...view, status: "error", error: message }))
      pushLine(clientId, message, "err")
    }
  }, [apiRequest, openSocket, patchSession, pushLine, serverConnection])

  const connect = useCallback((client: Client) => {
    setTargetId(client.id)
    const existing = sessionsRef.current[client.id]
    if (existing && existing.status !== "closed" && existing.status !== "error") return
    if (existing) disconnectSession(client.id, true, "", true)
    const view = emptySession(client.id, shell)
    view.lines = [mkLine(`正在连接 ${client.name}${client.hostname ? `（${client.hostname}）` : ""}…`, "sys")]
    setSessions((prev) => ({ ...prev, [client.id]: view }))
    void startSession(client.id, shell)
  }, [disconnectSession, shell, startSession])

  const retry = useCallback(() => {
    if (!targetId) return
    const client = clients.find((item) => item.id === targetId)
    if (!client) return
    disconnectSession(targetId, true, "", true)
    setSessions((prev) => {
      const next = { ...prev }
      delete next[targetId]
      return next
    })
    connect(client)
  }, [clients, connect, disconnectSession, targetId])

  const exec = useCallback((raw: string) => {
    if (!targetId) return
    const view = sessionsRef.current[targetId]
    if (!view || view.status !== "ready" || !view.agentAttached) return
    const command = raw.trim()
    if (!command) return
    setInput("")
    if (command === "clear") {
      patchSession(targetId, (current) => ({ ...current, lines: [], partial: "", historyIndex: -1 }))
      return
    }
    const prompt = view.shell === "powershell" ? "PS" : "CMD"
    patchSession(targetId, (current) => {
      const lines = [...current.lines]
      if (current.partial) lines.push(mkLine(current.partial, "remote"))
      lines.push(mkLine(`${prompt}> ${command}`, "cmd"))
      const history = [...current.history, command].slice(-200)
      return { ...current, lines: clampLines(lines), partial: "", history, historyIndex: -1 }
    })
    if (!sendTo(targetId, { kind: "input", data: `${command}\r\n` })) {
      pushLine(targetId, "实时通道尚未就绪，命令未发送。", "err")
    }
  }, [patchSession, pushLine, sendTo, targetId])

  const disconnect = useCallback(() => {
    if (!targetId) return
    disconnectSession(targetId, true, "会话已断开。")
    patchSession(targetId, (view) => ({ ...view, status: "closed", agentAttached: false }))
  }, [disconnectSession, patchSession, targetId])

  // 连接时长计时
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [open])

  const activeView = targetId ? sessions[targetId] : undefined
  // 输出更新后滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [activeView?.lines.length, activeView?.partial, mode])

  // 同步终端尺寸（面板窗口/分栏变化时）
  useEffect(() => {
    if (!open || !targetId) return
    const element = scrollRef.current
    if (!element || typeof ResizeObserver === "undefined") return
    let timer: number | null = null
    const initial = element.getBoundingClientRect()
    sizeRef.current = terminalSizeFromPixels(initial.width, initial.height)
    const observer = new ResizeObserver(() => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const rect = element.getBoundingClientRect()
        const size = terminalSizeFromPixels(rect.width, rect.height)
        if (size.cols === sizeRef.current.cols && size.rows === sizeRef.current.rows) return
        sizeRef.current = size
        if (sessionsRef.current[targetId]?.status === "ready") {
          sendTo(targetId, { kind: "resize", cols: size.cols, rows: size.rows })
        }
      }, 250)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (timer) window.clearTimeout(timer)
    }
  }, [open, sendTo, targetId])

  // 面板关闭后结束全部会话；保留关闭动画的短暂延迟
  useEffect(() => {
    if (open) return
    const timer = window.setTimeout(() => {
      for (const clientId of [...socketsRef.current.keys()]) disconnectSession(clientId, true, "", true)
      setSessions({})
      setTargetId(null)
      setInput("")
      setMode("term")
    }, 460)
    return () => window.clearTimeout(timer)
  }, [disconnectSession, open])

  useEffect(() => () => {
    for (const state of socketsRef.current.values()) {
      state.intentional = true
      if (state.timer) window.clearTimeout(state.timer)
      try { state.ws?.close() } catch { /* 已关闭 */ }
    }
    socketsRef.current.clear()
  }, [])

  const target = clients.find((client) => client.id === targetId) ?? null
  const view = targetId ? sessions[targetId] : undefined
  const ready = view?.status === "ready"
  const canInteract = ready && view?.agentAttached === true

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!targetId) return
    const history = view?.history ?? []
    if (event.key === "Enter") {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      exec(input)
      return
    }
    if (event.key === "ArrowUp" && history.length) {
      event.preventDefault()
      const index = view?.historyIndex === undefined || view.historyIndex < 0 ? history.length - 1 : Math.max(0, view.historyIndex - 1)
      patchSession(targetId, (current) => ({ ...current, historyIndex: index }))
      setInput(history[index])
      return
    }
    if (event.key === "ArrowDown" && view?.historyIndex !== undefined && view.historyIndex >= 0) {
      event.preventDefault()
      const index = view.historyIndex + 1
      if (index >= history.length) {
        patchSession(targetId, (current) => ({ ...current, historyIndex: -1 }))
        setInput("")
      } else {
        patchSession(targetId, (current) => ({ ...current, historyIndex: index }))
        setInput(history[index])
      }
    }
  }

  const statusText = (() => {
    if (!view) return null
    switch (view.status) {
      case "connecting":
        return "连接中"
      case "ready":
        return view.agentAttached ? "已连接" : "等待 Agent"
      case "reconnecting":
        return "重连中"
      case "closed":
        return "已断开"
      case "error":
        return "连接失败"
    }
  })()

  return (
    <ModalShell open={open} onClose={onClose} label="远程终端" maxWidth="max-w-4xl">
      <OverlayHeader
        icon={<SquareTerminal className="h-5 w-5" />}
        title="远程终端 WebSSH"
        desc="选择一台在线 Windows 客户端，通过 Agent 打开持久 Shell 会话"
        onClose={onClose}
        extra={
          target && (
            <span
              className={cn(
                "mr-1 hidden h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 font-mono text-xs font-medium sm:flex",
                ready ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {view?.status === "connecting" || view?.status === "reconnecting" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <span className={cn("h-1.5 w-1.5 rounded-full", ready ? "bg-primary" : "bg-muted-foreground")} />
              )}
              {statusText}
              {ready && view?.startedAt ? ` ${formatDuration(now - view.startedAt)}` : ""}
            </span>
          )
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-0 sm:flex-row">
        {/* 客户端列表 */}
        <div className="flex shrink-0 flex-row gap-2 overflow-x-auto border-b border-border p-3 sm:w-60 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r">
          <label className="flex shrink-0 items-center gap-2 px-1 text-[11px] text-muted-foreground">
            <span className="whitespace-nowrap">新会话 Shell</span>
            <select
              value={shell}
              onChange={(event) => setShell(event.target.value === "cmd" ? "cmd" : "powershell")}
              className="h-7 rounded-lg border border-border bg-surface px-2 font-mono text-[11px] text-foreground outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="powershell">PowerShell</option>
              <option value="cmd">CMD</option>
            </select>
          </label>

          {clients.map((client) => {
            const eligible = terminalReady(client)
            const reason = ineligibleReason(client)
            const active = targetId === client.id
            const hasSession = sessions[client.id]?.status === "ready"
            return (
              <button
                key={client.id}
                type="button"
                disabled={!eligible}
                title={reason ?? `打开 ${client.name} 的终端会话`}
                onClick={() => connect(client)}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors",
                  active ? "bg-primary/12" : "hover:bg-surface",
                  !eligible && "cursor-not-allowed opacity-45",
                )}
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", statusMeta[client.status].dot)} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm font-medium", active && "text-primary")}>{client.name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {client.ip || client.hostname || client.id}
                    {reason ? ` · ${reason}` : " · Windows"}
                  </span>
                </span>
                {hasSession && !active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />}
              </button>
            )
          })}

          {clients.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground/70">暂无客户端 · 先在「客户端」页安装 Agent</p>
          )}

          <p className="shrink-0 rounded-xl border border-dashed border-border px-3 py-2 text-[11px] leading-relaxed text-muted-foreground/80">
            仅支持已建立实时通道的 Windows Agent，每个客户端同时只允许一个终端会话。
          </p>
        </div>

        {/* 终端 / 文件区 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background/60">
          {developerPreview && (
            <div className="flex shrink-0 items-center gap-2 border-b border-border bg-warning/10 px-3 py-2 text-xs text-warning">
              <WifiOff className="h-3.5 w-3.5" />
              开发者预览模式使用演示数据，不支持真实 WebSSH 会话。
            </div>
          )}
          {!serverConnection && !developerPreview && (
            <div className="flex shrink-0 items-center gap-2 border-b border-border bg-warning/10 px-3 py-2 text-xs text-warning">
              <WifiOff className="h-3.5 w-3.5" />
              尚未配置控制服务端连接，无法建立终端会话。
            </div>
          )}

          {target && (
            <div role="tablist" aria-label="会话面板" className="flex shrink-0 items-center gap-1 border-b border-border px-3 pt-2">
              {(
                [
                  { key: "term", label: "终端", Icon: SquareTerminal },
                  { key: "files", label: "文件传输", Icon: FolderUp },
                ] as const
              ).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={mode === key}
                  onClick={() => setMode(key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-1.5 text-sm transition-colors",
                    mode === key
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          )}

          {target && mode === "files" ? (
            <FilesPanel key={target.id} client={target} />
          ) : (
            <>
              <div
                ref={scrollRef}
                onClick={() => inputRef.current?.focus()}
                className="min-h-[340px] flex-1 cursor-text overflow-y-auto p-4 font-mono text-[12.5px] leading-relaxed"
              >
                {!target && (
                  <p className="text-muted-foreground/70">← 从左侧选择一台在线 Windows 客户端建立 Shell 会话（离线或未建立实时通道的设备不可选）</p>
                )}
                {view?.lines.map((line) => (
                  <p
                    key={line.id}
                    className={cn(
                      "whitespace-pre-wrap break-all",
                      line.kind === "sys" && "text-muted-foreground",
                      line.kind === "cmd" && "text-primary",
                      line.kind === "err" && "text-negative",
                      line.kind === "remote" && "text-foreground",
                    )}
                  >
                    {line.text || "\u00a0"}
                  </p>
                ))}
                {view?.partial && <p className="whitespace-pre-wrap break-all text-foreground">{view.partial}</p>}
                {target && view?.status === "ready" && (
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-primary">{view.shell === "powershell" ? "PS>" : "CMD>"}</span>
                    <input
                      ref={inputRef}
                      value={input}
                      onChange={(event) => {
                        setInput(event.target.value)
                        patchSession(target.id, (current) => ({ ...current, historyIndex: -1 }))
                      }}
                      onKeyDown={onKeyDown}
                      disabled={!canInteract}
                      aria-label="终端命令输入"
                      placeholder={canInteract ? "输入命令后回车执行" : "等待 Agent 接入…"}
                      spellCheck={false}
                      autoComplete="off"
                      className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-foreground caret-primary outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed"
                    />
                  </div>
                )}
                {target && view?.status === "closed" && (
                  <button
                    type="button"
                    onClick={retry}
                    className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    重新连接
                  </button>
                )}
                {target && view?.status === "error" && (
                  <button
                    type="button"
                    onClick={retry}
                    className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    重试连接
                  </button>
                )}
              </div>

              {canInteract && (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
                  {QUICK_COMMANDS.map((command) => (
                    <button
                      key={command}
                      type="button"
                      onClick={() => exec(command)}
                      className="rounded-full bg-surface px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {command}
                    </button>
                  ))}
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => target && patchSession(target.id, (current) => ({ ...current, lines: [], partial: "" }))}
                      aria-label="清屏"
                      title="清屏（仅清理本地显示）"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Eraser className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={disconnect}
                      aria-label="断开连接"
                      title="断开连接"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-negative"
                    >
                      <Unplug className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              )}
              {!canInteract && target && view?.status !== "closed" && view?.status !== "error" && (
                <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {view?.status === "reconnecting" ? "正在恢复会话…" : view?.agentAttached === false ? "等待 Agent 接入 Shell…" : "正在建立会话…"}
                </div>
              )}
            </>
          )}

          <p className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-muted-foreground/70">
            {mode === "files" && target
              ? "文件操作通过 Agent 会话执行 · 上传/下载按 256 KiB 分块校验 SHA-256 · 断线后可按已确认偏移重试"
              : "持久 PowerShell/CMD 会话 · 回车执行 · ↑/↓ 翻历史 · 关闭弹窗会结束会话"}
          </p>
        </div>
      </div>
    </ModalShell>
  )
}
