"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Sparkles,
  Send,
  Blocks,
  Server,
  Puzzle,
  Search,
  CircleCheck,
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
  ImagePlus,
  ChevronDown,
  Bot,
  MessageCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { assessInputRisk } from "./danger-lexicon"
import { BorderBeam } from "./border-beam"
import { isReducedMotion } from "@/lib/motion-preference"
import { useServerData } from "@/components/server-data-context"
import { modelOptions, useAIConfig, aiConfigStore } from "@/components/settings/ai-data"
import { useAIRuntimeStatus } from "@/components/settings/ai-config-sync"
import {
  abortAIChat,
  deleteAISession,
  fetchAIChatHistory,
  postAIApproval,
  saveAIChatHistory,
  streamAIChat,
} from "@/lib/ai/client"
import { createChatSessionId } from "@/lib/ai/chat-history"
import { looksLikePlanningText } from "@/lib/ai/answer-separation"
import { toThoughtSteps } from "@/lib/ai/thought-steps"
import { resolveAIModel } from "@/lib/ai/config-shared"
import {
  MAX_AI_ATTACHMENT_COUNT,
  MAX_AI_ATTACHMENT_TOTAL_BYTES,
  type AIChatAttachment,
} from "@/lib/ai/chat-attachments"
import { prepareImageAttachment, type AIChatAttachmentDraft } from "./ai-image-input"
import { AIMarkdown } from "./ai-markdown"
import { useAIMode } from "./ai-mode-context"
import { applyAIEvent, finalizeAssistantMessage, restoreChatSessions } from "./ai-event-reducer"
import type { Message, Session, StepStatus, ToolStep } from "./ai-types"
import { ThoughtLine } from "./thought-line"
import { ToolBranch } from "./tool-branch"
import { sourceMeta } from "./tool-source-meta"
import { AIIntro } from "./ai-intro"
import {
  AI_MODE_TIMING,
  computeCenterCardMorphTarget,
  computeCenterContentBlurMotion,
  computeCenterZoneBlurMotion,
  computeWorkspaceColumnMotion,
  type CenterCardMorphTarget,
} from "@/lib/ai-mode-transition"

/* ---------- 演示脚本：把常见自然语言请求映射到执行计划 ---------- */

