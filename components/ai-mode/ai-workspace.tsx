"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Sparkles,
  Send,
  Blocks,
  Server,
  Puzzle,
  TerminalSquare,
  Search,
  CircleCheck,
  CircleAlert,
  LoaderCircle,
  ShieldAlert,
  Settings2,
  X,
  Plus,
  Trash2,
  History,
  MessageSquare,
  Activity,
  Zap,
  Radio,
  Check,
  ChevronsUpDown,
  AtSign,
  ChevronDown,
  Bot,
  MessageCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { assessInputRisk } from "./danger-lexicon"
import { BorderBeam } from "./border-beam"
import { useServerData } from "@/components/server-data-context"
import { modelOptions, useAIConfig, aiConfigStore } from "@/components/settings/ai-data"
import { useAIMode } from "./ai-mode-context"
import { AIIntro } from "./ai-intro"

/* ---------- 类型 ---------- */

type StepStatus = "running" | "done" | "error" | "waiting-confirm"

type ToolStep = {
  id: string
  /** 工具来源：skill / mcp / plugin / core */
  source: "skill" | "mcp" | "plugin" | "core"
  tool: string
  detail: string
  output?: string
  status: StepStatus
  danger?: boolean
  /** 需确认操作的风险等级：warn 黄（默认）/ danger 红，泛光全程使用同一等级，不跨级渐变 */
  risk?: "warn" | "danger"
}

type Message =
  | { id: string; role: "user"; text: string }
  | {
      id: string
      role: "assistant"
      text: string
      steps: ToolStep[]
      done: boolean
    }

type Session = {
  id: string
  title: string
  createdAt: number
  messages: Message[]
}

/* ---------- 演示脚本：把常见自然语言请求映射到执行计划 ---------- */

type Scenario = {
  match: RegExp
  reply: string
  final: string
  steps: Omit<ToolStep, "id" | "status">[]
}

const scenarios: Scenario[] = [
  {
    match: /重启|restart/i,
    reply: "好的，我来重启核心服务器上的 nginx。先确认目标状态，再执行重启。",
    final: "已完成：nginx 已在 core-server-01 上重启，服务恢复正常（耗时 2.1s，0 次失败请求）。",
    steps: [
      { source: "core", tool: "clients.query", detail: "定位客户端「核心服务器」(192.168.1.10)", output: "在线 · Ubuntu 22.04 · 负载 0.42" },
      { source: "plugin", tool: "nginx.status", detail: "检查 nginx 当前状态", output: "active (running) · 2 workers · 已运行 14 天" },
      { source: "skill", tool: "ops.exec", detail: "systemctl restart nginx", output: "服务已重启 · 配置校验通过", danger: true, risk: "warn" },
      { source: "mcp", tool: "prometheus.query", detail: "验证重启后 5xx 错误率", output: "错误率 0.00% · P99 延迟 38ms" },
    ],
  },
  {
    match: /磁盘|空间|disk/i,
    reply: "我来巡检所有在线客户端的磁盘使用情况，找出空间紧张的机器。",
    final: "巡检完成：6 台中有 1 台需要关注 —— 备份节点 /data 分区已用 91%，建议清理 30 天前的归档或扩容。",
    steps: [
      { source: "core", tool: "clients.query", detail: "枚举全部在线客户端", output: "3 台在线：核心服务器、设计工作站、测试机 A" },
      { source: "skill", tool: "ops.exec", detail: "并行执行 df -h（3 台）", output: "核心 62% · 设计 47% · 测试 38%" },
      { source: "mcp", tool: "fs.scan", detail: "扫描备份节点历史快照占用", output: "/data 91% · 最大目录 /data/backups (89 GB)" },
      { source: "skill", tool: "report.generate", detail: "生成磁盘巡检摘要", output: "已生成报告 · 1 项告警 · 2 条建议" },
    ],
  },
  {
    match: /日志|错误|log|error/i,
    reply: "我来分析前台终端最近一小时的错误日志，看看有什么异常模式。",
    final: "分析完成：发现 12 条 connection timeout，集中在 14:20-14:25，与网关升级窗口吻合，当前已恢复，无需处理。",
    steps: [
      { source: "core", tool: "logs.fetch", detail: "拉取前台终端近 1h 日志（342 条）", output: "ERROR 12 · WARN 31 · INFO 299" },
      { source: "skill", tool: "diag.cluster", detail: "对错误做模式聚类", output: "1 个聚类：upstream connect timeout (12)" },
      { source: "mcp", tool: "prometheus.query", detail: "关联同时段网络指标", output: "14:20-14:25 出现丢包尖峰 2.3%" },
    ],
  },
  {
    match: /备份|backup/i,
    reply: "我来为核心服务器创建一次数据库备份，并校验备份完整性。",
    final: "备份完成：db-2026-07-10.sql.gz (1.4 GB) 已写入备份节点并通过校验，本月配额剩余 82%。",
    steps: [
      { source: "plugin", tool: "backup.create", detail: "创建 PostgreSQL 全量备份", output: "导出完成 · 压缩后 1.4 GB", danger: true, risk: "warn" },
      { source: "mcp", tool: "fs.transfer", detail: "传输到备份节点 /data/backups", output: "传输完成 · SHA256 校验一致" },
      { source: "skill", tool: "ops.verify", detail: "抽样恢复校验（10 张表）", output: "10/10 通过" },
    ],
  },
]

