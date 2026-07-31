"use client"

import { useEffect, useRef, useState } from "react"
import { SquareTerminal, Unplug, Eraser, Plus, FolderUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { statusMeta, type Client } from "@/components/clients/client-data"
import { useServerData } from "@/components/server-data-context"
import { ModalShell, OverlayHeader } from "./overlay"
import { FilesPanel } from "./webssh-files-panel"

type Line = { id: number; text: string; kind: "out" | "cmd" | "sys" | "err" }

let lineId = 0
const mkLine = (text: string, kind: Line["kind"] = "out"): Line => ({ id: ++lineId, text, kind })

/** 单个客户端的终端会话：切换客户端时各自保留滚动回放 */
type Session = {
  lines: Line[]
  connected: boolean
  history: string[]
  connectedAt: number | null
}

const emptySession = (): Session => ({ lines: [], connected: false, history: [], connectedAt: null })

/** 可补全的命令表（Tab 补全 & help 输出用） */
const COMMANDS = [
  "help",
  "whoami",
  "hostname",
  "ip",
  "uptime",
  "uname",
  "date",
  "ls",
  "cat",
  "df",
  "free",
  "ps",
  "top",
  "ping",
  "echo",
  "systemctl",
  "history",
  "clear",
  "exit",
]

/** 按 IP/主机名生成稳定的伪延迟（演示用），非数字主机按字符码求和 */
const fakeLatency = (c: Client) => {
  const tail = Number.parseInt(c.ip.split(".").pop() ?? "", 10)
  const seed = Number.isNaN(tail) ? [...c.ip].reduce((a, ch) => a + ch.charCodeAt(0), 0) : tail
  return (seed % 38) + 4
}

/** 模拟命令执行结果（演示环境，无真实连接） */
function runCommand(raw: string, client: Client, history: string[]): Line[] {
  const parts = raw.trim().split(/\s+/)
  const cmd = parts[0]
  const arg = parts.slice(1).join(" ")
  const out = (arr: string[], kind: Line["kind"] = "out") => arr.map((t) => mkLine(t, kind))

  switch (cmd) {
    case "":
      return []
    case "help":
      return out([
        "可用命令（支持 Tab 补全、↑/↓ 翻历史）：",
        "  whoami hostname ip uptime uname date   基本信息",
        "  ls cat df free ps top                  文件与资源",
        "  ping <host>  echo <text>  systemctl status <svc>",
        "  history  clear  exit",
      ])
    case "whoami":
      return out(["root"])
    case "hostname":
      return out([client.hostname])
    case "ip":
      return out([`eth0: ${client.ip}/24  gateway 192.168.1.1`])
    case "uptime":
      return out([" 14:32:07 up 23 days,  4:11,  1 user,  load average: 0.42, 0.35, 0.30"])
    case "uname":
      return out([`Linux ${client.hostname} 6.8.0-45-generic #45 SMP x86_64 GNU/Linux`])
    case "date":
      return out([new Date().toLocaleString("zh-CN", { hour12: false })])
    case "ls":
      return out(["backups/  data/  logs/  scripts/  docker-compose.yml  nacho-agent.conf"])
    case "cat":
      if (!arg) return out(["cat: 缺少文件参数"], "err")
      if (arg.includes("os-release"))
        return out([`PRETTY_NAME="${client.os}"`, `HOSTNAME=${client.hostname}`, "ID=linux"])
      if (arg.includes("nacho-agent.conf"))
        return out(["[agent]", `name = ${client.name}`, `server = 192.168.1.2:8443`, "interval = 15s", "tls = true"])
      return out([`cat: ${arg}: 没有那个文件或目录`], "err")
    case "df":
      return out([
        "文件系统        容量  已用  可用 已用% 挂载点",
        "/dev/sda1        200G   86G  114G   43% /",
        "/dev/sdb1        1.0T  412G  612G   41% /data",
        "tmpfs             16G  1.2G   15G    8% /dev/shm",
      ])
    case "free":
      return out([
        "               total        used        free      shared  buff/cache   available",
        "内存：          31Gi        12Gi       8.2Gi       1.1Gi        10Gi        17Gi",
        "交换：         8.0Gi       256Mi       7.8Gi",
      ])
    case "ps":
      return out([
        "  PID CMD",
        "    1 /sbin/init",
        "  842 nacho-agent --daemon",
        " 1207 nginx: master process",
        " 1911 postgres: checkpointer",
        " 2048 node /srv/app/server.js",
      ])
    case "top":
      return out([
        `top - 14:32:07 up 23 days · ${client.hostname}`,
        "任务: 187 total,   1 running, 186 sleeping",
        "%Cpu(s):  6.2 us,  1.8 sy,  0.0 ni, 91.4 id",
        "MiB Mem :  31842.0 total,   8412.6 free,  12280.4 used",
        "",
        "  PID USER      %CPU  %MEM  COMMAND",
        " 2048 root      12.3   4.1  node",
        " 1207 www-data   3.2   1.0  nginx",
        "  842 root       1.1   0.6  nacho-agent",
      ])
    case "ping": {
      const host = arg || "192.168.1.1"
      const ms = fakeLatency(client)
      return out([
        `PING ${host} 56(84) bytes of data.`,
        ...[0, 1, 2].map((i) => `64 bytes from ${host}: icmp_seq=${i + 1} ttl=64 time=${(ms + i * 0.4).toFixed(1)} ms`),
        `--- ${host} ping statistics ---`,
        `3 packets transmitted, 3 received, 0% packet loss`,
      ])
    }
    case "echo":
      return out([arg])
    case "systemctl": {
      const svc = parts[2] ?? "nacho-agent"
      if (parts[1] !== "status") return out(["用法：systemctl status <服务名>"], "err")
      return out([
        `● ${svc}.service - ${svc}`,
        "     Loaded: loaded (/etc/systemd/system enabled)",
        "     Active: active (running) since Mon 2026-06-16 09:20:11 CST",
        "   Main PID: 842",
        "     Memory: 186.0M",
      ])
    }
    case "history":
      return out(history.map((h, i) => `  ${String(i + 1).padStart(3)}  ${h}`))
    default:
      return out([`bash: ${cmd}: 未找到命令（输入 help 查看可用命令）`], "err")
  }
}

/** 连接时长格式化 mm:ss / hh:mm:ss */
function formatDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const p = (n: number) => String(n).padStart(2, "0")
  return hh > 0 ? `${p(hh)}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`
}

