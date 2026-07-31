"use client"

import { useEffect, useState } from "react"
import {
  Activity,
  AppWindow,
  ArrowLeft,
  CalendarClock,
  CheckCheck,
  ChevronRight,
  CircleStop,
  FolderTree,
  DownloadCloud,
  FileUp,
  FileClock,
  Globe,
  KeyRound,
  Loader2,
  MessageSquare,
  MonitorSmartphone,
  Package,
  Play,
  Plus,
  RotateCw,
  Search,
  Send,
  Server,
  SquareTerminal,
  Terminal,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Select } from "@/components/ui/select"
import type { Client } from "./client-data"
import { statusMeta } from "./client-data"
import { useServerData } from "@/components/server-data-context"
import {
  isAbsoluteWindowsExecutablePath,
  isValidProcessId,
  isValidProcessTimeout,
  parseTerminateProcessResult,
  terminalCommandStatuses,
  type CommandStatus,
} from "@/lib/terminate-process"
import {
  isValidRestartDelay,
  isValidRestartReason,
  normalizeRestartReason,
  parseRestartSystemResult,
  type RestartSystemCommand,
} from "@/lib/restart-system"
import {
  dateToUtcInput,
  isValidLogWindow,
  isValidMaxEntries,
  logSources,
  parseCollectLogsResult,
  utcInputToIso,
  type CollectLogsCommand,
  type LogSource,
} from "@/lib/collect-logs"

type OS = "windows" | "linux"

type DetailProps = {
  os: OS
  clientId?: string
}

/* ---------- 通用样式 / 小组件 ---------- */

const inputCls =
  "h-11 w-full rounded-xl border border-border bg-surface/60 px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:bg-surface"

/* 标题文字交叉过渡：旧文字模糊渐隐，新文字模糊渐显 */
function MorphText({ text, className }: { text: string; className?: string }) {
  const [current, setCurrent] = useState(text)
  const [previous, setPrevious] = useState<string | null>(null)

  useEffect(() => {
    if (text === current) return
    setPrevious(current)
    setCurrent(text)
    const timer = setTimeout(() => setPrevious(null), 450)
    return () => clearTimeout(timer)
  }, [text, current])

  return (
    <span className="relative inline-block align-top">
      {previous !== null && (
        <span
          key={`prev-${previous}`}
          aria-hidden
          className={cn("absolute left-0 top-0 whitespace-nowrap animate-title-out", className)}
        >
          {previous}
        </span>
      )}
      <span key={`cur-${current}`} className={cn("inline-block animate-title-in", className)}>
        {current}
      </span>
    </span>
  )
}

function Field({
  label,
  icon,
  children,
}: {
  label: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      {children}
    </label>
  )
}

/* 主色执行按钮 */
function PrimaryButton({
  icon,
  children,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-95"
    >
      {icon}
      {children}
    </button>
  )
}

/* 目标客户端选择器：批量页支持多选，单机管理页固定为卡片对应客户端。 */
function TargetPicker({ os, clientId }: DetailProps) {
  const { clients } = useServerData()
  const list = clients.filter((c) => c.status === "online" && matchOS(c, os))
  const fixedClient = clientId ? clients.find((client) => client.id === clientId) ?? null : null
  const [selected, setSelected] = useState<string[]>(list[0] ? [list[0].id] : [])
  const listKey = list.map((client) => client.id).join("|")

  useEffect(() => {
    const validIds = new Set(list.map((client) => client.id))
    setSelected((current) => {
      const validSelection = current.filter((id) => validIds.has(id))
      if (validSelection.length > 0) return validSelection
      return list[0] ? [list[0].id] : []
    })
  }, [listKey])

  // 依据当前系统的客户端派生分组（仅显示有成员的分组）
  const groupMap = list.reduce<Record<string, string[]>>((acc, c) => {
    ;(acc[c.group] ??= []).push(c.id)
    return acc
  }, {})
  const groupNames = Object.keys(groupMap)

  const allIds = list.map((c) => c.id)
  const allSelected = allIds.length > 0 && selected.length === allIds.length

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const toggleAll = () => setSelected(allSelected ? [] : allIds)

  const groupState = (name: string): "all" | "some" | "none" => {
    const ids = groupMap[name]
    const hit = ids.filter((id) => selected.includes(id)).length
    if (hit === 0) return "none"
    if (hit === ids.length) return "all"
    return "some"
  }

  const toggleGroup = (name: string) => {
    const ids = groupMap[name]
    setSelected((prev) =>
      groupState(name) === "all"
        ? prev.filter((id) => !ids.includes(id)) // 整组已选 → 取消
        : Array.from(new Set([...prev, ...ids])), // 否则整组选中
    )
  }

  if (clientId) {
    const status = fixedClient ? statusMeta[fixedClient.status] : null
    return (
      <Field label="目标客户端" icon={<Users className="h-3.5 w-3.5" />}>
        {fixedClient ? (
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/8 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{fixedClient.name}</p>
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {fixedClient.hostname} · {fixedClient.ip}
              </p>
            </div>
            <span className={cn("flex shrink-0 items-center gap-1.5 text-xs font-medium", status?.text)}>
              <span className={cn("h-2 w-2 rounded-full", status?.dot)} />
              {status?.label}
            </span>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border bg-surface/40 px-4 py-3 text-xs text-muted-foreground">
            目标客户端已不在当前列表中
          </p>
        )}
      </Field>
    )
  }

  return (
    <Field
      label={`目标客户端（已选 ${selected.length} / ${list.length}）`}
      icon={<Users className="h-3.5 w-3.5" />}
    >
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface/40 px-4 py-3 text-xs text-muted-foreground">
          暂无 {os === "windows" ? "Windows" : "Linux"} 客户端在线
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* 一键全选 + 按分组选择 */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleAll}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200",
                allSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-primary/50 bg-primary/10 text-primary hover:bg-primary/15",
              )}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {allSelected ? "取消全选" : "全选"}
            </button>

            {groupNames.length > 1 && <span className="h-4 w-px bg-border" />}

            {groupNames.length > 1 &&
              groupNames.map((name) => {
                const state = groupState(name)
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleGroup(name)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200",
                      state === "all"
                        ? "border-primary bg-primary/15 text-primary"
                        : state === "some"
                          ? "border-primary/50 bg-primary/8 text-primary"
                          : "border-border bg-surface/60 text-muted-foreground hover:bg-surface",
                    )}
                  >
                    <FolderTree className="h-3.5 w-3.5" />
                    {name}
                    <span className="text-[10px] opacity-70">
                      {groupMap[name].filter((id) => selected.includes(id)).length}/{groupMap[name].length}
                    </span>
                  </button>
                )
              })}
          </div>

          {/* 单个客户端 */}
          <div className="flex flex-wrap gap-2">
            {list.map((c) => {
              const on = selected.includes(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition-all duration-200",
                    on
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-surface/60 text-muted-foreground hover:bg-surface",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-primary" : "bg-muted-foreground/50")} />
                  {c.name}
                  <span className="text-[10px] opacity-60">{c.group}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Field>
  )
}

/* ---------- 子功能：批量安装 ---------- */
// 可安装软件包由服务端仓库提供，面板不再内置模拟数据
const winPackages: { name: string; ver: string; size: string }[] = []

const linuxPackages: { name: string; ver: string; size: string }[] = []

function BatchInstall({ os, clientId }: DetailProps) {
  const list = os === "windows" ? winPackages : linuxPackages
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (n: string) =>
    setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]))

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <Field
        label={os === "windows" ? "选择安装包" : "选择软件包（apt / yum）"}
        icon={<Package className="h-3.5 w-3.5" />}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {list.map((p) => {
            const on = picked.includes(p.name)
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => toggle(p.name)}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-all duration-200",
                  on ? "border-primary bg-primary/10" : "border-border bg-surface/60 hover:bg-surface",
                )}
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{p.ver}</span> · {p.size}
                  </p>
                </div>
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-md border",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {on && <Play className="h-3 w-3 rotate-0" />}
                </span>
              </button>
            )
          })}
        </div>
      </Field>

      <TargetPicker os={os} clientId={clientId} />

      <div className="mt-auto flex justify-end gap-3 border-t border-border pt-4">
        <PrimaryButton icon={<DownloadCloud className="h-4 w-4" />}>开始批量安装</PrimaryButton>
      </div>
    </div>
  )
}

