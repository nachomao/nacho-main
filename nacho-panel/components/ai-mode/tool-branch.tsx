"use client"

/* 工具调用分支：改编自 React Bits BranchedMenu
 * https://reactbits.dev/micro/branched-menu
 * MIT + Commons Clause，Copyright (c) 2026 David Haz。
 * 本实现用来源分组 + 选中项详情面板替换原来的工具卡片，并接入面板动效偏好；
 * 卡片展开、分组折叠、新增步骤与详情切换都通过 AutoHeight 平滑过渡高度。 */

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  ShieldAlert,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useMotionPreference } from "@/lib/motion-preference"
import { firstWaitingStepId, groupToolSteps } from "@/lib/ai/tool-groups"
import type { ToolStep } from "@/lib/ai/chat-history"
import { AutoHeight } from "@/components/ui/auto-height"
import { sourceMeta } from "./tool-source-meta"

const PAD = 6
const MARK = 16
const ROW_HEIGHT = 34
const INDENT = 40
const TRUNK = 14
const RADIUS = 10
const LINE_WIDTH = 1.5
const DRAW_DURATION = 400
const FOLD_DURATION = 300

type Status = ToolStep["status"]

function StepStatusIcon({ status, className }: { status: Status; className?: string }) {
  const classes = cn("h-3.5 w-3.5 shrink-0", className)
  if (status === "running") return <LoaderCircle className={cn(classes, "animate-spin text-primary")} />
  if (status === "done") return <CircleCheck className={cn(classes, "text-positive")} />
  if (status === "error") return <CircleAlert className={cn(classes, "text-negative")} />
  return <ShieldAlert className={cn(classes, "text-warning")} />
}

function statusLabel(status: Status) {
  if (status === "running") return "执行中"
  if (status === "done") return "已完成"
  if (status === "error") return "失败"
  return "等待确认"
}

function aggregateStatus(steps: ToolStep[]): Status {
  if (steps.some((step) => step.status === "waiting-confirm")) return "waiting-confirm"
  if (steps.some((step) => step.status === "running")) return "running"
  if (steps.some((step) => step.status === "error")) return "error"
  return "done"
}

function summaryText(steps: ToolStep[]) {
  const done = steps.filter((step) => step.status === "done").length
  const error = steps.filter((step) => step.status === "error").length
  const waiting = steps.filter((step) => step.status === "waiting-confirm").length
  if (waiting > 0) return `${done}/${steps.length} 完成 · ${waiting} 待确认`
  if (steps.some((step) => step.status === "running")) return `${done}/${steps.length} 完成 · 执行中`
  if (error > 0) return `${done}/${steps.length} 完成 · ${error} 失败`
  return "全部完成"
}

/** 布局坐标（不受祖先 transform 影响）：沿 offsetParent 链累加到指定祖先。 */
function offsetTopWithin(element: HTMLElement, ancestor: HTMLElement) {
  let top = 0
  let node: HTMLElement | null = element
  while (node && node !== ancestor) {
    top += node.offsetTop
    node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null
  }
  return node === ancestor ? top : null
}