type Scenario = {
  match: RegExp
  reply: string
  final: string
  reasoning?: string
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
    reasoning: "先确认时间窗口与日志来源，避免把历史告警混进来。\n接着按错误类型聚类，再用同时段网络指标做交叉验证。\n如果只是升级窗口内的瞬时超时，就不需要生成处置任务。",
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

const newSession = (): Session => ({
  id: createChatSessionId(),
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

/* ---------- 空间入场编排：中栏自核心光门破茧浮现，左右双翼向外展开 ---------- */

function Rise({
  vector,
  shown,
  exiting,
  centerMorph,
  className,
  children,
}: {
  vector: "left" | "center" | "right"
  shown: boolean
  exiting: boolean
  centerMorph?: Pick<CenterCardMorphTarget, "insetX" | "insetY">
  className?: string
  children: React.ReactNode
}) {
  const reduced = isReducedMotion()
  const motionStyle = computeWorkspaceColumnMotion(vector, shown, exiting, centerMorph)
  const effectiveStyle = reduced
    ? {
        opacity: shown && !exiting ? 1 : 0,
        transform: "none",
        filter: "none",
        clipPath: "none",
        transition: "opacity 160ms ease-out",
      }
    : motionStyle
  return (
    <div
      data-testid={`ai-workspace-col-${vector}`}
      className={cn("will-change-transform", className)}
      style={effectiveStyle}
    >
      {children}
    </div>
  )
}

/* ---------- 主组件：全屏 AI 工作台 ---------- */

export function AIWorkspace() {
  const { clients, serverConnection, developerPreview } = useServerData()
  const aiRuntime = useAIRuntimeStatus()
  const { phase, mounted, origin, exit, introDone } = useAIMode()
  const cfg = useAIConfig()
  const [sessions, setSessions] = useState<Session[]>(() => [newSession()])
  const [activeId, setActiveId] = useState(() => sessions[0]?.id ?? "")
  const [historyReady, setHistoryReady] = useState(false)
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const persistenceRef = useRef<{ enabled: boolean; chain: Promise<unknown> }>({
    enabled: false,
    chain: Promise.resolve(),
  })
  const saveTimerRef = useRef<number | null>(null)
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<AIChatAttachmentDraft[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const attachmentsRef = useRef<AIChatAttachmentDraft[]>([])
  const [busy, setBusy] = useState(false)
  const streamRef = useRef<AbortController | null>(null)
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
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
  const threadRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const centerSectionRef = useRef<HTMLElement>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const [centerMorph, setCenterMorph] = useState<CenterCardMorphTarget>(() =>
    computeCenterCardMorphTarget(
      typeof window !== "undefined" ? { width: window.innerWidth, height: window.innerHeight } : null,
    ),
  )

  useEffect(() => {
    if (!mounted || typeof window === "undefined") return
    const updateMorph = () => {
      const rect = centerSectionRef.current?.getBoundingClientRect() ?? null
      setCenterMorph(
        computeCenterCardMorphTarget(
          { width: window.innerWidth, height: window.innerHeight },
          rect && rect.width > 0 && rect.height > 0 ? rect : null,
        ),
      )
    }
    updateMorph()
    window.addEventListener("resize", updateMorph)
    return () => window.removeEventListener("resize", updateMorph)
  }, [mounted])

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0]
  const messages = active?.messages ?? []

  /** 串行落盘：始终使用最新的 sessions/activeId，避免并发 PUT 乱序覆盖。 */
  const flushHistory = useCallback(() => {
    const persistence = persistenceRef.current
    if (!persistence.enabled) return Promise.resolve()
    const next = persistence.chain.then(() => saveAIChatHistory(sessionsRef.current, activeIdRef.current))
    persistence.chain = next.catch(() => undefined)
    return persistence.chain
  }, [])

  // 启动时恢复历史快照；浏览器 developer preview 或读取失败时保持内存模式，绝不覆盖磁盘。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const history = await fetchAIChatHistory()
        if (cancelled) return
        const restored = restoreChatSessions(history.sessions)
        if (restored.length) {
          setSessions(restored)
          setActiveId(restored.find((session) => session.id === history.activeId)?.id ?? restored[0].id)
        }
        persistenceRef.current.enabled = true
      } catch {
        // 仅内存运行：不写历史文件
      } finally {
        if (!cancelled) setHistoryReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 空闲状态：700ms 防抖保存（切换/新建/删除会话等）。
  useEffect(() => {
    if (!historyReady || busy || !persistenceRef.current.enabled) return
    const timer = window.setTimeout(() => {
      saveTimerRef.current = null
      void flushHistory()
    }, 700)
    saveTimerRef.current = timer
    return () => {
      window.clearTimeout(timer)
      if (saveTimerRef.current === timer) saveTimerRef.current = null
    }
  }, [sessions, activeId, busy, historyReady, flushHistory])

  // 执行状态：开始/结束立即落盘一次，流式期间每 2.5s 保存一次。
  useEffect(() => {
    if (!historyReady || !persistenceRef.current.enabled) return
    void flushHistory()
    if (!busy) return
    const timer = window.setInterval(() => {
      void flushHistory()
    }, 2500)
    return () => window.clearInterval(timer)
  }, [busy, historyReady, flushHistory])

  // 退出 AI Mode 与组件卸载时再补一次，避免最后一次防抖被取消。
  useEffect(() => {
    if (phase === "closed") void flushHistory()
  }, [phase, flushHistory])
  useEffect(() => () => {
    void flushHistory()
  }, [flushHistory])

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

  const workspaceEntered = phase === "entering" || phase === "active"

  // 暗幕与初始几何帧就绪标记：挂载后 16ms 置为 true；因为 intro 阶段已提前挂载 1120ms，
  // 当 intro -> entering 切换时无需再次延迟 16ms，直接与 AIIntro.portalActive 同帧零延迟启动扩展！
  const [dimReady, setDimReady] = useState(false)
  useEffect(() => {
    if (mounted) {
      const t = window.setTimeout(() => setDimReady(true), 16)
      return () => window.clearTimeout(t)
    }
    setDimReady(false)
  }, [mounted])

  const shown = workspaceEntered && dimReady

  // 空间门重叠交接：entering 开始后的前 PORTAL_OVERLAP_MS 毫秒继续保留 AIIntro，
  // 使其扩张的卡片外框与中间主卡片无缝对齐并在完全展开后平滑隐退
  const [portalOverlap, setPortalOverlap] = useState(false)
  const workspaceRootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (phase === "intro" || phase === "dimming") {
      setPortalOverlap(true)
      return
    }
    if (phase === "entering") {
      setPortalOverlap(true)
      const t = window.setTimeout(() => setPortalOverlap(false), AI_MODE_TIMING.PORTAL_OVERLAP_MS)
      return () => window.clearTimeout(t)
    }
    setPortalOverlap(false)
  }, [phase])

  // 仅在无头自动化环境（navigator.webdriver）下补偿软件光栅化时间轴，真机浏览器完全交由原生 GPU 合成器以 60/120fps 运行
  useEffect(() => {
    if (phase !== "entering" && phase !== "exiting") return
    const isWebDriver = typeof navigator !== "undefined" && navigator.webdriver === true
    if (!isWebDriver) return
    let rafId = 0
    const animBirthMap = new WeakMap<Animation, number>()
    const sync = (now: number) => {
      const root = workspaceRootRef.current
      if (root && typeof root.getAnimations === "function") {
        for (const anim of root.getAnimations({ subtree: true })) {
          const timing = anim.effect?.getTiming()
          if (timing?.iterations === Infinity) continue
          let birth = animBirthMap.get(anim)
          if (birth === undefined) {
            const initialCur = typeof anim.currentTime === "number" ? anim.currentTime : 0
            birth = now - Math.max(0, initialCur)
            animBirthMap.set(anim, birth)
          }
          const elapsed = Math.max(0, now - birth)
          const cur = anim.currentTime
          if (cur === null || (typeof cur === "number" && cur < elapsed - 24)) {
            try {
              anim.currentTime = elapsed
            } catch {
              // 忽略只读时间轴异常
            }
          }
        }
      }
    }
    const loop = (now: number) => {
      sync(now)
      rafId = window.requestAnimationFrame(loop)
    }
    rafId = window.requestAnimationFrame(loop)
    const intervalId = window.setInterval(() => sync(performance.now()), 16)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.clearInterval(intervalId)
    }
  }, [phase])

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
      streamRef.current?.abort()
      streamRef.current = null
      if (!developerPreview && activeIdRef.current) void abortAIChat(activeIdRef.current)
    }
  }, [phase, developerPreview])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])

  // 卡片展开与内容增长是逐帧过渡的：贴底阅读时跟随高度变化，避免新内容停在可视区外
  const hasMessages = messages.length > 0
  useEffect(() => {
    const scroller = scrollRef.current
    const thread = threadRef.current
    if (!scroller || !thread) return
    const onScroll = () => {
      stickToBottomRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 64
    }
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) scroller.scrollTop = scroller.scrollHeight
    })
    scroller.addEventListener("scroll", onScroll, { passive: true })
    observer.observe(thread)
    return () => {
      scroller.removeEventListener("scroll", onScroll)
      observer.disconnect()
    }
  }, [hasMessages])

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

  const recordThoughtSeconds = (msgId: string, seconds: number) => {
    if (!active) return
    patchSession(active.id, (s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.id === msgId && m.role === "assistant" ? { ...m, thoughtSeconds: Math.round(seconds * 10) / 10 } : m,
      ),
    }))
  }

  const updateAttachments = (next: AIChatAttachmentDraft[]) => {
    attachmentsRef.current = next
    setAttachments(next)
  }

  const clearAttachments = () => {
    attachmentsRef.current = []
    setAttachments([])
    setAttachmentError(null)
  }

  const addImageFiles = async (files: File[]) => {
    setAttachmentError(null)
    for (const file of files) {
      if (attachmentsRef.current.length >= MAX_AI_ATTACHMENT_COUNT) {
        setAttachmentError(`最多上传 ${MAX_AI_ATTACHMENT_COUNT} 张图片`)
        break
      }
      try {
        const prepared = await prepareImageAttachment(file)
        const current = attachmentsRef.current
        if (current.length >= MAX_AI_ATTACHMENT_COUNT) {
          setAttachmentError(`最多上传 ${MAX_AI_ATTACHMENT_COUNT} 张图片`)
          break
        }
        const total = current.reduce((sum, item) => sum + item.size, 0) + prepared.size
        if (total > MAX_AI_ATTACHMENT_TOTAL_BYTES) {
          setAttachmentError("图片总大小不能超过 10 MB")
          continue
        }
        updateAttachments([...current, prepared])
      } catch (error) {
        setAttachmentError(error instanceof Error ? error.message : "读取图片失败")
      }
    }
  }

  /* ---------- 会话管理 ---------- */

  const createSession = () => {
    if (busy) return
    const s = newSession()
    setSessions((prev) => [s, ...prev])
    setActiveId(s.id)
    setInput("")
    clearAttachments()
    inputRef.current?.focus()
  }

  const deleteSession = (sid: string) => {
    if (busy && sid === activeId) return
    void (async () => {
      // 取消尚未触发的防抖保存，再让在途保存完成，避免旧快照在 DELETE 之后复活。
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      if (persistenceRef.current.enabled) await persistenceRef.current.chain.catch(() => undefined)
      if (!developerPreview) await deleteAISession(sid)
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
    })()
  }

  const switchSession = (sid: string) => {
    if (busy) return
    setActiveId(sid)
    clearAttachments()
    inputRef.current?.focus()
  }

  /* ---------- 执行：真实 AI 与 developer preview 演示 ---------- */

  const runDemo = (text: string, images: AIChatAttachment[]) => {
    if ((!text.trim() && images.length === 0) || busy || !cfg.enabled || !active) return
    const sid = active.id
    const scenario = scenarios.find((s) => s.match.test(text)) ?? fallbackScenario
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      text: text.trim(),
      ...(images.length ? { attachments: images } : {}),
    }
    const title = text.trim().slice(0, 18) || images[0]?.name.slice(0, 18) || "图片"
    const aid = `a-${Date.now()}`
    const steps: ToolStep[] = scenario.steps.map((s, i) => ({
      ...s,
      id: `${aid}-s${i}`,
      status: "running",
    }))
    const aiMsg: Message = {
      id: aid,
      role: "assistant",
      text: scenario.reply,
      steps: [],
      done: false,
      ...(scenario.reasoning ? { reasoning: scenario.reasoning, reasoningActive: true } : {}),
    }

    patchSession(sid, (s) => ({
      ...s,
      title: s.messages.length === 0 ? title : s.title,
      messages: [...s.messages, userMsg, aiMsg],
    }))
    setInput("")
    setBusy(true)

    // 演示深度思考：先展示 reasoning trace，settle 后再开始工具调用
    if (scenario.reasoning) {
      schedule(() => {
        patchSession(sid, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === aid && m.role === "assistant" ? { ...m, reasoningActive: false } : m,
          ),
        }))
      }, 1600)
    }

    // 逐步展示工具调用；遇到危险步骤停下等待确认
    let delay = scenario.reasoning ? 2200 : 700
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

  const runReal = async (text: string, images: AIChatAttachment[]) => {
    if (!active) return
    const sid = active.id
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      text: text.trim(),
      ...(images.length ? { attachments: images } : {}),
    }
    const title = text.trim().slice(0, 18) || images[0]?.name.slice(0, 18) || "图片"
    const aid = `a-${Date.now()}`
    const aiMsg: Message = { id: aid, role: "assistant", text: "", steps: [], done: false }
    patchSession(sid, (s) => ({
      ...s,
      title: s.messages.length === 0 ? title : s.title,
      messages: [...s.messages, userMsg, aiMsg],
    }))
    setInput("")
    setBusy(true)
    const controller = new AbortController()
    streamRef.current = controller
    let terminal = false
    const fail = (reason: string) => {
      patchSession(sid, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === aid && m.role === "assistant" && !m.done
            ? finalizeAssistantMessage(m, `请求失败：${reason}`)
            : m,
        ),
      }))
    }
    try {
      if (!aiRuntime.desktop) throw new Error("AI Mode 仅支持 Windows 桌面版")
      if (!aiRuntime.available) throw new Error("AI 引擎未安装，请重新安装桌面面板")
      if (!serverConnection) throw new Error("尚未配置控制服务端连接")
      await streamAIChat({
        uiSessionId: sid,
        text: text.trim(),
        ...(images.length ? { attachments: images } : {}),
        model: resolveAIModel(cfg),
        mode: agentMode,
        connection: serverConnection,
      }, (event) => {
        if (event.type === "done" || event.type === "error") terminal = true
        patchSession(sid, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === aid && m.role === "assistant" ? applyAIEvent(m, event) : m,
          ),
        }))
        if (event.type === "done" || event.type === "error") {
          if (streamRef.current === controller) streamRef.current = null
          setBusy(false)
        }
      }, controller.signal)
    } catch (error) {
      fail(error instanceof Error ? error.message : "AI 请求失败")
    } finally {
      if (!terminal) {
        patchSession(sid, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === aid && m.role === "assistant" && !m.done
              ? finalizeAssistantMessage(m, controller.signal.aborted ? "已中止" : "AI 连接已中断")
              : m,
          ),
        }))
      }
      if (streamRef.current === controller) {
        streamRef.current = null
        setBusy(false)
      }
    }
  }

  const run = (text: string) => {
    const images = attachmentsRef.current.map(({ name, mime, dataUrl }) => ({ name, mime, dataUrl }))
    if ((!text.trim() && images.length === 0) || busy || !cfg.enabled || !active || !historyReady) return
    clearAttachments()
    if (developerPreview) {
      runDemo(text, images)
      return
    }
    void runReal(text, images)
  }

  /** 用户确认危险步骤后：真实审批走服务端；演示模式继续本地时间线 */
  const confirmStep = (msgId: string, stepId: string) => {
    if (!active) return
    const sid = active.id
    const msg = active.messages.find((m) => m.id === msgId)
    if (!msg || msg.role !== "assistant") return
    const realStep = msg.steps.find((step) => step.id === stepId)
    if (realStep?.approvalId) {
      patchStep(sid, msgId, stepId, { status: "running" })
      void postAIApproval({ uiSessionId: sid, approvalId: realStep.approvalId, decision: "once" })
        .catch((error) => {
          patchStep(sid, msgId, stepId, {
            status: "error",
            output: error instanceof Error ? error.message : "确认执行失败",
          })
        })
      return
    }
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

  const denyStep = (msgId: string, stepId: string) => {
    if (!active) return
    const sid = active.id
    const msg = active.messages.find((m) => m.id === msgId)
    if (!msg || msg.role !== "assistant") return
    const step = msg.steps.find((item) => item.id === stepId)
    if (!step) return
    patchStep(sid, msgId, stepId, { status: "error", output: "已拒绝执行" })
    if (step.approvalId) {
      void postAIApproval({ uiSessionId: sid, approvalId: step.approvalId, decision: "reject" }).catch(() => undefined)
    } else {
      patchSession(sid, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === msgId && m.role === "assistant" ? { ...m, done: true } : m,
        ),
      }))
      setBusy(false)
    }
  }

  if (!mounted) return null

  const onlineCount = clients.filter((c) => c.status === "online").length
  const inIntro = phase === "intro"
  const dimming = phase === "dimming"

  return (
    <div
      ref={workspaceRootRef}
      role="dialog"
      aria-modal="true"
      aria-label="AI Mode"
      className="fixed inset-0 z-50"
      style={{
        // 铺垫与开场阶段：暗幕从透明平滑压暗至深空底并保持到工作台阶段，仅在退出时还原透明
        backgroundColor: !dimReady || exiting
          ? "rgba(8, 10, 16, 0)"
          : dimming
            ? "rgba(8, 10, 16, 0.72)"
            : inIntro
              ? "rgba(8, 10, 16, 0.92)"
              : workspaceEntered
                ? "rgba(8, 10, 16, 0.88)"
                : "rgba(8, 10, 16, 0)",
        transition: exiting
          ? "background-color 380ms ease-in"
          : "background-color 420ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* 氛围层：暗房曜石黑底 + 克制冷钛银/冰蓝环境漫反射 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: shown && !inIntro ? 1 : 0,
          transition: "opacity 1000ms ease",
          background: "color-mix(in oklab, oklch(0.09 0.01 255) 62%, transparent)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ opacity: shown && !inIntro ? 1 : 0, transition: "opacity 1400ms ease" }}
      >
        {/* 克制的三处暗房环境冷光：冰蓝 / 钛银 / 冷灰蓝，避免霓虹感 */}
        <span
          className="animate-aurora absolute -top-24 left-[14%] h-80 w-[34rem] rounded-full"
          style={{
            background: "radial-gradient(ellipse at center, rgba(147, 197, 253, 0.09), transparent 72%)",
            filter: "blur(42px)",
          }}
        />
        <span
          className="animate-aurora absolute -bottom-32 left-[38%] h-72 w-[40rem] rounded-full"
          style={{
            background: "radial-gradient(ellipse at center, rgba(226, 232, 240, 0.07), transparent 72%)",
            filter: "blur(48px)",
            animationDelay: "-5s",
          }}
        />
        <span
          className="animate-aurora absolute -right-20 top-[30%] h-72 w-96 rounded-full"
          style={{
            background: "radial-gradient(ellipse at center, rgba(148, 163, 184, 0.07), transparent 72%)",
            filter: "blur(44px)",
            animationDelay: "-9s",
          }}
        />
      </div>

      {/* 开场精密光学加载卡片与四向扩展动画：在 intro 及 entering 重叠期内挂载，实现卡片扩展与内容模糊交叉溶解 */}
      {(inIntro || dimming || portalOverlap) && (
        <div
          className="absolute inset-0 z-20"
          style={{ pointerEvents: inIntro || dimming ? "auto" : "none" }}
        >
          <AIIntro onDone={introDone} origin={origin} targetCard={centerMorph} />
        </div>
      )}

      {/* 顶部与底部铂金-冰蓝光学地平线：从中心向两侧延展 */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-px"
        style={{
          width: shown ? "100%" : inIntro ? "46%" : "0%",
          opacity: shown || inIntro ? 0.85 : 0,
          background:
            "linear-gradient(to right, transparent, rgba(147, 197, 253, 0.35) 26%, rgba(248, 250, 252, 0.78) 50%, rgba(147, 197, 253, 0.35) 74%, transparent)",
          transition: "width 760ms cubic-bezier(0.16, 1, 0.3, 1), opacity 360ms ease",
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto h-px"
        style={{
          width: shown ? "86%" : "0%",
          opacity: shown ? 0.45 : 0,
          background:
            "linear-gradient(to right, transparent, rgba(148, 163, 184, 0.25) 30%, rgba(226, 232, 240, 0.55) 50%, rgba(148, 163, 184, 0.25) 70%, transparent)",
          transition: "width 860ms cubic-bezier(0.16, 1, 0.3, 1) 80ms, opacity 420ms ease 80ms",
        }}
      />

      {/* 三栏布局：会话侧栏 / 对话流（由中央加载卡片四向扩展而成） / 遥测面板
          在 intro 期间保持容器可见（此时左右卡片 opacity=0、中间卡片被 clip-path 裁剪为 368x256 且内部新内容 opacity=0），
          从而使中间卡片毛玻璃底面从一开始就作为统一卡片基底存在，进入 entering 时零跳变直接向四周扩展 */}
      <div
        className="relative flex h-full w-full gap-4 p-4 sm:p-5"
        style={{
          opacity: dimReady || workspaceEntered || exiting ? 1 : 0,
          pointerEvents: workspaceEntered ? "auto" : "none",
        }}
      >
        {/* ===== 左栏：会话管理 ===== */}
        <Rise vector="left" shown={shown} exiting={exiting} className="hidden w-64 shrink-0 md:block">
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

        {/* ===== 中栏：对话流（由中央加载卡片向四周扩展生成，内部新内容模糊渐显） ===== */}
        <Rise
          vector="center"
          shown={shown}
          exiting={exiting}
          centerMorph={centerMorph}
          className="min-w-0 flex-1"
        >
          <section
            ref={centerSectionRef}
            className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-border/60"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[inherit] bg-background/55 backdrop-blur-xl"
            />
            <div
              data-testid="ai-workspace-center-content"
              className="relative z-10 flex h-full w-full flex-col overflow-hidden"
              style={computeCenterContentBlurMotion(shown, exiting, phase === "active")}
            >
              {/* 面板顶栏：随卡片向上扩展同步舒展并模糊渐显 */}
              <header
                data-testid="ai-workspace-center-header"
                className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3"
                style={computeCenterZoneBlurMotion("header", shown, exiting, phase === "active")}
              >
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

            {/* 消息区：在卡片中心原光学陀螺仪模糊消散的位置模糊渐显 */}
            <div
              ref={scrollRef}
              data-testid="ai-workspace-center-body"
              className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
              style={computeCenterZoneBlurMotion("body", shown, exiting, phase === "active")}
            >
              {messages.length === 0 ? (
                historyReady ? (
                  <EmptyState onPick={run} disabled={!cfg.enabled} revealed={shown} />
                ) : (
                  <div className="flex h-full min-h-[320px] items-center justify-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    正在加载会话…
                  </div>
                )
              ) : (
                <div ref={threadRef} className="mx-auto flex max-w-3xl flex-col gap-5 pb-2">
                  {messages.map((m) =>
                    m.role === "user" ? (
                      <div key={m.id} className="flex flex-col items-end gap-2">
                        {m.attachments?.length ? (
                          <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
                            {m.attachments.map((attachment, index) => (
                              attachment.dataUrl ? (
                                <img
                                  key={`${m.id}-${index}`}
                                  src={attachment.dataUrl}
                                  alt={attachment.name}
                                  className="h-28 max-w-44 rounded-xl border border-border/70 object-cover"
                                />
                              ) : (
                                <span
                                  key={`${m.id}-${index}`}
                                  className="flex h-20 max-w-56 items-center gap-2 rounded-xl border border-border/70 bg-foreground/[0.03] px-3 text-xs text-muted-foreground"
                                >
                                  <ImagePlus className="h-4 w-4 shrink-0" />
                                  <span className="min-w-0 leading-tight">
                                    <span className="block truncate">{attachment.name}</span>
                                    <span className="block text-[10px] text-muted-foreground/60">历史图片未保存</span>
                                  </span>
                                </span>
                              )
                            ))}
                          </div>
                        ) : null}
                        {m.text ? (
                          <span className="max-w-[85%] rounded-2xl rounded-br-md border border-border/70 bg-foreground/[0.06] px-4 py-2.5 text-sm text-foreground backdrop-blur-sm">
                            {m.text}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <AssistantBubble
                        key={m.id}
                        msg={m}
                        agentMode={agentMode}
                        developerPreview={developerPreview}
                        onConfirm={(stepId) => confirmStep(m.id, stepId)}
                        onDeny={(stepId) => denyStep(m.id, stepId)}
                        onThoughtSettle={(seconds) => recordThoughtSeconds(m.id, seconds)}
                      />
                    ),
                  )}
                </div>
              )}
            </div>

            {/* 输入区：随卡片向下扩展同步舒展并模糊渐显 */}
            <div
              data-testid="ai-workspace-center-footer"
              className="relative shrink-0 px-5 pb-4"
              style={computeCenterZoneBlurMotion("footer", shown, exiting, phase === "active")}
            >
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
                onDragOver={(event) => {
                  if (cfg.enabled && !busy && event.dataTransfer.types.includes("Files")) event.preventDefault()
                }}
                onDrop={(event) => {
                  if (!cfg.enabled || busy || event.dataTransfer.files.length === 0) return
                  event.preventDefault()
                  void addImageFiles(Array.from(event.dataTransfer.files))
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
                {/* 顶部：@ 引用与图片附件 */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? [])
                    event.target.value = ""
                    if (files.length) void addImageFiles(files)
                  }}
                />
                <div className="relative flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="引用客户端或资源"
                    disabled={!cfg.enabled}
                    onClick={() => {
                      setInput((v) => (v.endsWith("@") ? v : `${v}@`))
                      inputRef.current?.focus()
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-foreground/[0.04] text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-40"
                  >
                    <AtSign className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="添加图片"
                    title="添加图片（也可直接粘贴）"
                    disabled={!cfg.enabled || busy}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-foreground/[0.04] text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-40"
                  >
                    <ImagePlus className="h-4 w-4" />
                  </button>
                </div>

                {attachments.length > 0 && (
                  <div className="relative mt-2 flex flex-wrap gap-2">
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="group/image relative h-16 w-16 overflow-hidden rounded-lg border border-border/70 bg-background"
                      >
                        <img src={attachment.dataUrl} alt={attachment.name} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          aria-label={`移除 ${attachment.name}`}
                          onClick={() => updateAttachments(attachmentsRef.current.filter((item) => item.id !== attachment.id))}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/85 text-foreground opacity-90 backdrop-blur transition-opacity hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {attachmentError && <p className="relative mt-1 text-[10px] text-negative">{attachmentError}</p>}

                {/* 中部：指令输入 */}
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={(event) => {
                    const files = Array.from(event.clipboardData?.items ?? [])
                      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                      .map((item) => item.getAsFile())
                      .filter((file): file is File => Boolean(file))
                    if (files.length === 0) return
                    event.preventDefault()
                    void addImageFiles(files)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) run(input)
                  }}
                  placeholder={
                    !historyReady
                      ? "正在加载历史会话…"
                      : cfg.enabled
                        ? "描述你想做的事，也可以粘贴图片…"
                        : "AI Mode 已停用，请先在设置中开启"
                  }
                  disabled={!cfg.enabled || !historyReady}
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
                    disabled={(!input.trim() && attachments.length === 0) || busy || !cfg.enabled || !historyReady}
                    aria-label="发送"
                    className={cn(
                      "ml-auto flex h-8 w-8 items-center justify-center rounded-full transition-all",
                      (input.trim() || attachments.length > 0) && !busy
                        ? "bg-primary text-primary-foreground shadow-[0_0_20px_-6px] shadow-primary/60 hover:brightness-110"
                        : "border border-border/70 bg-foreground/[0.03] text-muted-foreground/50",
                    )}
                  >
                    {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-center text-[10px] text-muted-foreground/60">
                {developerPreview
                  ? "演示环境：AI 规划与工具调用在本地模拟 · 危险操作默认需人工确认"
                  : "桌面本地 AI · 代码与危险操作需人工确认"}
              </p>
            </div>
            </div>
          </section>
        </Rise>

        {/* ===== 右栏：执行遥测 ===== */}
        <Rise vector="right" shown={shown} exiting={exiting} className="hidden w-64 shrink-0 lg:block">
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

/**
 * iOS 风格逐词模糊渐显：把文本按词切分，每个词从模糊中错峰浮现。
 * 仅用于空态欢迎语；对话正文走 Markdown 渲染，避免破坏块级结构。
 */
function BlurWords({
  text,
  className,
  baseDelayMs = 0,
}: {
  text: string
  className?: string
  baseDelayMs?: number
}) {
  const previous = useRef(text)
  const incremental = text.startsWith(previous.current)
  previous.current = text
  const parts = text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]{1,2}|\S+\s*|\s+/g) ?? [text]
  return (
    <span key={incremental ? "stream" : text} className={className}>
      {parts.map((part, i) => (
        <span
          key={i}
          className="animate-word-in"
          style={{ animationDelay: `${baseDelayMs + Math.min(i * 32, 900)}ms` }}
        >
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

function EmptyState({
  onPick,
  disabled,
  revealed = true,
}: {
  onPick: (t: string) => void
  disabled: boolean
  revealed?: boolean
}) {
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
      <div key={revealed ? "revealed" : "pending"} className="leading-tight">
        <h3 className="text-lg font-semibold">
          {revealed ? <BlurWords text="想让我做点什么？" baseDelayMs={160} /> : "想让我做点什么？"}
        </h3>
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {revealed ? (
            <BlurWords
              text="直接用一句话描述目标，我会拆解成步骤、调用合适的工具，并在关键操作前请你确认。"
              baseDelayMs={220}
            />
          ) : (
            "直接用一句话描述目标，我会拆解成步骤、调用合适的工具，并在关键操作前请你确认。"
          )}
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

/* ---------- assistant 气泡：深度思考 + 工具分支 + Markdown 回复 ---------- */

function AssistantBubble({
  msg,
  agentMode,
  developerPreview,
  onConfirm,
  onDeny,
  onThoughtSettle,
}: {
  msg: Extract<Message, { role: "assistant" }>
  agentMode: "agent" | "chat"
  developerPreview: boolean
  onConfirm: (stepId: string) => void
  onDeny: (stepId: string) => void
  onThoughtSettle: (seconds: number) => void
}) {
  const livePlanning = agentMode === "agent"
    && !developerPreview
    && !msg.done
    && msg.steps.length === 0
    && !msg.reasoning
    && looksLikePlanningText(msg.text)
  const reasoning = msg.reasoning ?? (livePlanning ? msg.text : "")
  const reasoningLive = !msg.done && (msg.reasoningActive === true || livePlanning)
  const preTokenThinking = !msg.text && !msg.done && msg.steps.length === 0
  const showThought = Boolean(reasoning) || preTokenThinking
  const thinking = reasoningLive || preTokenThinking
  const thoughtSteps = useMemo(() => toThoughtSteps(reasoning), [reasoning])
  return (
    <div className="flex max-w-[92%] flex-col gap-3">
      {showThought ? (
        <div className="ml-9">
          <ThoughtLine
            label={reasoning ? "深度思考中…" : "正在思考…"}
            doneLabel={reasoning ? "已深度思考" : "已思考"}
            working={thinking}
            steps={thoughtSteps}
            elapsed={msg.thoughtSeconds}
            onSettle={onThoughtSettle}
            glyph="sparkle"
            fontSize={13}
          />
        </div>
      ) : null}

      {msg.steps.length > 0 ? (
        <ToolBranch steps={msg.steps} settled={msg.done} onConfirm={onConfirm} onDeny={onDeny} />
      ) : null}

      {!livePlanning && msg.text ? (
        <div className="flex min-w-0 items-start gap-2.5">
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
          <div className="min-w-0 flex-1 pt-1">
            <AIMarkdown text={msg.text} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