const fallbackScenario: Scenario = {
  match: /.*/,
  reply: "收到，我按以下计划来处理这个请求。",
  final: "处理完成。如果需要我把结果登记为计划任务或生成报告，直接告诉我。",
  steps: [
    { source: "core", tool: "clients.query", detail: "解析请求涉及的客户端范围", output: "已定位 2 台相关客户端" },
    { source: "skill", tool: "ops.plan", detail: "生成执行计划并评估风险", output: "2 个步骤 · 无危险操作" },
    { source: "skill", tool: "ops.exec", detail: "按计划执行", output: "全部步骤执行成功" },
  ],
}

const suggestions = [
  "重启核心服务器的 nginx",
  "检查所有客户端的磁盘空间",
  "分析前台终端最近的错误日志",
  "为核心服务器做一次数据库备份",
]

const sourceMeta = {
  skill: { label: "Skill", Icon: Blocks },
  mcp: { label: "MCP", Icon: Server },
  plugin: { label: "插件", Icon: Puzzle },
  core: { label: "内核", Icon: TerminalSquare },
} as const

let sessionSeq = 0
const newSession = (): Session => ({
  id: `s-${Date.now()}-${sessionSeq++}`,
  title: "新会话",
  createdAt: Date.now(),
  messages: [],
})

const timeLabel = (ts: number) => {
  const diff = Date.now() - ts
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
}

/* ---------- 入场编排：各区块按 delay 依次浮现 ---------- */