function ToolStepDetail({
  step,
  className,
  onConfirm,
  onDeny,
}: {
  step: ToolStep
  className?: string
  onConfirm: (stepId: string) => void
  onDeny: (stepId: string) => void
}) {
  const meta = sourceMeta[step.source]
  const waiting = step.status === "waiting-confirm"
  return (
    <div
      className={cn(
        "mt-3 rounded-lg border p-3",
        waiting ? "border-warning/40 bg-warning/5" : "border-border/60 bg-background/40",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <StepStatusIcon status={step.status} />
        <span className={cn(waiting ? "text-warning" : "text-muted-foreground")}>{statusLabel(step.status)}</span>
        <span className="flex items-center gap-1 rounded-md border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          <meta.Icon className="h-3 w-3" />
          {meta.label}
        </span>
        <code className="min-w-0 truncate font-mono text-[11px] text-primary">{step.tool}</code>
        {step.risk ? (
          <span className={cn(
            "rounded-md border px-1.5 py-0.5 text-[10px]",
            step.risk === "danger"
              ? "border-negative/40 text-negative"
              : "border-warning/40 text-warning",
          )}>
            {step.risk === "danger" ? "危险" : "警告"}
          </span>
        ) : null}
      </div>
      {step.detail && step.detail !== step.tool ? (
        <p className="mt-2 break-words text-[11px] leading-relaxed text-muted-foreground">{step.detail}</p>
      ) : null}
      {step.output ? (
        <div className="mt-2">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">输出</p>
          <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/50 bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {step.output}
          </pre>
        </div>
      ) : null}
      {waiting ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-warning">此操作会影响线上服务，需要你确认</span>
          <button
            type="button"
            onClick={() => onConfirm(step.id)}
            className="rounded-lg bg-warning px-2.5 py-1 text-[11px] font-semibold text-background transition-all hover:brightness-105"
          >
            确认执行
          </button>
          <button
            type="button"
            onClick={() => onDeny(step.id)}
            className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            拒绝
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function ToolBranch({
  steps,
  onConfirm,
  onDeny,
}: {
  steps: ToolStep[]
  onConfirm: (stepId: string) => void
  onDeny: (stepId: string) => void
}) {
  const { reduceMotion } = useMotionPreference()
  const groups = useMemo(() => groupToolSteps(steps), [steps])
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const [selectedId, setSelectedId] = useState(() => firstWaitingStepId(steps) ?? steps.at(-1)?.id ?? "")
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const navRef = useRef<HTMLElement>(null)
  const markerRef = useRef<HTMLSpanElement>(null)
  const markerTopRef = useRef<number | null>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())

  const active = steps.some((step) => step.status === "running" || step.status === "waiting-confirm")
  const expanded = manualOpen ?? active
  const selected = steps.find((step) => step.id === selectedId) ?? null
  const summaryStatus = aggregateStatus(steps)
  const drawDuration = reduceMotion ? 0 : DRAW_DURATION
  const foldDuration = reduceMotion ? 0 : FOLD_DURATION
  const hasSteps = steps.length > 0
  // 只有实时出现的卡片做入场淡入；切换到历史会话时直接呈现
  const [entering] = useState(() => active && !reduceMotion)

  useEffect(() => {
    if (!steps.length) {
      setSelectedId("")
      return
    }
    const waitingId = firstWaitingStepId(steps)
    if (waitingId && waitingId !== selectedId) {
      setSelectedId(waitingId)
      setManualOpen(true)
      return
    }
    if (selectedId && steps.some((step) => step.id === selectedId)) return
    setSelectedId(steps[steps.length - 1].id)
  }, [steps, selectedId])

  // glide=true：切换选中项时滑动；glide=false：上方分组正在折叠 / 展开时逐帧贴住所选行
  const placeMarker = useEffectEvent((glide: boolean) => {
    const nav = navRef.current
    const marker = markerRef.current
    if (!nav || !marker) return
    const selectedStep = steps.find((step) => step.id === selectedId)
    const row = rowRefs.current.get(selectedId)
    const rowTop = row ? offsetTopWithin(row, nav) : null
    if (!expanded || !selectedStep || !row || rowTop === null || collapsedGroups.has(selectedStep.source)) {
      marker.removeAttribute("data-on")
      markerTopRef.current = null
      return
    }
    const top = rowTop + (row.offsetHeight - MARK) / 2
    const previous = markerTopRef.current
    if (previous === null || Math.abs(top - previous) >= 0.5) {
      if (glide && previous !== null) {
        marker.style.top = `${top}px`
      } else {
        marker.style.transitionProperty = "opacity"
        marker.style.top = `${top}px`
        void marker.offsetHeight
        marker.style.transitionProperty = ""
      }
      markerTopRef.current = top
    }
    marker.setAttribute("data-on", "")
  })

  useEffect(() => {
    placeMarker(true)
  }, [selectedId, steps, expanded, collapsedGroups])

  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const observer = new ResizeObserver(() => placeMarker(false))
    observer.observe(nav)
    return () => observer.disconnect()
  }, [hasSteps])

  if (!steps.length) return null

  const toggleGroup = (source: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })
  }

  return (
    <div className={cn("ml-9 flex flex-col", entering && "animate-in fade-in-0 duration-300")}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualOpen(!expanded)}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-surface/40 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        <StepStatusIcon status={summaryStatus} />
        <span className="shrink-0 text-foreground/80">工具调用</span>
        <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-foreground/80">
          {steps.length}
        </span>
        <span className="min-w-0 flex-1 truncate">{summaryText(steps)}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-180")} />
      </button>

      <AutoHeight open={expanded} appear duration={foldDuration} innerClassName="pt-2">
        <div className="rounded-xl border border-border/60 bg-surface/30 p-2.5">
          <nav ref={navRef} className="relative w-full pl-3.5" aria-label="工具调用分支">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 left-0 top-2 w-0.5 rounded-[1px]"
              style={{ background: "linear-gradient(to bottom, var(--border) 0%, var(--border) 55%, transparent 100%)" }}
            />
            <span
              ref={markerRef}
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 z-[2] h-4 w-0.5 rounded-[1px] bg-primary opacity-0 transition-[top,opacity] duration-200 data-[on]:opacity-100"
            />

            {groups.map((group) => {
              const meta = sourceMeta[group.source]
              const groupOpen = !collapsedGroups.has(group.source)
              const bodyHeight = PAD * 2 + group.steps.length * ROW_HEIGHT
              const rowY = (k: number) => PAD + k * ROW_HEIGHT + ROW_HEIGHT / 2
              const radius = Math.min(RADIUS, ROW_HEIGHT / 2 - 2)
              const endX = INDENT - 8
              const branch = (k: number) =>
                `M ${TRUNK} ${rowY(k) - radius} A ${radius} ${radius} 0 0 0 ${TRUNK + radius} ${rowY(k)} H ${endX}`
              const reach = (k: number) =>
                `M ${TRUNK} 0 V ${rowY(k) - radius} A ${radius} ${radius} 0 0 0 ${TRUNK + radius} ${rowY(k)} H ${endX}`
              const length = (k: number) =>
                rowY(k) - radius + (Math.PI * radius) / 2 + (endX - TRUNK - radius)

              return (
                <section key={group.source} className="flex flex-col">
                  <button
                    type="button"
                    aria-expanded={groupOpen}
                    onClick={() => toggleGroup(group.source)}
                    className="flex w-full items-center gap-2 py-[7px] text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <meta.Icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{meta.label}</span>
                    <span className="rounded border border-border/70 px-1 text-[9px]">{group.steps.length}</span>
                    <StepStatusIcon status={aggregateStatus(group.steps)} className="ml-auto h-3 w-3" />
                    <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", groupOpen && "rotate-180")} />
                  </button>

                  <AutoHeight open={groupOpen} duration={foldDuration}>
                    <div className="relative box-border py-1.5" style={{ height: bodyHeight }}>
                      <svg
                        className="pointer-events-none absolute left-0 top-0 overflow-visible opacity-100"
                        width={INDENT}
                        height={bodyHeight}
                        aria-hidden="true"
                      >
                        <path
                          d={`M ${TRUNK} 0 V ${rowY(group.steps.length - 1) - radius}`}
                          fill="none"
                          stroke="var(--border)"
                          strokeWidth={LINE_WIDTH}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {group.steps.map((step, index) => (
                          <path
                            key={`base-${step.id}`}
                            d={branch(index)}
                            fill="none"
                            stroke="var(--border)"
                            strokeWidth={LINE_WIDTH}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ))}
                        {group.steps.map((step, index) => (
                          <path
                            key={`reach-${step.id}`}
                            d={reach(index)}
                            fill="none"
                            stroke="var(--primary)"
                            strokeWidth={LINE_WIDTH}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                              strokeDasharray: length(index),
                              strokeDashoffset: step.id === selectedId ? 0 : length(index),
                              transition: `stroke-dashoffset ${drawDuration}ms cubic-bezier(0.23,1,0.32,1)`,
                            }}
                          />
                        ))}
                      </svg>

                      {group.steps.map((step) => {
                        const isSelected = step.id === selectedId
                        return (
                          <button
                            key={step.id}
                            ref={(node) => {
                              if (node) rowRefs.current.set(step.id, node)
                              else rowRefs.current.delete(step.id)
                            }}
                            type="button"
                            onClick={() => setSelectedId(step.id)}
                            aria-current={isSelected ? "true" : undefined}
                            aria-label={`${step.tool}，${statusLabel(step.status)}${step.detail && step.detail !== step.tool ? `，${step.detail}` : ""}`}
                            title={step.detail !== step.tool ? step.detail : undefined}
                            className={cn(
                              "relative z-[1] flex w-full min-w-0 items-center gap-2 text-left text-[11px] transition-colors",
                              isSelected
                                ? "font-medium text-primary"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                            style={{ height: ROW_HEIGHT, paddingLeft: INDENT }}
                          >
                            <StepStatusIcon status={step.status} className="h-3 w-3" />
                            <code className="shrink-0 font-mono text-[11px]">{step.tool}</code>
                            <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/70">
                              {step.detail === step.tool ? "" : step.detail}
                            </span>
                            {step.risk ? (
                              <ShieldAlert
                                className={cn(
                                  "h-3 w-3 shrink-0",
                                  step.risk === "danger" ? "text-negative" : "text-warning",
                                )}
                              />
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  </AutoHeight>
                </section>
              )
            })}
          </nav>

          <AutoHeight duration={foldDuration}>
            {selected ? (
              <ToolStepDetail
                key={selected.id}
                step={selected}
                className={reduceMotion ? undefined : "animate-in fade-in-0 duration-300"}
                onConfirm={onConfirm}
                onDeny={onDeny}
              />
            ) : null}
          </AutoHeight>
        </div>
      </AutoHeight>
    </div>
  )
}
