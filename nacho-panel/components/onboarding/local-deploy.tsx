"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"

/** 终端日志行：文本 / 配色分类 / 与上一行的间隔 / 输出后进度条应到达的百分比 */
type LogLine = {
  text: string
  kind: "cmd" | "info" | "ok" | "dim"
  gap: number
  prog: number
}

const LOG_LINES: LogLine[] = [
  { text: "$ nacho deploy --local", kind: "cmd", gap: 0, prog: 4 },
  { text: "正在检测本机环境 ...", kind: "dim", gap: 620, prog: 9 },
  { text: "✓ 发现 NachoPanel 服务端 v2.4.1 (127.0.0.1:8720)", kind: "ok", gap: 760, prog: 16 },
  { text: "$ nacho fetch core@2.4.1", kind: "cmd", gap: 560, prog: 21 },
  { text: "下载核心组件 nacho-core ...", kind: "dim", gap: 420, prog: 30 },
  { text: "✓ nacho-core 下载完成 (12.4 MB)", kind: "ok", gap: 980, prog: 42 },
  { text: "$ nacho install --modules", kind: "cmd", gap: 520, prog: 47 },
  { text: "✓ ws-bridge@1.8.0", kind: "ok", gap: 380, prog: 54 },
  { text: "✓ metrics-agent@3.2.5", kind: "ok", gap: 300, prog: 61 },
  { text: "✓ task-scheduler@2.0.3", kind: "ok", gap: 320, prog: 68 },
  { text: "$ nacho db migrate", kind: "cmd", gap: 540, prog: 73 },
  { text: "✓ 数据表迁移完成 (14/14)", kind: "ok", gap: 820, prog: 84 },
  { text: "$ nacho link --local", kind: "cmd", gap: 500, prog: 89 },
  { text: "✓ 握手成功 · 延迟 3ms", kind: "ok", gap: 680, prog: 96 },
  { text: "✓ 本地部署完成，NachoPanel 已就绪", kind: "ok", gap: 620, prog: 100 },
]

const LINE_COLOR: Record<LogLine["kind"], string> = {
  cmd: "text-primary",
  info: "text-foreground",
  ok: "text-positive",
  dim: "text-muted-foreground",
}

/**
 * 本地部署页面：确认"本地部署"后进入。
 * 1. N 字在屏幕正中放大绘制（沿用开场的分部生长：左竖升起、右竖降下、斜笔画淡入），
 *    不带 "acho Panel" 后续文字。
 * 2. 画完后 N 以纯 transform（translateY + scale 回归 identity）丝滑上移让位并缩小。
 * 3. 下方模拟终端带模糊渐显浮现，逐行输出安装日志并同步驱动进度条。
 * 4. 进度 100% 后短暂停留，整体模糊渐隐，进入下一步。
 *
 * 丝滑要点：页面始终按"最终布局"（N 在上、终端在下）排版，开场态只给 N 施加
 * 「translateY 到视觉中心 + 放大」的变换，上移时变换回归 identity——全程只跑
 * transform / opacity / filter，不 animate 布局属性，避免重排卡顿。
 */