/** 输入区上方的快捷命令 */
const QUICK_COMMANDS = ["uptime", "df", "free", "top", "ps"]

/**
 * 远程终端 WebSSH：左侧选择在线客户端，右侧为模拟终端。
 * 支持多会话保留、命令历史（↑/↓）、Tab 补全、快捷命令与连接时长显示。
 */
export function WebSSHDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { clients } = useServerData()
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const [targetId, setTargetId] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [histIdx, setHistIdx] = useState(-1)
  const [now, setNow] = useState(() => Date.now())
  // 手动添加的连接目标（不在客户端列表中的机器）
  const [customClients, setCustomClients] = useState<Client[]>([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: "", host: "", port: "22" })
  // 面板模式：终端 / 文件传输
  const [mode, setMode] = useState<"term" | "files">("term")
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const allClients = [...clients, ...customClients]
  const target = allClients.find((c) => c.id === targetId) ?? null
  const session = targetId ? sessions[targetId] : undefined
  const connected = session?.connected ?? false

  const patchSession = (id: string, patch: (s: Session) => Session) =>
    setSessions((prev) => ({ ...prev, [id]: patch(prev[id] ?? emptySession()) }))

  // 关闭时重置全部会话
  useEffect(() => {
    if (open) return
    const t = setTimeout(() => {
      setSessions({})
      setTargetId(null)
      setInput("")
      setHistIdx(-1)
      setAdding(false)
      setForm({ name: "", host: "", port: "22" })
      setMode("term")
    }, 460)
    return () => clearTimeout(t)
  }, [open])

  // 连接后每秒刷新时长（先立即同步一次，避免显示负值）
  useEffect(() => {
    if (!open || !connected) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [open, connected])

  // 输出更新后滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [session?.lines])

  useEffect(() => () => timersRef.current.forEach(clearTimeout), [])

  const connect = (c: Client) => {
    setHistIdx(-1)
    // 已有会话：直接切换，不重新握手
    if (sessions[c.id]) {
      setTargetId(c.id)
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    setTargetId(c.id)
    patchSession(c.id, (s) => ({ ...s, lines: [mkLine(`正在连接 ${c.hostname}（${c.ip}:22）...`, "sys")] }))
    const steps: [number, Line, boolean][] = [
      [350, mkLine(`SSH 握手完成（延迟 ${fakeLatency(c)}ms），正在验证密钥 ...`, "sys"), false],
      [750, mkLine("身份验证成功（publickey）", "sys"), false],
      [1050, mkLine(`Welcome to ${c.os} · ${c.hostname}`, "out"), false],
      [1100, mkLine("最近登录：2026-07-09 21:14 来自 192.168.1.2", "out"), true],
    ]
    steps.forEach(([delay, line, last]) => {
      timersRef.current.push(
        setTimeout(() => {
          patchSession(c.id, (s) =>
            last
              ? { ...s, lines: [...s.lines, line], connected: true, connectedAt: Date.now() }
              : { ...s, lines: [...s.lines, line] },
          )
          if (last) inputRef.current?.focus()
        }, delay),
      )
    })
  }

  /** 手动添加一个连接目标并立即建立会话 */
  const addCustomClient = () => {
    const host = form.host.trim()
    if (!host) return
    const name = form.name.trim() || host
    const port = form.port.trim() || "22"
    const c: Client = {
      id: `custom-${Date.now()}`,
      name,
      hostname: `${host}:${port}`,
      ip: host,
      os: "Linux",
      status: "online",
      tags: ["手动添加"],
      group: "自定义连接",
      version: "",
      lastSeen: Date.now(),
      registeredAt: Date.now(),
      metrics: null,
      connected: true,
    }
    setCustomClients((prev) => [...prev, c])
    setAdding(false)
    setForm({ name: "", host: "", port: "22" })
    connect(c)
  }

  const prompt = target ? `root@${target.hostname}:~$` : "$"

  const exec = (raw: string) => {
    if (!target || !targetId || !connected) return
    const cmd = raw.trim()
    setInput("")
    setHistIdx(-1)
    if (!cmd) return
    if (cmd === "clear") {
      patchSession(targetId, (s) => ({ ...s, lines: [] }))
      return
    }
    if (cmd === "exit") {
      setSessions((prev) => {
        const next = { ...prev }
        delete next[targetId]
        return next
      })
      setTargetId(null)
      setMode("term")
      return
    }
    patchSession(targetId, (s) => ({
      ...s,
      history: [...s.history, cmd],
      lines: [...s.lines, mkLine(`${prompt} ${cmd}`, "cmd"), ...runCommand(cmd, target, [...s.history, cmd])],
    }))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const history = session?.history ?? []
    if (e.key === "Enter") {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return
      exec(input)
      return
    }
    // ↑/↓ 翻命令历史
    if (e.key === "ArrowUp" && history.length) {
      e.preventDefault()
      const idx = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(idx)
      setInput(history[idx])
      return
    }
    if (e.key === "ArrowDown" && histIdx >= 0) {
      e.preventDefault()
      const idx = histIdx + 1
      if (idx >= history.length) {
        setHistIdx(-1)
        setInput("")
      } else {
        setHistIdx(idx)
        setInput(history[idx])
      }
      return
    }
    // Tab 补全命令名
    if (e.key === "Tab") {
      e.preventDefault()
      const head = input.trimStart()
      if (!head || head.includes(" ")) return
      const match = COMMANDS.filter((c) => c.startsWith(head))
      if (match.length === 1) setInput(match[0] + " ")
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} label="远程终端" maxWidth="max-w-4xl">
      <OverlayHeader
        icon={<SquareTerminal className="h-5 w-5" />}
        title="远程终端 WebSSH"
        desc="选择一台在线客户端，直接在浏览器中打开远程终端"
        onClose={onClose}
        extra={
          target && (
            <span
              className={cn(
                "mr-1 hidden h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 font-mono text-xs font-medium sm:flex",
                connected ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-primary" : "bg-muted-foreground")} />
              {connected && session?.connectedAt
                ? `已连接 ${formatDuration(now - session.connectedAt)}`
                : "连接中"}
            </span>
          )
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-0 sm:flex-row">
        {/* 客户端列表 */}
        <div className="flex shrink-0 flex-row gap-2 overflow-x-auto border-b border-border p-3 sm:w-60 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r">
          {allClients.map((c) => {
            const offline = c.status === "offline"
            const activeItem = targetId === c.id
            const hasSession = Boolean(sessions[c.id]?.connected)
            return (
              <button
                key={c.id}
                type="button"
                disabled={offline}
                onClick={() => connect(c)}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors",
                  activeItem ? "bg-primary/12" : "hover:bg-surface",
                  offline && "cursor-not-allowed opacity-45",
                )}
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", statusMeta[c.status].dot)} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm font-medium", activeItem && "text-primary")}>
                    {c.name}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {c.ip}
                    {!offline && ` · ${fakeLatency(c)}ms`}
                  </span>
                </span>
                {/* 后台保持会话的标记 */}
                {hasSession && !activeItem && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />}
              </button>
            )
          })}

          {/* 添加连接：手动输入不在列表中的机器 */}
          {adding ? (
            <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-dashed border-border p-3">
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="名称（可选）"
                aria-label="连接名称"
                className="h-8 rounded-lg bg-surface px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-primary/50"
              />
              <input
                value={form.host}
                onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) addCustomClient()
                }}
                placeholder="主机地址 / IP *"
                aria-label="主机地址"
                spellCheck={false}
                className="h-8 rounded-lg bg-surface px-2.5 font-mono text-sm text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-primary/50"
              />
              <input
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: e.target.value.replace(/\D/g, "") }))}
                placeholder="端口"
                aria-label="端口"
                inputMode="numeric"
                className="h-8 rounded-lg bg-surface px-2.5 font-mono text-sm text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-primary/50"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={addCustomClient}
                  disabled={!form.host.trim()}
                  className="h-8 flex-1 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  连接
                </button>
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="h-8 flex-1 rounded-lg bg-surface text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
              添加连接
            </button>
          )}
        </div>

        {/* 终端区 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background/60">
          {/* 终端 / 文件传输 标签页（连接后可用） */}
          {connected && (
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

          {connected && mode === "files" && target ? (
            <FilesPanel key={target.id} client={target} />
          ) : (
            <>
          <div
            ref={scrollRef}
            onClick={() => inputRef.current?.focus()}
            className="min-h-[340px] flex-1 cursor-text overflow-y-auto p-4 font-mono text-[12.5px] leading-relaxed"
          >
            {!target && (
              <p className="text-muted-foreground/70">← 从左侧选择一台在线客户端建立 SSH 连接（离线设备不可选）</p>
            )}
            {session?.lines.map((l) => (
              <p
                key={l.id}
                className={cn(
                  "whitespace-pre-wrap break-all",
                  l.kind === "sys" && "text-muted-foreground",
                  l.kind === "cmd" && "text-primary",
                  l.kind === "err" && "text-negative",
                  l.kind === "out" && "text-foreground",
                )}
              >
                {l.text}
              </p>
            ))}
            {connected && (
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-primary">{prompt}</span>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value)
                    setHistIdx(-1)
                  }}
                  onKeyDown={onKeyDown}
                  aria-label="终端命令输入"
                  spellCheck={false}
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-foreground caret-primary outline-none"
                />
              </div>
            )}
          </div>

          {/* 快捷命令 + 会话操作 */}
          {connected && (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
              {QUICK_COMMANDS.map((qc) => (
                <button
                  key={qc}
                  type="button"
                  onClick={() => exec(qc)}
                  className="rounded-full bg-surface px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {qc}
                </button>
              ))}
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => exec("clear")}
                  aria-label="清屏"
                  title="清屏"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Eraser className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => exec("exit")}
                  aria-label="断开连接"
                  title="断开连接"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-negative"
                >
                  <Unplug className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          )}
            </>
          )}

          <p className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-muted-foreground/70">
            {mode === "files" && connected
              ? "演示环境：文件操作在本地模拟 · 上传支持多选 · 悬停文件行显示下载/删除"
              : "演示环境：命令在本地模拟执行 · help 查看命令 · Tab 补全 · ↑/↓ 翻历史 · exit 断开"}
          </p>
        </div>
      </div>
    </ModalShell>
  )
}