function Rise({
  shown,
  exiting,
  delay,
  className,
  children,
}: {
  shown: boolean
  exiting: boolean
  delay: number
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "translateY(0)" : exiting ? "translateY(10px)" : "translateY(26px)",
        filter: shown ? "blur(0px)" : "blur(10px)",
        transition: exiting
          ? "opacity 320ms ease-in, transform 320ms ease-in, filter 320ms ease-in"
          : `opacity 640ms cubic-bezier(0.22,1,0.36,1) ${delay}ms, transform 640ms cubic-bezier(0.22,1,0.36,1) ${delay}ms, filter 640ms cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}

/* ---------- 主组件：全屏 AI 工作台 ---------- */

export function AIWorkspace() {
  const { clients } = useServerData()
  const { phase, mounted, exit, introDone } = useAIMode()
  const cfg = useAIConfig()
  const [sessions, setSessions] = useState<Session[]>(() => [newSession()])
  const [activeId, setActiveId] = useState(() => sessions[0]?.id ?? "")
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  // 弹窗定位：菜单通过 Portal 渲染到 body（父级带 backdrop-filter 会阻断嵌套的 backdrop-blur）
  const [menuRect, setMenuRect] = useState<{ left: number; bottom: number; width: number } | null>(null)
  // 关闭时先播放退场动画，动画结束后再卸载
  const [menuClosing, setMenuClosing] = useState(false)
  const modelBtnRef = useRef<HTMLButtonElement>(null)
  const inputModelBtnRef = useRef<HTMLButtonElement>(null)
  // 输入框底部的模式胶囊：Agent（多步执行）/ Chat（仅对话）
  const [agentMode, setAgentMode] = useState<"agent" | "chat">("agent")
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  /** 从任意触发按钮打开模型菜单（Portal 定位到该按钮上方） */
  const openModelMenuFrom = (el: HTMLButtonElement | null) => {
    setAgentMenuOpen(false)
    if (modelMenuOpen) {
      if (!menuClosing) closeModelMenu()
      return
    }
    if (el) {
      const r = el.getBoundingClientRect()
      setMenuRect({ left: r.left, bottom: window.innerHeight - r.top + 6, width: Math.max(r.width, 200) })
    }
    setModelMenuOpen(true)
  }
  const closeModelMenu = () => {
    setMenuClosing(true)
    window.setTimeout(() => {
      setModelMenuOpen(false)
      setMenuClosing(false)
    }, 140)
  }
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0]
  const messages = active?.messages ?? []

  // 输入风险感知：safe / warn / danger，驱动输入框泛光颜色渐变
  const inputRisk = useMemo(() => assessInputRisk(input), [input])

  // 执行风险感知：需确认的步骤在「等待确认 → 确认后执行」全程使用步骤自身的风险等级，
  // 警告级(warn)始终金黄、危险级(danger)始终赤红，绝不跨级渐变
  const execRisk = useMemo<"safe" | "warn" | "danger">(() => {
    const last = [...(active?.messages ?? [])].reverse().find((m) => m.role === "assistant")
    if (!last || last.role !== "assistant" || last.done) return "safe"
    const activeStep = last.steps.find(
      (s) => s.status === "waiting-confirm" || (s.status === "running" && s.danger),
    )
    return activeStep ? (activeStep.risk ?? "warn") : "safe"
  }, [active?.messages])

  // 输出中的旋转泛光颜色：取输入风险与执行风险中较高者
  const glowRisk: "safe" | "warn" | "danger" =
    inputRisk === "danger" || execRisk === "danger" ? "danger" : inputRisk === "warn" || execRisk === "warn" ? "warn" : "safe"

  // 起始帧标记：挂载后下一帧才置 shown，保证入场过渡能播放
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (phase === "entering" || phase === "active") {
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(raf)
    }
    setShown(false)
  }, [phase])

  // 暗幕起始帧：覆盖层在 dimming 阶段才挂载，首帧必须先渲染成透明，
  // 下一帧再切到暗色目标值，background/backdrop-filter 过渡才能真正播放（否则直接黑屏）
  const [dimReady, setDimReady] = useState(false)
  useEffect(() => {
    if (mounted) {
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setDimReady(true)))
      return () => cancelAnimationFrame(raf)
    }
    setDimReady(false)
  }, [mounted])

  const exiting = phase === "exiting"

  const modelLabel =
    cfg.model === "custom"
      ? cfg.customModel || "自定义模型"
      : (modelOptions.find((m) => m.id === cfg.model)?.label ?? cfg.model)

  const enabledCaps = {
    skills: cfg.skills.filter((s) => s.enabled).length,
    mcp: cfg.mcpServers.filter((m) => m.status === "connected").length,
    plugins: cfg.plugins.filter((p) => p.enabled).length,
  }

  // 遥测统计：全部会话累计
  const telemetry = useMemo(() => {
    let toolCalls = 0
    let dangerOps = 0
    let doneSteps = 0
    const recent: { tool: string; source: ToolStep["source"]; status: StepStatus }[] = []
    for (const s of sessions) {
      for (const m of s.messages) {
        if (m.role !== "assistant") continue
        for (const st of m.steps) {
          toolCalls++
          if (st.danger) dangerOps++
          if (st.status === "done") doneSteps++
          recent.push({ tool: st.tool, source: st.source, status: st.status })
        }
      }
    }
    return { toolCalls, dangerOps, doneSteps, recent: recent.slice(-6).reverse() }
  }, [sessions])

  // 进入后聚焦输入框；退出时清理定时器
  useEffect(() => {
    if (phase === "active") {
      const t = setTimeout(() => inputRef.current?.focus(), 120)
      return () => clearTimeout(t)
    }
    if (phase === "closed") {
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
      setBusy(false)
    }
  }, [phase])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])

  const schedule = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms)
    timersRef.current.push(t)
  }

  const patchSession = (sid: string, fn: (s: Session) => Session) =>
    setSessions((prev) => prev.map((s) => (s.id === sid ? fn(s) : s)))

  const patchStep = (sid: string, msgId: string, stepId: string, patch: Partial<ToolStep>) =>
    patchSession(sid, (s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.id === msgId && m.role === "assistant"
          ? { ...m, steps: m.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st)) }
          : m,
      ),
    }))

  /* ---------- 会话管理 ---------- */

  const createSession = () => {
    if (busy) return
    const s = newSession()
    setSessions((prev) => [s, ...prev])
    setActiveId(s.id)
    setInput("")
    inputRef.current?.focus()
  }

  const deleteSession = (sid: string) => {
    if (busy && sid === activeId) return
    setSessions((prev) => {
      const rest = prev.filter((s) => s.id !== sid)
      if (rest.length === 0) {
        const fresh = newSession()
        setActiveId(fresh.id)
        return [fresh]
      }
      if (sid === activeId) setActiveId(rest[0].id)
      return rest
    })
  }

  const switchSession = (sid: string) => {
    if (busy) return
    setActiveId(sid)
    inputRef.current?.focus()
  }

  /* ---------- 执行 ---------- */

  const run = (text: string) => {
    if (!text.trim() || busy || !cfg.enabled || !active) return
    const sid = active.id
    const scenario = scenarios.find((s) => s.match.test(text)) ?? fallbackScenario
    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", text: text.trim() }
    const aid = `a-${Date.now()}`
    const steps: ToolStep[] = scenario.steps.map((s, i) => ({
      ...s,
      id: `${aid}-s${i}`,
      status: "running",
    }))
    const aiMsg: Message = { id: aid, role: "assistant", text: scenario.reply, steps: [], done: false }

    patchSession(sid, (s) => ({
      ...s,
      title: s.messages.length === 0 ? text.trim().slice(0, 18) : s.title,
      messages: [...s.messages, userMsg, aiMsg],
    }))
    setInput("")
    setBusy(true)

    // 逐步展示工具调用；遇到危险步骤停下等待确认
    let delay = 700
    let blocked = false
    for (const step of steps) {
      if (blocked) break
      const needConfirm = step.danger && cfg.confirmDanger
      const status: StepStatus = needConfirm ? "waiting-confirm" : "running"
      schedule(() => {
        patchSession(sid, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === aid && m.role === "assistant"
              ? { ...m, steps: [...m.steps, { ...step, status, output: undefined }] }
              : m,
          ),
        }))
      }, delay)
      if (needConfirm) {
        blocked = true
        break
      }
      delay += 900
      schedule(() => patchStep(sid, aid, step.id, { status: "done", output: step.output }), delay)
      delay += 350
    }

    if (!blocked) {
      schedule(() => {
        patchSession(sid, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === aid && m.role === "assistant" ? { ...m, text: scenario.final, done: true } : m,
          ),
        }))
        setBusy(false)
      }, delay + 300)
    }
  }

  /** 用户确认危险步骤后：完成该步并继续执行剩余步骤 */
  const confirmStep = (msgId: string, stepId: string) => {
    if (!active) return
    const sid = active.id
    const msg = active.messages.find((m) => m.id === msgId)
    if (!msg || msg.role !== "assistant") return
    const scenario = scenarios.find((s) => s.reply === msg.text) ?? fallbackScenario
    const allSteps: ToolStep[] = scenario.steps.map((s, i) => ({ ...s, id: `${msgId}-s${i}`, status: "done" as const }))
    const idx = allSteps.findIndex((s) => s.id === stepId)

    patchStep(sid, msgId, stepId, { status: "running" })
    let delay = 900
    schedule(() => patchStep(sid, msgId, stepId, { status: "done", output: allSteps[idx]?.output }), delay)

    const rest = allSteps.slice(idx + 1)
    rest.forEach((step) => {
      delay += 500
      schedule(() => {
        patchSession(sid, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === msgId && m.role === "assistant"
              ? { ...m, steps: [...m.steps, { ...step, status: "running", output: undefined }] }
              : m,
          ),
        }))
      }, delay)
      delay += 900
      schedule(() => patchStep(sid, msgId, step.id, { status: "done", output: step.output }), delay)
    })
    schedule(() => {
      patchSession(sid, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === msgId && m.role === "assistant" ? { ...m, text: scenario.final, done: true } : m,
        ),
      }))
      setBusy(false)
    }, delay + 400)
  }

  if (!mounted) return null

  const onlineCount = clients.filter((c) => c.status === "online").length
  const inIntro = phase === "intro"
  const dimming = phase === "dimming"

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI Mode"
      className="fixed inset-0 z-50"
      style={{
        // 铺垫阶段：暗幕先压下来（偏暗、半透明），开场阶段再提亮到接近实底——同一属性连续过渡，无跳变。
        // dimReady 未置位时（挂载首帧）保持全透明，确保暗幕是从透明"渐"过去的
        backgroundColor: !dimReady
          ? "transparent"
          : dimming
            ? "color-mix(in oklab, oklch(0.1 0.015 150) 62%, transparent)"
            : inIntro
              ? "color-mix(in oklab, var(--background) 96%, transparent)"
              : shown
                ? "color-mix(in oklab, var(--background) 88%, transparent)"
                : "transparent",
        backdropFilter: !dimReady ? "blur(0px)" : dimming ? "blur(14px)" : inIntro || shown ? "blur(24px)" : "blur(0px)",
        transition: exiting
          ? "background-color 420ms ease-in, backdrop-filter 420ms ease-in"
          : dimming
            ? "background-color 850ms cubic-bezier(0.22, 1, 0.36, 1), backdrop-filter 850ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "background-color 700ms ease-out, backdrop-filter 700ms ease-out",
      }}
    >
      {/* 氛围层：深空底 + 极光色斑（参考 border beam 展示页的多彩微光） */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: shown && !inIntro ? 1 : 0,
          transition: "opacity 1000ms ease",
          background: "color-mix(in oklab, oklch(0.09 0.012 260) 55%, transparent)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ opacity: shown && !inIntro ? 1 : 0, transition: "opacity 1400ms ease" }}
      >
        {/* 三团极光：蓝 / 紫 / 粉，缓慢漂移，被面板毛玻璃透出 */}
        <span
          className="animate-aurora absolute -top-24 left-[12%] h-80 w-[34rem] rounded-full"
          style={{
            background: "radial-gradient(ellipse at center, rgba(59,130,246,0.16), transparent 70%)",
            filter: "blur(40px)",
          }}
        />
        <span
          className="animate-aurora absolute -bottom-32 left-[38%] h-72 w-[40rem] rounded-full"
          style={{
            background: "radial-gradient(ellipse at center, rgba(168,85,247,0.13), transparent 70%)",
            filter: "blur(48px)",
            animationDelay: "-5s",
          }}
        />
        <span
          className="animate-aurora absolute -right-20 top-[30%] h-72 w-96 rounded-full"
          style={{
            background: "radial-gradient(ellipse at center, rgba(244,114,182,0.10), transparent 70%)",
            filter: "blur(44px)",
            animationDelay: "-9s",
          }}
        />
      </div>

      {/* 开场载入动画：铺垫（dimming）阶段就挂载，星辉的生长与画面模糊变暗重叠衔接，消除空场死区 */}
      {(inIntro || dimming) && (
        <div className="absolute inset-0 z-10">
          <AIIntro onDone={introDone} />
        </div>
      )}

      {/* 顶部极细能量线：极光三色 */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-px"
        style={{
          width: shown ? "100%" : "0%",
          opacity: shown ? 1 : 0,
          background:
            "linear-gradient(to right, transparent, rgba(96,165,250,0.7) 30%, rgba(167,139,250,0.7) 55%, rgba(244,114,182,0.6) 75%, transparent)",
          transition: "width 900ms cubic-bezier(0.22,1,0.36,1) 150ms, opacity 400ms ease 150ms",
        }}
      />

      {/* 三栏布局：会话侧栏 / 对话流 / 遥测面板 */}
      <div className="relative flex h-full w-full gap-4 p-4 sm:p-5">
        {/* ===== 左栏：会话管理 ===== */}
        <Rise shown={shown} exiting={exiting} delay={60} className="hidden w-64 shrink-0 md:block">
          <aside className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/55 backdrop-blur-xl">
            <div className="flex items-center justify-between px-4 pb-3 pt-4">
              <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <History className="h-3.5 w-3.5" />
                会话
              </span>
              <button
                type="button"
                onClick={createSession}
                disabled={busy}
                aria-label="新会话"
                className="flex h-7 items-center gap-1 rounded-full border border-border/70 bg-foreground/[0.03] px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                新会话
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              <div className="flex flex-col gap-1">
                {sessions.map((s) => {
                  const isActive = s.id === active?.id
                  const count = s.messages.filter((m) => m.role === "user").length
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        "group relative flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-all",
                        isActive
                          ? "border-border bg-foreground/[0.05]"
                          : "border-transparent hover:border-border/60 hover:bg-foreground/[0.03]",
                      )}
                      onClick={() => switchSession(s.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") switchSession(s.id)
                      }}
                    >
                      <MessageSquare
                        className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-foreground/80" : "text-muted-foreground/60")}
                      />
                      <div className="min-w-0 flex-1 leading-tight">
                        <p className={cn("truncate text-xs", isActive ? "font-medium text-foreground" : "text-muted-foreground")}>
                          {s.title}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                          {timeLabel(s.createdAt)}
                          {count > 0 && ` · ${count} 条指令`}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`删除会话 ${s.title}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteSession(s.id)
                        }}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-all hover:bg-negative/15 hover:text-negative group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 能力概览 */}
            <div className="border-t border-border px-4 py-3.5">
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">能力</p>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Blocks className="h-3.5 w-3.5 text-muted-foreground/70" />
                  {enabledCaps.skills} 技能
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Server className="h-3.5 w-3.5 text-muted-foreground/70" />
                  {enabledCaps.mcp} MCP
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Puzzle className="h-3.5 w-3.5 text-muted-foreground/70" />
                  {enabledCaps.plugins} 插件
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Radio className="h-3.5 w-3.5 text-positive/80" />
                  {onlineCount} 在线
                </span>
              </div>
              {/* 内联模型切换器：点击展开列表，选中即生效 */}
              <div className="relative mt-3">
                <button
                  type="button"
                  ref={modelBtnRef}
                  onClick={() => openModelMenuFrom(modelBtnRef.current)}
                  aria-expanded={modelMenuOpen}
                  aria-haspopup="listbox"
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-[11px] transition-colors",
                    modelMenuOpen
                      ? "border-border bg-foreground/[0.05] text-foreground"
                      : "border-border/70 bg-foreground/[0.03] text-muted-foreground hover:border-border hover:bg-foreground/[0.06] hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Settings2 className="h-3.5 w-3.5" />
                    {modelLabel}
                  </span>
                  <ChevronsUpDown className="h-3 w-3 text-muted-foreground/60" />
                </button>
                {modelMenuOpen && menuRect && createPortal(
                  <>
                    {/* 点击外部关闭 */}
                    <button
                      type="button"
                      aria-label="关闭模型菜单"
                      className="fixed inset-0 z-[60] cursor-default"
                      onClick={() => {
                        if (!menuClosing) closeModelMenu()
                      }}
                    />
                    <ul
                      role="listbox"
                      aria-label="选择模型"
                      style={{ left: menuRect.left, bottom: menuRect.bottom, width: menuRect.width }}
                      className={cn(
                        "fixed z-[70] overflow-hidden rounded-xl border border-border bg-card/60 py-1 shadow-xl backdrop-blur-2xl backdrop-saturate-150",
                        menuClosing ? "animate-dropdown-out" : "animate-dropdown-in",
                      )}
                    >
                      {modelOptions
                        .filter((m) => m.id !== "custom" || cfg.customModel)
                        .map((m) => {
                          const selected = cfg.model === m.id
                          return (
                            <li key={m.id}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={selected}
                                onClick={() => {
                                  aiConfigStore.set({ model: m.id })
                                  if (!menuClosing) closeModelMenu()
                                }}
                                className={cn(
                                  "flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] transition-colors",
                                  selected ? "text-primary" : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
                                )}
                              >
                                <span className="flex flex-col leading-tight">
                                  <span>{m.id === "custom" ? cfg.customModel : m.label}</span>
                                  <span className="text-[10px] text-muted-foreground/60">{m.vendor}</span>
                                </span>
                                {selected && <Check className="h-3.5 w-3.5" />}
                              </button>
                            </li>
                          )
                        })}
                    </ul>
                  </>,
                  document.body,
                )}
              </div>
            </div>
          </aside>
        </Rise>

        {/* ===== 中栏：对话流 ===== */}
        <Rise shown={shown} exiting={exiting} delay={160} className="min-w-0 flex-1">
          <section className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/45 backdrop-blur-xl">
            {/* 面板顶栏 */}
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-foreground/[0.04]">
                  <Sparkles className="h-4 w-4 text-foreground/80" />
                  {busy && (
                    <span className="absolute inset-0 animate-ping rounded-xl border border-primary/40" style={{ animationDuration: "1.6s" }} />
                  )}
                </span>
                <div className="min-w-0 leading-tight">
                  <h2 className="truncate text-sm font-semibold">{active?.title ?? "AI Mode"}</h2>
                  <p className="text-[11px] text-muted-foreground">
                    {busy ? "正在执行…" : cfg.enabled ? "待命中 · 自然语言操作所有客户端" : "已停用"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "hidden items-center gap-1.5 rounded-full border bg-foreground/[0.03] px-2.5 py-1 text-[10px] font-medium sm:flex",
                    busy ? "border-primary/40 text-primary" : "border-border/70 text-muted-foreground",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", busy ? "animate-pulse bg-primary" : "bg-positive")} />
                  {busy ? "RUNNING" : "READY"}
                </span>
                <button
                  type="button"
                  onClick={exit}
                  className="flex h-8 items-center gap-1.5 rounded-full border border-border/70 bg-foreground/[0.03] px-3 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                  退出
                  <kbd className="rounded border border-border px-1 font-mono text-[10px]">Esc</kbd>
                </button>
              </div>
            </header>

            {/* 消息区 */}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {messages.length === 0 ? (
                <EmptyState onPick={run} disabled={!cfg.enabled} />
              ) : (
                <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-2">
                  {messages.map((m) =>
                    m.role === "user" ? (
                      <div key={m.id} className="flex justify-end">
                    <span className="max-w-[85%] rounded-2xl rounded-br-md border border-border/70 bg-foreground/[0.06] px-4 py-2.5 text-sm text-foreground backdrop-blur-sm">
                      {m.text}
                    </span>
                      </div>
                    ) : (
                      <AssistantBubble key={m.id} msg={m} onConfirm={(stepId) => confirmStep(m.id, stepId)} />
                    ),
                  )}
                </div>
              )}
            </div>

            {/* 输入区 */}
            <div className="relative shrink-0 px-5 pb-4">
              <div
                className={cn(
                  "group relative mx-auto flex max-w-3xl flex-col rounded-2xl border bg-background/70 px-3 pb-2.5 pt-3 backdrop-blur-xl",
                  // 风险感知：safe → warn 黄 → danger 红，颜色与光晕平滑渐变
                  inputRisk === "danger"
                    ? "border-negative/50 shadow-[0_0_54px_-12px] shadow-negative/60"
                    : inputRisk === "warn"
                      ? "border-warning/50 shadow-[0_0_52px_-13px] shadow-warning/55"
                      : "border-border/70 shadow-[0_8px_40px_-16px_rgba(0,0,0,0.6)]",
                )}
                style={{
                  transition:
                    "border-color 700ms cubic-bezier(0.22,1,0.36,1), box-shadow 700ms cubic-bezier(0.22,1,0.36,1)",
                }}
              >
                {/* AI 输出中：旋转弥散流光渐显，完成后渐隐；颜色跟随输入/执行风险平滑渐变
                    （safe 绿粉紫 / 待确认操作 warn 金黄 / 危险操作 danger 赤红） */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-2xl"
                  style={{ opacity: busy ? 1 : 0, transition: "opacity 1200ms ease" }}
                >
                  <BorderBeam
                    glow
                    size={110}
                    duration={9}
                    colorFrom={glowRisk === "danger" ? "#ef4444" : glowRisk === "warn" ? "#f59e0b" : "#34d399"}
                    colorTo={glowRisk === "danger" ? "#f87171" : glowRisk === "warn" ? "#fbbf24" : "#f472b6"}
                  />
                  <BorderBeam
                    glow
                    size={110}
                    duration={9}
                    delay={-4.5}
                    colorFrom={glowRisk === "danger" ? "#f87171" : glowRisk === "warn" ? "#fbbf24" : "#a78bfa"}
                    colorTo={glowRisk === "danger" ? "#ef4444" : glowRisk === "warn" ? "#f59e0b" : "#60a5fa"}
                    opacity={0.8}
                  />
                </div>
                {/* 空闲态：静态单色微光，默认微弱蓝光；检测到警告/危险词时颜色从蓝平滑渐变为黄/红（box-shadow 可插值，无旋转） */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -inset-px rounded-2xl"
                  style={{
                    opacity: busy ? 0 : 1,
                    boxShadow:
                      inputRisk === "danger"
                        ? "0 0 30px -6px rgba(239,68,68,0.55), inset 0 0 18px -10px rgba(239,68,68,0.45)"
                        : inputRisk === "warn"
                          ? "0 0 28px -7px rgba(245,158,11,0.5), inset 0 0 16px -10px rgba(245,158,11,0.4)"
                          : "0 0 24px -8px rgba(96,165,250,0.28), inset 0 0 14px -10px rgba(96,165,250,0.18)",
                    transition: "box-shadow 1200ms ease, opacity 500ms ease",
                  }}
                />
                {/* 顶部：@ 引用按钮 */}
                <button
                  type="button"
                  aria-label="引用客户端或资源"
                  disabled={!cfg.enabled}
                  onClick={() => {
                    setInput((v) => (v.endsWith("@") ? v : `${v}@`))
                    inputRef.current?.focus()
                  }}
                  className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-foreground/[0.04] text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-40"
                >
                  <AtSign className="h-4 w-4" />
                </button>

                {/* 中部：指令输入 */}
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) run(input)
                  }}
                  placeholder={cfg.enabled ? "描述你想做的事，例如：重启核心服务器的 nginx" : "AI Mode 已停用，请先在设置中开启"}
                  disabled={!cfg.enabled}
                  aria-label="AI 指令输入"
                  className="relative mt-2 h-10 w-full min-w-0 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed"
                />

                {/* 底部：模式 / 模型胶囊 + 发送 */}
                <div className="relative mt-1.5 flex items-center gap-2">
                  {/* Agent 模式胶囊下拉 */}
                  <div className="relative">
                    <button
                      type="button"
                      aria-haspopup="listbox"
                      aria-expanded={agentMenuOpen}
                      disabled={!cfg.enabled}
                      onClick={() => {
                        if (modelMenuOpen && !menuClosing) closeModelMenu()
                        setAgentMenuOpen((v) => !v)
                      }}
                      className={cn(
                        "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors disabled:opacity-40",
                        agentMenuOpen
                          ? "border-primary/40 bg-foreground/[0.05] text-foreground"
                          : "border-border/70 bg-foreground/[0.03] text-muted-foreground hover:border-border hover:text-foreground",
                      )}
                    >
                      {agentMode === "agent" ? "Agent" : "Chat"}
                      <ChevronDown
                        className={cn("h-3.5 w-3.5 text-muted-foreground/60 transition-transform", agentMenuOpen && "rotate-180")}
                      />
                    </button>
                    {agentMenuOpen && (
                      <>
                        <button
                          type="button"
                          aria-label="关闭模式菜单"
                          className="fixed inset-0 z-[60] cursor-default"
                          onClick={() => setAgentMenuOpen(false)}
                        />
                        <ul
                          role="listbox"
                          aria-label="选择工作模式"
                          className="animate-dropdown-in absolute bottom-full left-0 z-[70] mb-2 w-52 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-xl"
                        >
                          {(
                            [
                              { id: "agent", label: "Agent", desc: "拆解步骤并调用工具执行", Icon: Bot },
                              { id: "chat", label: "Chat", desc: "仅对话，不执行任何操作", Icon: MessageCircle },
                            ] as const
                          ).map((m) => {
                            const selected = agentMode === m.id
                            return (
                              <li key={m.id}>
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  onClick={() => {
                                    setAgentMode(m.id)
                                    setAgentMenuOpen(false)
                                    inputRef.current?.focus()
                                  }}
                                  className={cn(
                                    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors",
                                    selected ? "text-primary" : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
                                  )}
                                >
                                  <m.Icon className="h-3.5 w-3.5 shrink-0" />
                                  <span className="flex min-w-0 flex-col leading-tight">
                                    <span>{m.label}</span>
                                    <span className="truncate text-[10px] text-muted-foreground/60">{m.desc}</span>
                                  </span>
                                  {selected && <Check className="ml-auto h-3.5 w-3.5 shrink-0" />}
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      </>
                    )}
                  </div>

                  {/* 模型胶囊下拉：复用左栏的模型菜单 */}
                  <button
                    type="button"
                    ref={inputModelBtnRef}
                    aria-haspopup="listbox"
                    aria-expanded={modelMenuOpen}
                    disabled={!cfg.enabled}
                    onClick={() => openModelMenuFrom(inputModelBtnRef.current)}
                    className={cn(
                      "flex h-8 max-w-40 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors disabled:opacity-40",
                      modelMenuOpen
                        ? "border-primary/40 bg-foreground/[0.05] text-foreground"
                        : "border-border/70 bg-foreground/[0.03] text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{modelLabel}</span>
                    <ChevronDown
                      className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform", modelMenuOpen && "rotate-180")}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => run(input)}
                    disabled={!input.trim() || busy || !cfg.enabled}
                    aria-label="发送"
                    className={cn(
                      "ml-auto flex h-8 w-8 items-center justify-center rounded-full transition-all",
                      input.trim() && !busy
                        ? "bg-primary text-primary-foreground shadow-[0_0_20px_-6px] shadow-primary/60 hover:brightness-110"
                        : "border border-border/70 bg-foreground/[0.03] text-muted-foreground/50",
                    )}
                  >
                    {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-center text-[10px] text-muted-foreground/60">
                演示环境：AI 规划与工具调用在本地模拟 · 危险操作默认需人工确认
              </p>
            </div>
          </section>
        </Rise>

        {/* ===== 右栏：执行遥测 ===== */}
        <Rise shown={shown} exiting={exiting} delay={260} className="hidden w-64 shrink-0 xl:block">
          <aside className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/55 backdrop-blur-xl">
            <div className="flex items-center gap-2 px-4 pb-3 pt-4">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">执行遥测</span>
              <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-positive" aria-label="实时更新中" />
            </div>

            {/* 统计卡片 */}
            <div className="grid grid-cols-2 gap-2 px-3">
              <TelemetryStat label="工具调用" value={telemetry.toolCalls} Icon={Zap} />
              <TelemetryStat label="已完成" value={telemetry.doneSteps} Icon={CircleCheck} />
              <TelemetryStat label="危险操作" value={telemetry.dangerOps} Icon={ShieldAlert} warn={telemetry.dangerOps > 0} />
              <TelemetryStat label="会话数" value={sessions.length} Icon={History} />
            </div>

            {/* 最近调用流 */}
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto border-t border-border px-3 pt-3">
              <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">最近调用</p>
              {telemetry.recent.length === 0 ? (
                <p className="px-1 text-[11px] text-muted-foreground/50">暂无调用记录</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {telemetry.recent.map((r, i) => {
                    const meta = sourceMeta[r.source]
                    return (
                      <div
                        key={`${r.tool}-${i}`}
                        className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5"
                      >
                        {r.status === "running" ? (
                          <LoaderCircle className="h-3 w-3 shrink-0 animate-spin text-primary" />
                        ) : r.status === "waiting-confirm" ? (
                          <ShieldAlert className="h-3 w-3 shrink-0 text-warning" />
                        ) : (
                          <CircleCheck className="h-3 w-3 shrink-0 text-positive" />
                        )}
                        <code className="truncate font-mono text-[10px] text-foreground/90">{r.tool}</code>
                        <span className="ml-auto flex shrink-0 items-center gap-1 text-[9px] text-muted-foreground/60">
                          <meta.Icon className="h-2.5 w-2.5" />
                          {meta.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 模型信息 */}
            <div className="border-t border-border px-4 py-3">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground/70">模型</span>
                <span className="font-mono text-foreground/90">{modelLabel}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground/70">温度</span>
                <span className="font-mono text-foreground/90">{cfg.temperature.toFixed(1)}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground/70">危险操作确认</span>
                <span className={cn("font-mono", cfg.confirmDanger ? "text-positive" : "text-warning")}>
                  {cfg.confirmDanger ? "ON" : "OFF"}
                </span>
              </div>
              {!cfg.enabled && (
                <p className="mt-2 flex items-center gap-1 text-[10px] text-warning">
                  <ShieldAlert className="h-3 w-3" />
                  AI Mode 已在设置中停用
                </p>
              )}
            </div>
          </aside>
        </Rise>
      </div>
    </div>
  )
}

/* ---------- 遥测统计小卡 ---------- */

function TelemetryStat({
  label,
  value,
  Icon,
  warn,
}: {
  label: string
  value: number
  Icon: React.ComponentType<{ className?: string }>
  warn?: boolean
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-foreground/[0.03] px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
        <Icon className={cn("h-3 w-3", warn ? "text-warning" : "text-muted-foreground/70")} />
        {label}
      </div>
      <p className={cn("mt-1 font-mono text-lg font-semibold leading-none", warn ? "text-warning" : "text-foreground")}>
        {value}
      </p>
    </div>
  )
}

/* ---------- 空态：欢迎语 + 建议指令 ---------- */

function EmptyState({ onPick, disabled }: { onPick: (t: string) => void; disabled: boolean }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-6 text-center">
      <div className="relative">
        <span className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-border/70 bg-background/70 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          <Sparkles className="h-6 w-6 text-foreground/80" />
          {/* 流光边框：图标方块像 border beam 展示页的 app icon 一样流转 */}
          <BorderBeam size={40} duration={6} colorFrom="#60a5fa" colorTo="#a78bfa" />
          <BorderBeam size={40} duration={6} delay={-3} colorFrom="#f472b6" colorTo="#60a5fa" opacity={0.8} />
        </span>
      </div>
      <div className="leading-tight">
        <h3 className="text-lg font-semibold">
          <BlurWords text="想让我做点什么？" />
        </h3>
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
          <BlurWords text="直接用一句话描述目标，我会拆解成步骤、调用合适的工具，并在关键操作前请你确认。" />
        </p>
      </div>
      <div className="flex max-w-md flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3.5 py-2 text-sm text-muted-foreground backdrop-blur-md transition-all hover:border-[rgba(167,139,250,0.5)] hover:bg-foreground/[0.04] hover:text-foreground hover:shadow-[0_0_24px_-8px_rgba(167,139,250,0.5)] disabled:opacity-40"
          >
            <Search className="h-3.5 w-3.5" />
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * 平滑展开容器：子内容出现时用 grid-rows 0fr→1fr 过渡撑开高度，
 * 配合透明度与轻微上移，避免步骤卡片从单行变多行时的瞬间跳变。
 */
function Expand({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div
      className="grid transition-[grid-template-rows] duration-400 ease-out"
      style={{ gridTemplateRows: show ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden">
        <div
          className="transition-all duration-400 ease-out"
          style={{
            opacity: show ? 1 : 0,
            transform: show ? "translateY(0)" : "translateY(-4px)",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * iOS 风格逐词模糊渐显：把文本按词切分，每个词从模糊中错峰浮现。
 * key 用文本本身，文本变化（如回复更新为最终结论）时自动重播。
 * 中文无空格，按字符分组切（每 2 字一组），英文按空格切分。
 */
function BlurWords({ text, className }: { text: string; className?: string }) {
  const parts = text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]{1,2}|\S+\s*|\s+/g) ?? [text]
  return (
    <span key={text} className={className}>
      {parts.map((part, i) => (
        <span key={i} className="animate-word-in" style={{ animationDelay: `${Math.min(i * 28, 900)}ms` }}>
          {part.endsWith(" ") ? (
            <>
              {part.trimEnd()}
              {"\u00A0"}
            </>
          ) : (
            part
          )}
        </span>
      ))}
    </span>
  )
}

/* ---------- assistant 气泡：回复文本 + 工具调用时间线 ---------- */

function AssistantBubble({ msg, onConfirm }: { msg: Extract<Message, { role: "assistant" }>; onConfirm: (stepId: string) => void }) {
  return (
    <div className="flex max-w-[92%] flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-foreground/[0.04]">
          {/* 极光小圆点：呼应对话框的弥散光雾配色，生成中缓慢脉动 */}
          <span
            className={cn("h-2 w-2 rounded-full", !msg.done && "animate-pulse")}
            style={{
              background: "linear-gradient(135deg, #34d399, #a78bfa 55%, #f472b6)",
              boxShadow: "0 0 8px 1px rgba(167,139,250,0.45)",
            }}
          />
        </span>
        <p className="pt-1 text-sm leading-relaxed text-foreground">
          <BlurWords text={msg.text} />
        </p>
      </div>

      {msg.steps.length > 0 && (
        <div className="ml-9 flex flex-col gap-1.5">
          {msg.steps.map((step) => {
            const meta = sourceMeta[step.source]
            return (
              <div
                key={step.id}
                className={cn(
                  "animate-slide-in-right flex flex-col rounded-xl border px-3 py-2 transition-colors",
                  step.status === "waiting-confirm"
                    ? "border-warning/40 bg-warning/5"
                    : step.status === "running"
                      ? "border-primary/30 bg-primary/[0.04]"
                      : "border-border bg-surface/50",
                )}
              >
                <div className="flex items-center gap-2 text-xs">
                  {step.status === "running" && <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
                  {step.status === "done" && <CircleCheck className="h-3.5 w-3.5 shrink-0 text-positive" />}
                  {step.status === "error" && <CircleAlert className="h-3.5 w-3.5 shrink-0 text-negative" />}
                  {step.status === "waiting-confirm" && <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-warning" />}
                  <span className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    <meta.Icon className="h-3 w-3" />
                    {meta.label}
                  </span>
                  <code className="font-mono text-[11px] text-primary">{step.tool}</code>
                  <span className="truncate text-muted-foreground">{step.detail}</span>
                </div>
                <Expand show={Boolean(step.output && step.status === "done")}>
                  <p className="ml-5.5 pb-0.5 pl-0.5 pt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {step.output && <BlurWords text={step.output} />}
                  </p>
                </Expand>
                <Expand show={step.status === "waiting-confirm"}>
                  <div className="ml-5 flex items-center gap-2 pb-0.5 pt-1">
                    <span className="text-[11px] text-warning">此操作会影响线上服务，需要你确认</span>
                    <button
                      type="button"
                      onClick={() => onConfirm(step.id)}
                      className="rounded-lg bg-warning px-2.5 py-1 text-[11px] font-semibold text-background transition-all hover:brightness-105"
                    >
                      确认执行
                    </button>
                  </div>
                </Expand>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