export function LocalDeploy({ onDone }: { onDone: () => void }) {
  // idle: 空场等待 → draw: N 生长画出 → rise: N 上移归位 → run: 终端输出
  const [stage, setStage] = useState<"idle" | "draw" | "rise" | "run">("idle")
  // 离场用独立 state：若复用 stage，切换会触发日志 effect 的 cleanup 把 onDone 定时器清掉
  const [leaving, setLeaving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const nWrapRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // 开场态：把 N 从最终位置平移到视觉中心并放大
  const [introTf, setIntroTf] = useState("")
  const [ready, setReady] = useState(false)
  // 已输出的日志行数与进度
  const [count, setCount] = useState(0)
  const [progress, setProgress] = useState(0)
  const doneRef = useRef(false)

  const uid = useId().replace(/:/g, "")
  const gA = `${uid}-a`
  const gB = `${uid}-b`

  // 挂载后按最终布局测量：算出让 N 居中的位移（此刻 N 尚未画出、不可见，无闪烁）
  useLayoutEffect(() => {
    const c = containerRef.current
    const n = nWrapRef.current
    if (!c || !n) return
    const cb = c.getBoundingClientRect()
    const nb = n.getBoundingClientRect()
    const dy = cb.top + cb.height / 2 - (nb.top + nb.height / 2)
    setIntroTf(`translateY(${dy}px) scale(1.9)`)
    setReady(true)
  }, [])

  // 阶段编排：draw(1500ms 生长) → rise(950ms 上移) → run(日志流)
  useEffect(() => {
    const timers: number[] = []
    timers.push(window.setTimeout(() => setStage("draw"), 400))
    timers.push(window.setTimeout(() => setStage("rise"), 400 + 1500))
    timers.push(window.setTimeout(() => setStage("run"), 400 + 1500 + 780))
    return () => timers.forEach(clearTimeout)
  }, [])

  // 日志流：按每行 gap 串联输出，同步推进进度；全部完成后停留再离场
  useEffect(() => {
    if (stage !== "run") return
    const timers: number[] = []
    let at = 350
    LOG_LINES.forEach((line, i) => {
      at += line.gap
      timers.push(
        window.setTimeout(() => {
          setCount(i + 1)
          setProgress(line.prog)
        }, at),
      )
    })
    // 完成后：停留 1200ms → 离场 750ms → onDone
    timers.push(window.setTimeout(() => setLeaving(true), at + 1200))
    timers.push(
      window.setTimeout(() => {
        if (!doneRef.current) {
          doneRef.current = true
          onDone()
        }
      }, at + 1200 + 780),
    )
    return () => timers.forEach(clearTimeout)
  }, [stage, onDone])

  // 新行输出时自动滚到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [count])

  const drawn = stage !== "idle"
  const risen = stage === "rise" || stage === "run"
  const running = stage === "run"
  const finished = count >= LOG_LINES.length

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full items-center justify-center px-6"
      style={{
        opacity: leaving ? 0 : 1,
        filter: leaving ? "blur(14px)" : "blur(0px)",
        transform: leaving ? "scale(0.97)" : "scale(1)",
        transition: `opacity 700ms ease, filter 700ms ease, transform 700ms ${EASE}`,
      }}
    >
      <div className="flex w-full max-w-xl flex-col items-center gap-7">
        {/* N 字：最终布局固定在顶部；开场态整体平移到视觉中心并放大，rise 时变换回归 identity */}
        <div
          ref={nWrapRef}
          className="will-change-transform"
          style={{
            transform: risen ? "none" : introTf,
            transformOrigin: "center",
            // 仅在 rise 归位时过渡；idle/draw 阶段瞬间居中，避免首帧从顶部滑向中间的错觉
            transition: risen ? `transform 950ms ${EASE}` : "none",
            visibility: ready ? "visible" : "hidden",
            opacity: stage === "idle" ? 0 : 1,
          }}
        >
          <svg viewBox="0 0 44 44" fill="none" aria-hidden style={{ width: 72, height: 72 }}>
            <defs>
              <linearGradient id={gA} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="oklch(1 0 0)" />
                <stop offset="100%" stopColor="oklch(0.85 0 0)" />
              </linearGradient>
              <linearGradient id={gB} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="oklch(0.7 0 0)" />
                <stop offset="100%" stopColor="oklch(0.5 0 0)" />
              </linearGradient>
            </defs>

            {/* 斜笔画上块：两竖擦出后淡入 + 轻微上浮 */}
            <polygon
              points="17,9 26,20.7 17,20.7"
              fill={`url(#${gB})`}
              style={{
                opacity: drawn ? 1 : 0,
                transformBox: "fill-box",
                transformOrigin: "center",
                transform: drawn ? "translateY(0)" : "translateY(3px)",
                transition: `opacity 600ms ease-out, transform 600ms ${EASE}`,
                transitionDelay: drawn ? "600ms" : "0ms",
              }}
            />
            {/* 斜笔画下块 */}
            <polygon
              points="18,23.3 27,23.3 27,35"
              fill={`url(#${gB})`}
              style={{
                opacity: drawn ? 1 : 0,
                transformBox: "fill-box",
                transformOrigin: "center",
                transform: drawn ? "translateY(0)" : "translateY(3px)",
                transition: `opacity 600ms ease-out, transform 600ms ${EASE}`,
                transitionDelay: drawn ? "700ms" : "0ms",
              }}
            />
            {/* 左竖：自底部向上擦出 */}
            <rect
              x="8"
              y="7"
              width="8"
              height="30"
              rx="3"
              fill={`url(#${gA})`}
              style={{
                clipPath: drawn ? "inset(0 0 0 0)" : "inset(100% 0 0 0)",
                transition: `clip-path 880ms ${EASE}`,
              }}
            />
            {/* 右竖：自顶部向下擦出 */}
            <rect
              x="28"
              y="7"
              width="8"
              height="30"
              rx="3"
              fill={`url(#${gA})`}
              style={{
                clipPath: drawn ? "inset(0 0 0 0)" : "inset(0 0 100% 0)",
                transition: `clip-path 880ms ${EASE}`,
                transitionDelay: drawn ? "130ms" : "0ms",
              }}
            />
            <rect x="8" y="7" width="8" height="5" rx="3" fill="white" fillOpacity="0.15" />
            <rect x="28" y="7" width="8" height="5" rx="3" fill="white" fillOpacity="0.15" />
          </svg>
        </div>

        {/* 标题 + 终端 + 进度条：N 上移开始后带模糊错峰渐显 */}
        <div
          className="flex w-full flex-col items-center gap-6"
          style={{
            opacity: running ? 1 : 0,
            transform: running ? "translateY(0)" : "translateY(26px)",
            filter: running ? "blur(0px)" : "blur(12px)",
            transition: `opacity 750ms ease, transform 750ms ${EASE}, filter 750ms ease`,
            pointerEvents: running ? "auto" : "none",
          }}
          aria-hidden={!running}
        >
          <div className="flex flex-col items-center gap-2">
            <h1 className="text-balance text-center text-xl font-semibold text-foreground sm:text-2xl">
              {finished ? "本地部署完成" : "正在部署本地服务端"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {finished ? "NachoPanel 已就绪，即将继续" : "自动安装组件并连接本机 NachoPanel 服务端"}
            </p>
          </div>

          {/* 模拟终端 */}
          <div className="w-full overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/40">
            {/* 终端标题栏 */}
            <div className="flex items-center gap-2 border-b border-border bg-surface/60 px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-negative/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-positive/70" />
              <span className="ml-2 font-mono text-xs text-muted-foreground">nacho-installer — local</span>
            </div>
            {/* 日志区 */}
            <div
              ref={scrollRef}
              className="h-52 overflow-y-auto px-4 py-3 font-mono text-[13px] leading-relaxed"
              role="log"
              aria-live="polite"
            >
              {LOG_LINES.slice(0, count).map((line, i) => (
                <div key={i} className={cn("animate-deploy-line whitespace-pre-wrap", LINE_COLOR[line.kind])}>
                  {line.text}
                  {/* 最后一行且未完成时附带闪烁光标 */}
                  {i === count - 1 && !finished && (
                    <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-[1px] bg-primary/80" />
                  )}
                </div>
              ))}
              {count === 0 && (
                <span className="inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-[1px] bg-primary/80" />
              )}
            </div>
            {/* 进度条 */}
            <div className="flex items-center gap-3 border-t border-border bg-surface/40 px-4 py-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", finished ? "bg-positive" : "bg-primary")}
                  style={{
                    width: `${progress}%`,
                    transition: `width 620ms ${EASE}, background-color 400ms ease`,
                  }}
                />
              </div>
              <span
                className={cn(
                  "w-10 text-right font-mono text-xs tabular-nums",
                  finished ? "text-positive" : "text-muted-foreground",
                )}
              >
                {progress}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