/* ---------- 子功能：文件下发 ---------- */
function FileDeploy({ os, clientId }: DetailProps) {
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <Field label="上传文件" icon={<FileUp className="h-3.5 w-3.5" />}>
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface/40 py-8 text-center transition-colors hover:border-primary/50 hover:bg-surface/60">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <FileUp className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium">点击或拖拽文件到此处</p>
          <p className="text-xs text-muted-foreground">支持任意格式，单个文件最大 512 MB</p>
        </div>
      </Field>

      <Field label="下发目标路径">
        <input
          className={cn(inputCls, "font-mono")}
          placeholder={os === "windows" ? "C:\\Program Files\\" : "/opt/app/"}
          defaultValue={os === "windows" ? "C:\\Deploy\\" : "/opt/deploy/"}
        />
      </Field>

      <TargetPicker os={os} clientId={clientId} />

      <div className="mt-auto flex justify-end gap-3 border-t border-border pt-4">
        <PrimaryButton icon={<Send className="h-4 w-4" />}>下发文件</PrimaryButton>
      </div>
    </div>
  )
}

/* ---------- 子功能：命令执行 ---------- */
function CommandRun({ os, clientId }: DetailProps) {
  const isWin = os === "windows"
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <Field label={isWin ? "命令内容（CMD / PowerShell）" : "命令内容（Shell）"} icon={<SquareTerminal className="h-3.5 w-3.5" />}>
        <textarea
          className={cn(inputCls, "h-28 resize-none py-3 font-mono leading-relaxed")}
          placeholder={isWin ? "例如：ipconfig /all" : "例如：systemctl restart nginx"}
          defaultValue={isWin ? "systeminfo | findstr /C:\"OS 名称\"" : "echo 'Hello from NachoNeko' && uptime"}
        />
      </Field>

      <Field label="执行输出（预览）">
        <div className="rounded-xl border border-border bg-background/60 p-4 font-mono text-xs leading-relaxed text-muted-foreground">
          {isWin ? (
            <>
              <p className="text-primary">{"> systeminfo | findstr /C:\"OS 名称\""}</p>
              <p>OS 名称: Microsoft Windows 11 专业版</p>
            </>
          ) : (
            <>
              <p className="text-primary">$ echo &apos;Hello from NachoNeko&apos; &amp;&amp; uptime</p>
              <p>Hello from NachoNeko</p>
              <p> 14:22:05 up 12 days, 3:41, 2 users, load average: 0.08, 0.03, 0.01</p>
            </>
          )}
        </div>
      </Field>

      <TargetPicker os={os} clientId={clientId} />

      <div className="mt-auto flex justify-end gap-3 border-t border-border pt-4">
        <PrimaryButton icon={<Play className="h-4 w-4" />}>执行命�����</PrimaryButton>
      </div>
    </div>
  )
}

/* ---------- 子功能：消息推送 ---------- */
function MessagePush({ os, clientId }: DetailProps) {
  const levels = ["普通", "重要", "紧急"]
  const [level, setLevel] = useState("普通")

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <Field label="消息标题" icon={<MessageSquare className="h-3.5 w-3.5" />}>
        <input className={inputCls} placeholder="例如：系统维护通知" />
      </Field>

      <Field label="消息内容">
        <textarea
          className={cn(inputCls, "h-24 resize-none py-3 leading-relaxed")}
          placeholder="输入要推送给客户端的内容"
        />
      </Field>

      <Field label="优先级">
        <div className="flex gap-2">
          {levels.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLevel(l)}
              className={cn(
                "h-11 flex-1 rounded-xl border text-sm font-medium transition-all duration-200",
                level === l
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-surface/60 text-muted-foreground hover:bg-surface",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </Field>

      <TargetPicker os={os} clientId={clientId} />

      <div className="mt-auto flex justify-end gap-3 border-t border-border pt-4">
        <PrimaryButton icon={<Send className="h-4 w-4" />}>推送消息</PrimaryButton>
      </div>
    </div>
  )
}

/* ---------- 子功能：用户管理 ---------- */
// 用户列表由目标客户端经服务端上报，面板不再内置模拟数据
const winUsers: { name: string; role: string; active: boolean }[] = []

const linuxUsers: { name: string; role: string; active: boolean }[] = []

function UserManage({ os }: DetailProps) {
  const list = os === "windows" ? winUsers : linuxUsers
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <div className="flex items-center justify-between gap-3">
        <div className="flex h-10 max-w-[240px] flex-1 items-center gap-2 rounded-full border border-border bg-surface/60 px-3.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input placeholder="搜索用户" className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60" />
        </div>
        <PrimaryButton icon={<UserPlus className="h-4 w-4" />}>新建用户</PrimaryButton>
      </div>

      <div className="flex flex-col gap-2">
        {list.map((u) => (
          <div
            key={u.name}
            className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface/60 px-4 py-3.5 transition-colors hover:bg-surface"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Users className="h-5 w-5" />
              </span>
              <div className="leading-tight">
                <p className="font-mono text-sm font-medium">{u.name}</p>
                <p className="text-xs text-muted-foreground">{u.role}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                  u.active ? "bg-primary/12 text-primary" : "bg-surface text-muted-foreground",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", u.active ? "bg-primary" : "bg-muted-foreground/50")} />
                {u.active ? "已启用" : "已禁用"}
              </span>
              <button
                aria-label="删除用户"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-negative"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- 子功能：打开网页（Windows） ---------- */
// 常用地址由服务端配置提供，面板不再内置模拟数据
const urlPresets: string[] = []

function OpenWebpage({ os, clientId }: DetailProps) {
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <Field label="网页地址" icon={<Globe className="h-3.5 w-3.5" />}>
        <input className={cn(inputCls, "font-mono")} placeholder="https://example.com" defaultValue="https://" />
      </Field>

      <Field label="常用地址">
        <div className="flex flex-wrap gap-2">
          {urlPresets.map((u) => (
            <button
              key={u}
              type="button"
              className="rounded-full border border-border bg-surface/60 px-3 py-2 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              {u}
            </button>
          ))}
        </div>
      </Field>

      <TargetPicker os={os} clientId={clientId} />

      <div className="mt-auto flex justify-end gap-3 border-t border-border pt-4">
        <PrimaryButton icon={<Globe className="h-4 w-4" />}>在客户端打开</PrimaryButton>
      </div>
    </div>
  )
}

/* ---------- 子功能：注册表（Windows） ---------- */
const regEntries = [
  { name: "(默认)", type: "REG_SZ", value: "(数值未设置)" },
  { name: "InstallPath", type: "REG_SZ", value: "C:\\Program Files\\NachoNeko" },
  { name: "Version", type: "REG_SZ", value: "2.4.1" },
  { name: "AutoStart", type: "REG_DWORD", value: "0x00000001" },
]

function Registry() {
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <Field label="注册表路径" icon={<KeyRound className="h-3.5 w-3.5" />}>
        <input
          className={cn(inputCls, "font-mono")}
          defaultValue="HKEY_LOCAL_MACHINE\\SOFTWARE\\NachoNeko"
        />
      </Field>

      <Field label="键值列表">
        <div className="overflow-hidden rounded-2xl border border-border">
          <div className="grid grid-cols-[1.2fr_1fr_1.6fr] gap-2 bg-surface px-4 py-2.5 text-xs font-medium text-muted-foreground">
            <span>名称</span>
            <span>类型</span>
            <span>数据</span>
          </div>
          {regEntries.map((r, i) => (
            <div
              key={r.name}
              className={cn(
                "grid grid-cols-[1.2fr_1fr_1.6fr] gap-2 px-4 py-3 text-xs transition-colors hover:bg-surface/60",
                i !== regEntries.length - 1 && "border-b border-border",
              )}
            >
              <span className="truncate font-mono font-medium text-foreground">{r.name}</span>
              <span className="truncate text-muted-foreground">{r.type}</span>
              <span className="truncate font-mono text-muted-foreground">{r.value}</span>
            </div>
          ))}
        </div>
      </Field>

      <div className="mt-auto flex justify-end gap-3 border-t border-border pt-4">
        <PrimaryButton icon={<Plus className="h-4 w-4" />}>新建键值</PrimaryButton>
      </div>
    </div>
  )
}

/* ---------- 子功能：服务管理（Linux systemctl） ---------- */
type ServiceAction = "query" | "start" | "stop" | "restart"
type ServiceCommand = {
  id: string
  clientId: string
  status: CommandStatus
  result: string | null
}
type ServiceResult = {
  serviceName: string
  action: ServiceAction
  initialStatus: string
  finalStatus: string
  durationMs: number
  timedOut: boolean
  error: string | null
}

const serviceActions: { id: ServiceAction; label: string }[] = [
  { id: "query", label: "查询" },
  { id: "start", label: "启动" },
  { id: "stop", label: "停���" },
  { id: "restart", label: "重启" },
]

function parseServiceResult(raw: string | null): ServiceResult | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<ServiceResult>
    if (typeof value.serviceName !== "string" || typeof value.action !== "string") return null
    return value as ServiceResult
  } catch {
    return null
  }
}

type TerminateProcessCommand = {
  id: string
  clientId: string
  status: CommandStatus
  result: string | null
}

function WindowsProcessTerminate({ clientId: fixedClientId }: DetailProps) {
  const { clients, apiRequest } = useServerData()
  const windowsClients = clients.filter((client) => client.os === "Windows")
  const [clientId, setClientId] = useState(fixedClientId ?? windowsClients[0]?.id ?? "")
  const [processId, setProcessId] = useState("")
  const [expectedPath, setExpectedPath] = useState("")
  const [killProcessTree, setKillProcessTree] = useState(true)
  const [timeoutSeconds, setTimeoutSeconds] = useState(30)
  const [command, setCommand] = useState<TerminateProcessCommand | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const windowsClientKey = windowsClients.map((client) => client.id).join("|")

  useEffect(() => {
    if (fixedClientId) {
      if (clientId !== fixedClientId) setClientId(fixedClientId)
      return
    }
    if (windowsClients.some((client) => client.id === clientId)) return
    setClientId(windowsClients[0]?.id ?? "")
  }, [clientId, fixedClientId, windowsClientKey])

  useEffect(() => {
    if (!command || terminalCommandStatuses.includes(command.status)) return
    let active = true
    const poll = async () => {
      try {
        const commands = await apiRequest<TerminateProcessCommand[]>(`/commands?clientId=${encodeURIComponent(command.clientId)}`)
        const next = commands.find((item) => item.id === command.id)
        if (active && next) setCommand(next)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "命令状态查询失败")
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [apiRequest, command?.clientId, command?.id, command?.status])

  const selectedClient = windowsClients.find((client) => client.id === clientId)
  const normalizedPath = expectedPath.trim()
  const valid = Boolean(
    selectedClient &&
    isValidProcessId(processId) &&
    isAbsoluteWindowsExecutablePath(normalizedPath) &&
    isValidProcessTimeout(timeoutSeconds),
  )
  const parsedResult = parseTerminateProcessResult(command?.result ?? null)

  async function submit() {
    if (!selectedClient || !valid || submitting) return
    setSubmitting(true)
    setError(null)
    setCommand(null)
    try {
      const freshClient = await apiRequest<Client>(`/clients/${encodeURIComponent(selectedClient.id)}`)
      if (freshClient.os !== "Windows") throw new Error("只能向 Windows 客户端下发进程终止命令")
      if (freshClient.status !== "online") throw new Error(`客户端 ${freshClient.name} 当前离线，命令尚未下发`)
      const numericProcessId = Number(processId)
      if (!window.confirm(
        `目标客户端：${freshClient.name}\nPID：${numericProcessId}\n预期路径：${normalizedPath}\n终止进程树：${killProcessTree ? "是" : "否"}\n超时：${timeoutSeconds} 秒`,
      )) return
      const created = await apiRequest<TerminateProcessCommand>(`/clients/${encodeURIComponent(freshClient.id)}/commands`, {
        method: "POST",
        body: JSON.stringify({
          type: "terminate-process",
          payload: { processId: numericProcessId, expectedPath: normalizedPath, timeoutSeconds, killProcessTree },
        }),
      })
      setCommand(created)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "进程终止命令下发失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Field label="目标 Windows 客户端" icon={<AppWindow className="h-3.5 w-3.5" />}>
          <Select
            value={clientId}
            onChange={setClientId}
            disabled={Boolean(fixedClientId)}
            placeholder="选择客户端"
            options={windowsClients.map((client) => ({ value: client.id, label: `${client.name} · ${client.status}` }))}
          />
        </Field>
        <Field label="进程 ID（PID）" icon={<CircleStop className="h-3.5 w-3.5" />}>
          <input
            inputMode="numeric"
            className={cn(inputCls, "font-mono")}
            value={processId}
            onChange={(event) => setProcessId(event.target.value)}
            placeholder="1234"
          />
        </Field>
      </div>

      <Field label="预期绝对映像路径">
        <input
          className={cn(inputCls, "font-mono")}
          value={expectedPath}
          onChange={(event) => setExpectedPath(event.target.value)}
          placeholder="C:\\Program Files\\Example\\worker.exe"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="超时（秒）">
          <input
            type="number"
            min={1}
            max={120}
            step={1}
            value={timeoutSeconds}
            onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
            className={cn(inputCls, "font-mono")}
          />
        </Field>
        <Field label="终止范围">
          <button
            type="button"
            role="switch"
            aria-checked={killProcessTree}
            onClick={() => setKillProcessTree((current) => !current)}
            className={cn(
              "flex h-11 items-center justify-between rounded-xl border px-4 text-sm transition-colors",
              killProcessTree ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface/60 text-muted-foreground",
            )}
          >
            <span>终止完整进程树</span>
            <span className={cn("h-5 w-9 rounded-full p-0.5 transition-colors", killProcessTree ? "bg-primary" : "bg-muted")}>
              <span className={cn("block h-4 w-4 rounded-full bg-white transition-transform", killProcessTree && "translate-x-4")} />
            </span>
          </button>
        </Field>
      </div>

      {(command || error) && (
        <div className="rounded-2xl border border-border bg-surface/60 p-4">
          {command && (
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-muted-foreground">命令 ID</p><p className="mt-1 break-all font-mono text-foreground">{command.id}</p></div>
              <div><p className="text-muted-foreground">状态</p><p className="mt-1 font-mono text-foreground">{command.status}</p></div>
              <div><p className="text-muted-foreground">PID</p><p className="mt-1 font-mono text-foreground">{parsedResult?.processId ?? (processId || "-")}</p></div>
              <div><p className="text-muted-foreground">终止进程树</p><p className="mt-1 font-mono text-foreground">{parsedResult ? (parsedResult.killProcessTree ? "是" : "否") : "-"}</p></div>
              {parsedResult && (
                <>
                  <div className="sm:col-span-2"><p className="text-muted-foreground">预期路径</p><p className="mt-1 break-all font-mono text-foreground">{parsedResult.expectedPath}</p></div>
                  <div className="sm:col-span-2"><p className="text-muted-foreground">实际路径</p><p className="mt-1 break-all font-mono text-foreground">{parsedResult.actualPath ?? "-"}</p></div>
                  <div><p className="text-muted-foreground">初始状态</p><p className="mt-1 font-mono text-foreground">{parsedResult.initialStatus}</p></div>
                  <div><p className="text-muted-foreground">最终状态</p><p className="mt-1 font-mono text-foreground">{parsedResult.finalStatus}</p></div>
                  <div><p className="text-muted-foreground">耗时</p><p className="mt-1 font-mono text-foreground">{parsedResult.durationMs} ms</p></div>
                  <div><p className="text-muted-foreground">超时</p><p className="mt-1 font-mono text-foreground">{parsedResult.timedOut ? "是" : "否"}</p></div>
                </>
              )}
            </div>
          )}
          {(error || parsedResult?.error) && <p className="mt-3 break-words text-sm text-negative">{error || parsedResult?.error}</p>}
        </div>
      )}

      <div className="mt-auto flex justify-end border-t border-border pt-4">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!valid || submitting}
          className="flex h-11 items-center gap-2 rounded-xl bg-negative px-5 text-sm font-semibold text-white transition-transform duration-200 hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleStop className="h-4 w-4" />}
          终止进程
        </button>
      </div>
    </div>
  )
}

function WindowsSystemRestart({ clientId: fixedClientId }: DetailProps) {
  const { clients, apiRequest } = useServerData()
  const windowsClients = clients.filter(
    (client) => client.os === "Windows" && (fixedClientId ? client.id === fixedClientId : client.status === "online"),
  )
  const [clientId, setClientId] = useState(fixedClientId ?? windowsClients[0]?.id ?? "")
  const [delaySeconds, setDelaySeconds] = useState(30)
  const [reason, setReason] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [command, setCommand] = useState<RestartSystemCommand | null>(null)
  const [error, setError] = useState<string | null>(null)
  const clientKey = windowsClients.map((client) => client.id).join("|")

  useEffect(() => {
    if (fixedClientId) {
      if (clientId !== fixedClientId) setClientId(fixedClientId)
      return
    }
    if (windowsClients.some((client) => client.id === clientId)) return
    setClientId(windowsClients[0]?.id ?? "")
    setConfirming(false)
  }, [clientId, clientKey, fixedClientId])

  useEffect(() => {
    if (!confirming) return
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) setConfirming(false)
    }
    window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [confirming, submitting])

  useEffect(() => {
    if (!command || terminalCommandStatuses.includes(command.status)) return
    let active = true
    const poll = async () => {
      try {
        const commands = await apiRequest<RestartSystemCommand[]>(`/commands?clientId=${encodeURIComponent(command.clientId)}`)
        const next = commands.find((item) => item.id === command.id)
        if (active && next) setCommand(next)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "命令状态查询失败")
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [apiRequest, command?.clientId, command?.id, command?.status])

  const selectedClient = windowsClients.find((client) => client.id === clientId)
  const normalizedReason = normalizeRestartReason(reason)
  const valid = Boolean(selectedClient && isValidRestartDelay(delaySeconds) && isValidRestartReason(reason))
  const parsedResult = parseRestartSystemResult(command?.result ?? null)
  const reasonLength = [...reason.trim()].length

  async function confirmRestart() {
    if (!selectedClient || !valid || submitting) return
    setSubmitting(true)
    setError(null)
    setCommand(null)
    try {
      const freshClient = await apiRequest<Client>(`/clients/${encodeURIComponent(selectedClient.id)}`)
      if (freshClient.os !== "Windows") throw new Error("只能向 Windows 客户端下发系统重启命令")
      if (freshClient.status !== "online") throw new Error(`客户端 ${freshClient.name} 当前离线，系统重启命令尚未下发`)
      const created = await apiRequest<RestartSystemCommand>(`/clients/${encodeURIComponent(freshClient.id)}/commands`, {
        method: "POST",
        body: JSON.stringify({
          type: "restart-system",
          payload: { delaySeconds, ...(normalizedReason ? { reason: normalizedReason } : {}) },
        }),
      })
      setCommand(created)
      setConfirming(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "系统重启命令下发失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <div className="rounded-2xl border border-negative/35 bg-negative/8 p-4 text-sm text-foreground">
        <p className="font-semibold text-negative">高风险操作：设备将重启</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Agent 仅在本机策略明确开启后执行，并在设备重新启动、启动标识变化后才报告成功。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={fixedClientId ? "目标 Windows 客户端" : "在线 Windows 客户端"} icon={<AppWindow className="h-3.5 w-3.5" />}>
          <Select
            value={clientId}
            onChange={setClientId}
            disabled={Boolean(fixedClientId)}
            placeholder="选择在线客户端"
            options={windowsClients.map((client) => ({ value: client.id, label: `${client.name} · ${client.status}` }))}
          />
        </Field>
        <Field label="延迟（秒）" icon={<CalendarClock className="h-3.5 w-3.5" />}>
          <input
            type="number"
            min={0}
            max={300}
            step={1}
            value={delaySeconds}
            onChange={(event) => setDelaySeconds(Number(event.target.value))}
            className={cn(inputCls, "font-mono")}
          />
        </Field>
      </div>

      <Field label={`原因（可选，${reasonLength}/256）`}>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          placeholder="例如：Nacho administrator requested restart"
          className={cn(inputCls, "h-auto min-h-24 resize-y py-3")}
        />
      </Field>

      {!isValidRestartReason(reason) && (
        <p className="text-xs text-negative">原因最多 256 个可打印字符，且不得包含换行或控制字符。</p>
      )}

      {(command || error) && (
        <div className="rounded-2xl border border-border bg-surface/60 p-4">
          {command && (
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-muted-foreground">命令 ID</p><p className="mt-1 break-all font-mono text-foreground">{command.id}</p></div>
              <div><p className="text-muted-foreground">状态</p><p className="mt-1 font-mono text-foreground">{command.status}</p></div>
              <div><p className="text-muted-foreground">跨重启阶段</p><p className="mt-1 font-mono text-foreground">{parsedResult?.phase ?? (command.status === "running" ? "等待阶段报告" : "-")}</p></div>
              <div><p className="text-muted-foreground">已核实重启</p><p className="mt-1 font-mono text-foreground">{parsedResult ? (parsedResult.verifiedAfterRestart ? "是" : "否") : "-"}</p></div>
              <div><p className="text-muted-foreground">延迟</p><p className="mt-1 font-mono text-foreground">{parsedResult?.delaySeconds ?? delaySeconds} 秒</p></div>
              <div><p className="text-muted-foreground">耗时</p><p className="mt-1 font-mono text-foreground">{parsedResult ? `${parsedResult.durationMs} ms` : "-"}</p></div>
              <div className="sm:col-span-2"><p className="text-muted-foreground">请求时间</p><p className="mt-1 break-all font-mono text-foreground">{parsedResult?.requestedAt ?? "-"}</p></div>
              <div className="sm:col-span-2"><p className="text-muted-foreground">前一启动标识</p><p className="mt-1 break-all font-mono text-foreground">{parsedResult?.previousBootId ?? "-"}</p></div>
              <div className="sm:col-span-2"><p className="text-muted-foreground">当前启动标识</p><p className="mt-1 break-all font-mono text-foreground">{parsedResult?.currentBootId ?? "-"}</p></div>
              <div className="sm:col-span-4"><p className="text-muted-foreground">原因</p><p className="mt-1 break-words text-foreground">{parsedResult?.reason ?? normalizedReason ?? "未填写"}</p></div>
            </div>
          )}
          {(error || parsedResult?.error) && <p className="mt-3 break-words text-sm text-negative">{error || parsedResult?.error}</p>}
          {command?.result && !parsedResult && <p className="mt-3 text-xs text-negative">Agent 返回了无法解析的结构化结果。</p>}
        </div>
      )}

      <div className="mt-auto flex justify-end border-t border-border pt-4">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={!valid || submitting}
          className="flex h-11 items-center gap-2 rounded-xl bg-negative px-5 text-sm font-semibold text-white transition-transform duration-200 hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
        >
          <RotateCw className="h-4 w-4" />
          检查并重启
        </button>
      </div>

      {confirming && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" role="presentation">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="restart-confirm-title"
            aria-describedby="restart-confirm-description"
            className="w-full max-w-lg rounded-3xl border border-negative/40 bg-card p-6 shadow-2xl"
          >
            <h3 id="restart-confirm-title" className="text-lg font-semibold text-negative">确认系统重启</h3>
            <p id="restart-confirm-description" className="mt-2 text-sm text-muted-foreground">
              设备将重启，未保存的交互式工作可能丢失；最终成功必须由重启后的 Agent 核实。
            </p>
            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 rounded-2xl bg-surface/70 p-4 text-sm">
              <dt className="text-muted-foreground">目标客户端</dt><dd className="break-all font-mono text-foreground">{selectedClient.name}</dd>
              <dt className="text-muted-foreground">延迟</dt><dd className="font-mono text-foreground">{delaySeconds} 秒</dd>
              <dt className="text-muted-foreground">原因</dt><dd className="break-words text-foreground">{normalizedReason ?? "未填写"}</dd>
            </dl>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" autoFocus disabled={submitting} onClick={() => setConfirming(false)} className="h-11 rounded-xl border border-border px-5 text-sm font-medium text-foreground disabled:opacity-50">取消</button>
              <button type="button" disabled={submitting} onClick={() => void confirmRestart()} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-negative px-5 text-sm font-semibold text-white disabled:opacity-50">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                确认，设备将重启
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const logSourceLabels: Record<LogSource, string> = {
  agent: "Agent 诊断",
  system: "Windows System",
  application: "Windows Application",
}

function LogMessage({ message }: { message: string }) {
  if (message.length <= 180) return <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-5">{message || "（空消息）"}</pre>
  return (
    <details className="group max-w-xl">
      <summary className="cursor-pointer break-words text-xs leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {message.slice(0, 180)}… <span className="text-primary group-open:hidden">展开</span><span className="hidden text-primary group-open:inline">收起</span>
      </summary>
      <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-background/50 p-2 font-sans text-xs leading-5">{message}</pre>
    </details>
  )
}

function WindowsLogCollection({ clientId: fixedClientId }: DetailProps) {
  const { clients, apiRequest } = useServerData()
  const windowsClients = clients.filter(
    (client) => client.os === "Windows" && (fixedClientId ? client.id === fixedClientId : client.status === "online"),
  )
  const now = Date.now()
  const [clientId, setClientId] = useState(fixedClientId ?? windowsClients[0]?.id ?? "")
  const [sources, setSources] = useState<LogSource[]>([...logSources])
  const [sinceInput, setSinceInput] = useState(() => dateToUtcInput(new Date(now - 61 * 60 * 1000)))
  const [untilInput, setUntilInput] = useState(() => dateToUtcInput(new Date(now - 60 * 1000)))
  const [maxEntries, setMaxEntries] = useState(200)
  const [command, setCommand] = useState<CollectLogsCommand | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clientKey = windowsClients.map((client) => client.id).join("|")

  useEffect(() => {
    if (fixedClientId) {
      if (clientId !== fixedClientId) setClientId(fixedClientId)
      return
    }
    if (windowsClients.some((client) => client.id === clientId)) return
    setClientId(windowsClients[0]?.id ?? "")
  }, [clientId, clientKey, fixedClientId])

  useEffect(() => {
    if (!command || terminalCommandStatuses.includes(command.status)) return
    let active = true
    const poll = async () => {
      try {
        const commands = await apiRequest<CollectLogsCommand[]>(`/commands?clientId=${encodeURIComponent(command.clientId)}`)
        const next = commands.find((item) => item.id === command.id)
        if (active && next) setCommand(next)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "命令状态查询失败")
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [apiRequest, command?.clientId, command?.id, command?.status])

  const selectedClient = windowsClients.find((client) => client.id === clientId)
  const sinceUtc = utcInputToIso(sinceInput)
  const untilUtc = utcInputToIso(untilInput)
  const windowValid = isValidLogWindow(sinceUtc, untilUtc)
  const valid = Boolean(selectedClient && sources.length > 0 && windowValid && isValidMaxEntries(maxEntries))
  const parsedResult = parseCollectLogsResult(command?.result ?? null)

  function toggleSource(source: LogSource) {
    setSources((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source])
  }

  async function submit() {
    if (!selectedClient || !valid || !sinceUtc || !untilUtc || submitting) return
    setSubmitting(true)
    setError(null)
    setCommand(null)
    try {
      const freshClient = await apiRequest<Client>(`/clients/${encodeURIComponent(selectedClient.id)}`)
      if (freshClient.os !== "Windows") throw new Error("只能向 Windows 客户端下发日志采集命令")
      if (freshClient.status !== "online") throw new Error(`客户端 ${freshClient.name} 当前离线，日志采集命令尚未下发`)
      const created = await apiRequest<CollectLogsCommand>(`/clients/${encodeURIComponent(freshClient.id)}/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "collect-logs", payload: { sources, sinceUtc, untilUtc, maxEntries } }),
      })
      setCommand(created)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "日志采集命令下发失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full min-w-0 max-w-full flex-col gap-5 overflow-auto pr-1">
      <div className="rounded-2xl border border-primary/25 bg-primary/7 p-4 text-sm text-foreground">
        <p className="font-semibold text-primary">只读受限快照</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          仅采集固定 Agent、System 与 Application 来源；目标 Agent 的 allowLogCollection 本机策略会给出最终允许或拒绝反馈。
        </p>
      </div>

      <Field label={fixedClientId ? "目标 Windows 客户端" : "在线 Windows 客户端"} icon={<AppWindow className="h-3.5 w-3.5" />}>
        <Select
          value={clientId}
          onChange={setClientId}
          disabled={Boolean(fixedClientId)}
          placeholder="选择在线客户端"
          options={windowsClients.map((client) => ({ value: client.id, label: `${client.name} · ${client.status}` }))}
        />
      </Field>

      <fieldset className="min-w-0">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">允许的日志来源</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {logSources.map((source) => {
            const selected = sources.includes(source)
            return (
              <button
                key={source}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleSource(source)}
                className={cn(
                  "min-w-0 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  selected ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface/60 text-muted-foreground",
                )}
              >
                <span className="block break-words font-medium">{logSourceLabels[source]}</span>
                <span className="mt-0.5 block font-mono opacity-70">{source}</span>
              </button>
            )
          })}
        </div>
        {sources.length === 0 && <p className="mt-2 text-xs text-negative">至少选择一个固定来源。</p>}
      </fieldset>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Field label="开始时间（UTC）" icon={<CalendarClock className="h-3.5 w-3.5" />}>
          <input type="datetime-local" step={60} value={sinceInput} onChange={(event) => setSinceInput(event.target.value)} className={cn(inputCls, "font-mono")} />
        </Field>
        <Field label="结束时间（UTC）" icon={<CalendarClock className="h-3.5 w-3.5" />}>
          <input type="datetime-local" step={60} value={untilInput} onChange={(event) => setUntilInput(event.target.value)} className={cn(inputCls, "font-mono")} />
        </Field>
        <Field label="最大条数（1–1000）">
          <input type="number" min={1} max={1000} step={1} value={maxEntries} onChange={(event) => setMaxEntries(Number(event.target.value))} className={cn(inputCls, "font-mono")} />
        </Field>
      </div>
      {!windowValid && <p className="text-xs text-negative">UTC 时间必须有效、开始早于结束、跨度不超过 24 小时，且结束时间不得位于未来。</p>}

      {(command || error) && (
        <section className="min-w-0 max-w-full rounded-2xl border border-border bg-surface/60 p-4" aria-live="polite">
          {command && (
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-muted-foreground">命令 ID</p><p className="mt-1 break-all font-mono text-foreground">{command.id}</p></div>
              <div><p className="text-muted-foreground">状态</p><p className="mt-1 font-mono text-foreground">{command.status}</p></div>
              <div><p className="text-muted-foreground">截断</p><p className="mt-1 font-mono text-foreground">{parsedResult ? (parsedResult.truncated ? "是" : "否") : "-"}</p></div>
              <div><p className="text-muted-foreground">耗时</p><p className="mt-1 font-mono text-foreground">{parsedResult ? `${parsedResult.durationMs} ms` : "-"}</p></div>
            </div>
          )}
          {parsedResult && (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {parsedResult.sources.map((source) => (
                  <span key={source} className="rounded-full bg-background/60 px-3 py-1 text-xs text-muted-foreground">
                    {logSourceLabels[source]} <strong className="font-mono text-foreground">{parsedResult.countsBySource[source]}</strong>
                  </span>
                ))}
              </div>
              {parsedResult.error && <p className="mt-3 break-words text-sm text-negative">{parsedResult.error}</p>}
              <div className="mt-4 max-w-full overflow-x-auto rounded-xl border border-border" tabIndex={0} aria-label="采集到的日志表格，可横向滚动">
                {parsedResult.entries.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">所选时间窗口内没有可显示的日志。</div>
                ) : (
                  <table className="min-w-[760px] w-full table-fixed text-left text-xs">
                    <thead className="bg-background/60 text-muted-foreground">
                      <tr><th className="w-40 p-3">UTC 时间</th><th className="w-24 p-3">来源</th><th className="w-24 p-3">级别 / ID</th><th className="w-36 p-3">提供程序</th><th className="p-3">消息</th></tr>
                    </thead>
                    <tbody>
                      {parsedResult.entries.map((entry, index) => (
                        <tr key={`${entry.timestampUtc}-${entry.source}-${entry.eventId ?? "none"}-${index}`} className="border-t border-border align-top">
                          <td className="break-all p-3 font-mono text-muted-foreground">{entry.timestampUtc}</td>
                          <td className="break-words p-3 font-mono">{entry.source}</td>
                          <td className="break-words p-3">{entry.level ?? "-"}<br /><span className="font-mono text-muted-foreground">{entry.eventId ?? "-"}</span></td>
                          <td className="break-words p-3">{entry.provider ?? "-"}</td>
                          <td className="p-3"><LogMessage message={entry.message} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
          {error && <p className="mt-3 break-words text-sm text-negative">{error}</p>}
          {command?.result && !parsedResult && <p className="mt-3 text-xs text-negative">Agent 返回了未通过完整字段校验的结构化结果。</p>}
        </section>
      )}

      <div className="mt-auto flex justify-end border-t border-border pt-4">
        <button type="button" onClick={() => void submit()} disabled={!valid || submitting} className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-50">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileClock className="h-4 w-4" />}
          采集日志快照
        </button>
      </div>
    </div>
  )
}

function WindowsServiceManage({ clientId: fixedClientId }: DetailProps) {
  const { clients, apiRequest } = useServerData()
  const windowsClients = clients.filter((client) => client.os === "Windows")
  const [clientId, setClientId] = useState(fixedClientId ?? windowsClients[0]?.id ?? "")
  const [serviceName, setServiceName] = useState("")
  const [action, setAction] = useState<ServiceAction>("query")
  const [timeoutSeconds, setTimeoutSeconds] = useState(30)
  const [command, setCommand] = useState<ServiceCommand | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const windowsClientKey = windowsClients.map((client) => client.id).join("|")

  useEffect(() => {
    if (fixedClientId) {
      if (clientId !== fixedClientId) setClientId(fixedClientId)
      return
    }
    if (windowsClients.some((client) => client.id === clientId)) return
    setClientId(windowsClients[0]?.id ?? "")
  }, [clientId, fixedClientId, windowsClientKey])

  useEffect(() => {
    if (!command || terminalCommandStatuses.includes(command.status)) return
    let active = true
    const poll = async () => {
      try {
        const commands = await apiRequest<ServiceCommand[]>(`/commands?clientId=${encodeURIComponent(command.clientId)}`)
        const next = commands.find((item) => item.id === command.id)
        if (active && next) setCommand(next)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "命令状态查询失败")
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [apiRequest, command?.clientId, command?.id, command?.status])

  const selectedClient = windowsClients.find((client) => client.id === clientId)
  const parsedResult = parseServiceResult(command?.result ?? null)

  async function submit() {
    const normalizedName = serviceName.trim()
    if (!selectedClient || !normalizedName || timeoutSeconds < 1 || timeoutSeconds > 120) return
    if (selectedClient.status !== "online") {
      setError(`客户端 ${selectedClient.name} 当前离线，命令尚未下发`)
      return
    }
    if (!window.confirm(`目标客户端：${selectedClient.name}\n服务名称：${normalizedName}\n操作：${action}\n超时：${timeoutSeconds} 秒`)) return
    setSubmitting(true)
    setError(null)
    setCommand(null)
    try {
      const created = await apiRequest<ServiceCommand>(`/clients/${encodeURIComponent(selectedClient.id)}/commands`, {
        method: "POST",
        body: JSON.stringify({
          type: "manage-service",
          payload: { serviceName: normalizedName, action, timeoutSeconds },
        }),
      })
      setCommand(created)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "服务控制命令下发失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Field label="目标 Windows 客户端" icon={<AppWindow className="h-3.5 w-3.5" />}>
          <Select
            value={clientId}
            onChange={setClientId}
            disabled={Boolean(fixedClientId)}
            placeholder="选择客户端"
            options={windowsClients.map((client) => ({
              value: client.id,
              label: `${client.name} · ${client.status}`,
            }))}
          />
        </Field>
        <Field label="服务名称" icon={<Server className="h-3.5 w-3.5" />}>
          <input
            className={cn(inputCls, "font-mono")}
            value={serviceName}
            onChange={(event) => setServiceName(event.target.value)}
            placeholder="ExampleService"
          />
        </Field>
      </div>

      <Field label="操作">
        <div className="grid grid-cols-2 gap-2 sm:hidden">
          {serviceActions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setAction(option.id)}
              className={cn(
                "h-10 rounded-lg border text-sm font-medium transition-colors",
                action === option.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface/60 text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="hidden sm:block">
          <SegmentedControl fill value={action} onChange={setAction} options={serviceActions} />
        </div>
      </Field>

      <Field label="超时（秒）">
        <input
          type="number"
          min={1}
          max={120}
          step={1}
          value={timeoutSeconds}
          onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
          className={cn(inputCls, "max-w-40 font-mono")}
        />
      </Field>

      {(command || error) && (
        <div className="rounded-2xl border border-border bg-surface/60 p-4">
          {command && (
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-muted-foreground">命令 ID</p><p className="mt-1 break-all font-mono text-foreground">{command.id}</p></div>
              <div><p className="text-muted-foreground">状态</p><p className="mt-1 font-mono text-foreground">{command.status}</p></div>
              <div><p className="text-muted-foreground">初始状态</p><p className="mt-1 font-mono text-foreground">{parsedResult?.initialStatus ?? "-"}</p></div>
              <div><p className="text-muted-foreground">最终状态</p><p className="mt-1 font-mono text-foreground">{parsedResult?.finalStatus ?? "-"}</p></div>
              {parsedResult && (
                <>
                  <div><p className="text-muted-foreground">服务</p><p className="mt-1 font-mono text-foreground">{parsedResult.serviceName}</p></div>
                  <div><p className="text-muted-foreground">操作</p><p className="mt-1 font-mono text-foreground">{parsedResult.action}</p></div>
                  <div><p className="text-muted-foreground">耗时</p><p className="mt-1 font-mono text-foreground">{parsedResult.durationMs} ms</p></div>
                  <div><p className="text-muted-foreground">超时</p><p className="mt-1 font-mono text-foreground">{parsedResult.timedOut ? "是" : "否"}</p></div>
                </>
              )}
            </div>
          )}
          {(error || parsedResult?.error) && <p className="mt-3 break-words text-sm text-negative">{error || parsedResult?.error}</p>}
        </div>
      )}

      <div className="mt-auto flex justify-end border-t border-border pt-4">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!selectedClient || !serviceName.trim() || timeoutSeconds < 1 || timeoutSeconds > 120 || submitting}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          下发命令
        </button>
      </div>
    </div>
  )
}

const services = [
  { name: "nginx.service", desc: "A high performance web server", running: true },
  { name: "docker.service", desc: "Docker Application Container Engine", running: true },
  { name: "sshd.service", desc: "OpenSSH server daemon", running: true },
  { name: "mysql.service", desc: "MySQL Community Server", running: false },
]

function ServiceManage({ os, clientId }: DetailProps) {
  if (os === "windows") return <WindowsServiceManage os={os} clientId={clientId} />
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <Field label="systemd 服务列表" icon={<Server className="h-3.5 w-3.5" />}>
        <div className="flex flex-col gap-2">
          {services.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface/60 px-4 py-3.5 transition-colors hover:bg-surface"
            >
              <div className="min-w-0 leading-tight">
                <p className="truncate font-mono text-sm font-medium text-foreground">{s.name}</p>
                <p className="truncate text-xs text-muted-foreground">{s.desc}</p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                    s.running ? "bg-primary/12 text-primary" : "bg-surface text-muted-foreground",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", s.running ? "bg-primary" : "bg-muted-foreground/50")} />
                  {s.running ? "active" : "inactive"}
                </span>
                <button className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground">
                  {s.running ? "停止" : "启动"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </Field>

      <TargetPicker os={os} clientId={clientId} />
    </div>
  )
}

/* ---------- 子功能：计划任务（Linux Cron） ---------- */
const cronJobs = [
  { schedule: "0 3 * * *", cmd: "/usr/local/bin/backup.sh", note: "每日 03:00 备份" },
  { schedule: "*/10 * * * *", cmd: "curl -s http://localhost/health", note: "�� 10 分钟���康检查" },
  { schedule: "0 0 * * 0", cmd: "apt-get update && apt-get -y upgrade", note: "每周日更新系统" },
]

function CronManage({ os, clientId }: DetailProps) {
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <Field label="Crontab 定时任务" icon={<CalendarClock className="h-3.5 w-3.5" />}>
        <div className="flex flex-col gap-2">
          {cronJobs.map((j) => (
            <div
              key={j.cmd}
              className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface/60 px-4 py-3.5 transition-colors hover:bg-surface"
            >
              <div className="min-w-0 leading-tight">
                <p className="truncate font-mono text-sm font-medium text-foreground">{j.cmd}</p>
                <p className="truncate text-xs text-muted-foreground">
                  <span className="font-mono text-primary">{j.schedule}</span> · {j.note}
                </p>
              </div>
              <button
                aria-label="删除任务"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-negative"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </Field>

      <TargetPicker os={os} clientId={clientId} />

      <div className="mt-auto flex justify-end gap-3 border-t border-border pt-4">
        <PrimaryButton icon={<Plus className="h-4 w-4" />}>新建定时任务</PrimaryButton>
      </div>
    </div>
  )
}

/* ---------- 系统类型 & 工具清单 ---------- */
/* 依据客户端信息粗略判断所属系统（无字段时按平均分配以便演示） */
function matchOS(c: Client, os: OS): boolean {
  const raw = `${(c as Record<string, unknown>).os ?? ""} ${(c as Record<string, unknown>).system ?? ""} ${
    (c as Record<string, unknown>).platform ?? ""
  }`.toLowerCase()
  if (raw.includes("win")) return os === "windows"
  if (raw.includes("linux") || raw.includes("ubuntu") || raw.includes("centos") || raw.includes("debian"))
    return os === "linux"
  // 无系统字段时用 id 的哈希稳定分配，保证两个分组都有数据
  const hash = c.id.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0)
  return (hash % 2 === 0) === (os === "windows")
}

type Tool = {
  id: string
  title: string
  desc: string
  icon: LucideIcon
  tint: string
  Detail: (props: DetailProps) => React.ReactElement
}

const windowsTools: Tool[] = [
  { id: "service", title: "服务控制", desc: "查询、启动、停止或重启 Windows 服务", icon: Server, tint: "oklch(0.72 0.16 60)", Detail: ServiceManage },
  { id: "terminate-process", title: "进程终止", desc: "按 PID 与允许路径安全终止本机进程", icon: CircleStop, tint: "oklch(0.65 0.2 25)", Detail: WindowsProcessTerminate },
  { id: "restart-system", title: "系统重启", desc: "经本机策略确认后重启 Windows 并跨启动核验", icon: RotateCw, tint: "oklch(0.62 0.22 25)", Detail: WindowsSystemRestart },
  { id: "collect-logs", title: "日志采集", desc: "采集受限来源的本机诊断与 Windows 事件快照", icon: FileClock, tint: "oklch(0.5 0.15 200)", Detail: WindowsLogCollection },
  { id: "batch-install", title: "批量安装", desc: "向多台客户端一键部署软件包", icon: DownloadCloud, tint: "oklch(0.82 0.19 145)", Detail: BatchInstall },
  { id: "file-deploy", title: "文件下发", desc: "分发文件到指定目录", icon: FileUp, tint: "oklch(0.5 0.15 200)", Detail: FileDeploy },
  { id: "command", title: "命令执行", desc: "远程运行 CMD / PowerShell", icon: SquareTerminal, tint: "oklch(0.72 0.16 60)", Detail: CommandRun },
  { id: "message", title: "消息推送", desc: "向客户端发送弹窗通知", icon: MessageSquare, tint: "oklch(0.82 0.19 145)", Detail: MessagePush },
  { id: "users", title: "用户管理", desc: "管理系统账户与权限", icon: Users, tint: "oklch(0.5 0.15 200)", Detail: UserManage },
  { id: "webpage", title: "打开网页", desc: "在客户端浏览器打开地址", icon: Globe, tint: "oklch(0.72 0.16 60)", Detail: OpenWebpage },
  { id: "registry", title: "注册表", desc: "查看与编辑注册表键值", icon: KeyRound, tint: "oklch(0.82 0.19 145)", Detail: Registry },
]

const linuxTools: Tool[] = [
  { id: "batch-install", title: "批量安装", desc: "通过 apt / yum 批量装包", icon: DownloadCloud, tint: "oklch(0.82 0.19 145)", Detail: BatchInstall },
  { id: "file-deploy", title: "文件下发", desc: "分发文件到指定目录", icon: FileUp, tint: "oklch(0.5 0.15 200)", Detail: FileDeploy },
  { id: "command", title: "命令执行", desc: "远程运行 Shell 命令", icon: SquareTerminal, tint: "oklch(0.72 0.16 60)", Detail: CommandRun },
  { id: "message", title: "消息推送", desc: "向客户端发送广播通知", icon: MessageSquare, tint: "oklch(0.82 0.19 145)", Detail: MessagePush },
  { id: "users", title: "用户管理", desc: "管��系统账户与权限", icon: Users, tint: "oklch(0.5 0.15 200)", Detail: UserManage },
  { id: "service", title: "服务管理", desc: "管理 systemd 服务状态", icon: Server, tint: "oklch(0.72 0.16 60)", Detail: ServiceManage },
  { id: "cron", title: "计划任务", desc: "编辑 Crontab 定时任务", icon: CalendarClock, tint: "oklch(0.82 0.19 145)", Detail: CronManage },
]

const osTabs: { id: OS; label: string; icon: LucideIcon }[] = [
  { id: "windows", label: "Windows", icon: AppWindow },
  { id: "linux", label: "Linux", icon: Terminal },
]

/* ---------- 单机管理中心（与批量操作的三列大卡片刻意区分） ---------- */

/* 功能按用途分区，单机模式下以分区列表呈现 */
const clientToolSections: { label: string; hint: string; ids: string[] }[] = [
  { label: "运行与进程", hint: "服务、进程与重启", ids: ["service", "terminate-process", "restart-system", "command", "cron"] },
  { label: "文件与部署", hint: "装包与下发", ids: ["batch-install", "file-deploy"] },
  { label: "系统与账户", hint: "账户、注册表与诊断", ids: ["users", "registry", "collect-logs", "message", "webpage"] },
]

function tintSoft(tint: string, amount: number) {
  return `color-mix(in oklab, ${tint} ${amount}%, transparent)`
}

function formatUptime(seconds: number) {
  if (seconds <= 0) return "—"
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  if (d > 0) return `${d} 天 ${h} 小时`
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`
}

function MetricBar({ label, value }: { label: string; value: number }) {
  const level = value >= 85 ? "bg-negative" : value >= 65 ? "bg-[#dce02d]" : "bg-primary"
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="font-mono text-xs text-foreground">{Math.round(value)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-background/60">
        <div className={cn("h-full rounded-full transition-[width] duration-500", level)} style={{ width: `${Math.min(100, Math.max(2, value))}%` }} />
      </div>
    </div>
  )
}

/* 左侧设备档案：单机管理独有的身份区，批量操作没有 */
function DeviceProfile({ client }: { client: Client }) {
  const s = statusMeta[client.status]
  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: "主机名", value: client.hostname, mono: true },
    { label: "IP 地址", value: client.ip, mono: true },
    { label: "分组", value: client.group || "未分组" },
    { label: "版本", value: client.version, mono: true },
  ]

  return (
    <aside className="flex shrink-0 flex-col gap-4 self-start rounded-2xl border border-border bg-surface/40 p-4 lg:w-64 xl:w-72">
      <div className="flex items-center gap-3">
        <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15", s.ring)}>
          <MonitorSmartphone className="h-6 w-6 text-primary" />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold">{client.name}</p>
          <span className={cn("mt-1 flex items-center gap-1.5 text-xs font-medium", s.text)}>
            <span className={cn("h-2 w-2 rounded-full", s.dot)} />
            {s.label} · {client.os}
          </span>
        </div>
      </div>

      <dl className="flex flex-col gap-2 border-t border-border pt-3 text-xs">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className={cn("min-w-0 truncate text-foreground", r.mono && "font-mono")}>{r.value}</dd>
          </div>
        ))}
      </dl>

      {client.metrics ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <MetricBar label="CPU" value={client.metrics.cpu} />
          <MetricBar label="内存" value={client.metrics.memory} />
          <MetricBar label="磁盘" value={client.metrics.disk} />
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            运行 {formatUptime(client.metrics.uptime)}
          </p>
        </div>
      ) : (
        <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">暂无实时指标数据</p>
      )}

      {client.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
          {client.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">
              {tag}
            </span>
          ))}
        </div>
      )}
    </aside>
  )
}

/* 单机功能列表：分区标题 + 左侧色条的紧凑行，与批量操作的实心图标大卡片区分 */
function ClientToolHub({
  client,
  tools,
  onOpen,
}: {
  client: Client
  tools: Tool[]
  onOpen: (id: string) => void
}) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  const used = new Set<string>()
  const sections = clientToolSections
    .map((sec) => {
      const items = sec.ids.map((id) => byId.get(id)).filter((t): t is Tool => Boolean(t))
      items.forEach((t) => used.add(t.id))
      return { ...sec, items }
    })
    .filter((sec) => sec.items.length > 0)
  const rest = tools.filter((t) => !used.has(t.id))
  if (rest.length > 0) sections.push({ label: "其他功能", hint: "扩展命令", items: rest, ids: [] })

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-auto pr-1 lg:flex-row">
      <DeviceProfile client={client} />

      <div className="flex min-w-0 flex-1 flex-col gap-5">
        {sections.map((sec) => (
          <section key={sec.label} className="flex flex-col gap-2.5">
            <div className="flex items-center gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{sec.label}</h3>
              <span className="hidden text-[11px] text-muted-foreground/70 sm:inline">{sec.hint}</span>
              <span className="h-px flex-1 bg-border" />
              <span className="font-mono text-[11px] text-muted-foreground/70">{sec.items.length}</span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sec.items.map((t) => {
                const Icon = t.icon
                return (
                  <button
                    key={t.id}
                    onClick={() => onOpen(t.id)}
                    className="group flex items-center gap-3 overflow-hidden rounded-xl border border-border/70 bg-surface/40 py-2.5 pr-3 text-left transition-all duration-300 hover:border-primary/40 hover:bg-surface"
                  >
                    <span className="h-11 w-1 shrink-0 rounded-r-full transition-all duration-300 group-hover:h-12" style={{ backgroundColor: t.tint }} />
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-105"
                      style={{ backgroundColor: tintSoft(t.tint, 18), color: t.tint }}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block text-sm font-semibold">{t.title}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{t.desc}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-primary" />
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

/* 批量操作网格：作用范围条 + 实心图标大卡片（与单机的分区列表刻意区分） */
function BatchToolGrid({ os, tools, onOpen }: { os: OS; tools: Tool[]; onOpen: (id: string) => void }) {
  const { clients } = useServerData()
  const osLabel = os === "windows" ? "Windows" : "Linux"
  const targets = clients.filter((c) => (os === "windows" ? c.os === "Windows" : c.os === "Linux"))
  const online = targets.filter((c) => c.status === "online").length

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* 作用范围：批量模式独有的目标提示 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-primary/25 bg-primary/8 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Users className="h-4 w-4" />
          作用范围
        </span>
        <span className="text-sm text-foreground">全部 {osLabel} 客户端</span>
        {targets.length > 0 && (
          <>
            <span className="hidden h-4 w-px bg-primary/25 sm:block" />
            <span className="font-mono text-xs text-muted-foreground">
              {targets.length} 台目标 · {online} 台在线
            </span>
          </>
        )}
        <span className="ml-auto text-xs text-muted-foreground/80">操作将同时下发到所有匹配设备</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pr-1">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tools.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => onOpen(t.id)}
                className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-surface/60 p-4 text-left transition-all duration-300 hover:-translate-y-1 hover:bg-surface hover:shadow-[0_14px_32px_-10px_oklch(0_0_0_/_55%)]"
              >
                {/* 顶部色条：悬停时铺满整条，强调“批量下发” */}
                <span
                  className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100"
                  style={{ backgroundColor: t.tint }}
                />
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-105"
                    style={{ backgroundColor: t.tint, boxShadow: `0 10px 24px -12px ${t.tint}` }}
                  >
                    <Icon className="h-6 w-6 text-white" />
                  </span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/40 text-muted-foreground transition-all duration-300 group-hover:border-primary/50 group-hover:text-primary">
                    <ChevronRight className="h-4 w-4" />
                  </span>
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="text-sm font-semibold">{t.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.desc}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ManagementPanel({ client, onExit }: { client?: Client; onExit?: () => void }) {
  const clientOS: OS = client?.os === "Linux" ? "linux" : "windows"
  const [os, setOS] = useState<OS>(clientOS)
  const [activeId, setActiveId] = useState<string | null>(null)
  // 当前内容区的进场动画：OS 切换时按药丸方向水平平移，钻取工具时竖直进场
  const [enterAnim, setEnterAnim] = useState("animate-panel-enter")

  const tools = os === "windows" ? windowsTools : linuxTools
  const active = tools.find((t) => t.id === activeId) ?? null

  const osIndex = (o: OS) => osTabs.findIndex((t) => t.id === o)

  const switchOS = (next: OS) => {
    if (next === os) return
    // 药丸右移 → 新内容从右侧滑入；左移 → 从左侧滑入，与滑块同向
    setEnterAnim(osIndex(next) > osIndex(os) ? "animate-slide-in-right" : "animate-slide-in-left")
    setOS(next)
    setActiveId(null)
  }

  const openTool = (id: string) => {
    setEnterAnim("animate-panel-enter")
    setActiveId(id)
  }

  const back = () => {
    if (!activeId && client) {
      onExit?.()
      return
    }
    setEnterAnim("animate-panel-enter")
    setActiveId(null)
  }

  const showBack = Boolean(active || client)
  const title = active ? active.title : client ? "客户端管理" : "批量操作"
  const description = active
    ? client
      ? `${active.desc} · ${client.name}`
      : active.desc
    : client
      ? `单机模式 · ${client.name} · ${tools.length} 项管理功能`
      : `${os === "windows" ? "Windows" : "Linux"} · ${tools.length} 项批量功能`
  const clientStatus = client ? statusMeta[client.status] : null

  return (
    <div className="card-glow flex h-full w-full flex-col overflow-hidden rounded-3xl bg-card p-6">
      {/* 头部 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start">
          <button
            type="button"
            onClick={back}
            aria-label={active ? `返回${client ? "客户端管理" : "批量操作"}菜单` : "返回客户端列表"}
            tabIndex={showBack ? 0 : -1}
            className={cn(
              "mt-0.5 flex h-9 shrink-0 items-center justify-center overflow-hidden rounded-full border transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-x-0.5 hover:bg-surface hover:text-foreground",
              showBack
                ? "mr-3 w-9 border-border text-muted-foreground opacity-100"
                : "mr-0 w-0 border-transparent text-transparent opacity-0",
            )}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
          </button>
          <div className="transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]">
            <h2 className="text-lg font-semibold">
              <MorphText text={title} />
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <MorphText text={description} />
            </p>
          </div>
        </div>

        {client ? (
          <div className="flex items-center gap-3 rounded-full border border-border bg-surface/60 px-3.5 py-2 text-xs">
            <span className={cn("flex items-center gap-1.5 font-medium", clientStatus?.text)}>
              <span className={cn("h-2 w-2 rounded-full", clientStatus?.dot)} />
              {clientStatus?.label}
            </span>
            <span className="h-4 w-px bg-border" />
            <span className="font-medium text-muted-foreground">{client.os}</span>
          </div>
        ) : (
          <SegmentedControl variant="pill" value={os} onChange={switchOS} options={osTabs} />
        )}
      </div>

      {/* 内容区 */}
      <div key={`${client?.id ?? "batch"}-${os}-${active ? active.id : "hub"}`} className={cn("mt-5 min-h-0 flex-1", enterAnim)}>
        {active ? (
          <active.Detail os={os} clientId={client?.id} />
        ) : client ? (
          <ClientToolHub client={client} tools={tools} onOpen={openTool} />
        ) : (
          <BatchToolGrid os={os} tools={tools} onOpen={openTool} />
        )}
      </div>
    </div>
  )
}

export function ExtensionsPanel() {
  return <ManagementPanel />
}

export function ClientManagementPanel({ client, onBack }: { client: Client; onBack: () => void }) {
  if (client.os === "macOS") {
    return (
      <div className="card-glow flex h-full w-full flex-col overflow-hidden rounded-3xl bg-card p-6">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回客户端列表"
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-lg font-semibold">客户端管理</h2>
            <p className="mt-1 text-sm text-muted-foreground">{client.name} · {client.hostname}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border bg-surface/30 px-6 text-center text-sm text-muted-foreground">
          当前管理命令仅覆盖 Windows 与 Linux 客户端。
        </div>
      </div>
    )
  }

  return <ManagementPanel client={client} onExit={onBack} />
}
