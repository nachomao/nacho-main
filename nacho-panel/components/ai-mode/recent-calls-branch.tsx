"use client"

/* 最近调用分支：改编自 React Bits BranchedMenu
 * https://reactbits.dev/micro/branched-menu
 * MIT + Commons Clause，Copyright (c) 2026 David Haz。
 * 一条主干把最近的工具调用串起来；点选某次调用时描线沿主干逐段推进到它的分支，并在分支下方弹性展开命令；
 * 再点展开的命令块，它会从原位形变成贴着右栏的详情弹窗（只看命令，不含输出）。
 * 每行自带一段主干，所以展开命令撑高某一行时，主干与后续分支会自然跟随。 */

import { useEffect, useId, useRef, useState } from "react"
import { motion } from "motion/react"
import { Check, ChevronDown, Copy, Maximize2, ShieldAlert, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMotionPreference } from "@/lib/motion-preference"
import { besideRailPlacement, type MorphRect, type MorphSize, type MorphViewport } from "@/lib/morph-geometry"
import { branchTraceDelay, recentCallCommand, type RecentCall } from "@/lib/ai/recent-calls"
import { AutoHeight } from "@/components/ui/auto-height"
import { MorphPopover } from "./morph-popover"
import { StepStatusIcon, statusLabel } from "./tool-branch"
import { sourceMeta } from "./tool-source-meta"

const ROW_HEIGHT = 34
const INDENT = 40
const TRUNK = 14
const LINE = 1.5
const RADIUS = Math.min(10, ROW_HEIGHT / 2 - 2)
const BRANCH_TOP = ROW_HEIGHT / 2 - RADIUS
const END_X = INDENT - 8
const CURVE = `M ${TRUNK} ${BRANCH_TOP} A ${RADIUS} ${RADIUS} 0 0 0 ${TRUNK + RADIUS} ${ROW_HEIGHT / 2} H ${END_X}`
const CURVE_LENGTH = (Math.PI * RADIUS) / 2 + (END_X - TRUNK - RADIUS)
/** 描线每推进一行的错峰 */
const STEP_MS = 45
const SEGMENT_MS = 90
const DRAW_MS = 300
const FOLD_MS = 300
const EASE = "cubic-bezier(0.23, 1, 0.32, 1)"
const DETAIL_SPRING = { type: "spring", visualDuration: 0.36, bounce: 0.38 } as const
const DETAIL_CLASS = "block w-full rounded-lg border border-border/60 bg-background/40 px-2.5 py-2 text-left"
const DETAIL_RADIUS = 12
const POPUP_RADIUS = 20
const POPUP_WIDTH = 340

/** origin：本次选择变化前选中行的下标（没有则为 -1），描线从这里出发 */
type Selection = { key: string | null; origin: number }
type Popup = { call: RecentCall; open: boolean }
type Timing = { segment: number; draw: number; erase: number }

function CommandFace({ command }: { command: string }) {
  return (
    <>
      <span className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/70">
        <span>命令</span>
        <span className="flex items-center gap-1">
          详情
          <Maximize2 className="h-2.5 w-2.5" />
        </span>
      </span>
      <code
        className={cn(
          "mt-1 line-clamp-3 block break-all font-mono text-[10.5px] leading-relaxed",
          command ? "text-foreground/85" : "text-muted-foreground/60",
        )}
      >
        {command || "无命令参数"}
      </code>
    </>
  )
}

function RecentCallRow({
  call,
  last,
  selected,
  leadOn,
  passOn,
  delay,
  curveDelay,
  timing,
  reduceMotion,
  lifted,
  popupOpen,
  onSelect,
  onOpenPopup,
  registerDetail,
}: {
  call: RecentCall
  last: boolean
  selected: boolean
  leadOn: boolean
  passOn: boolean
  delay: number
  curveDelay: number
  timing: Timing
  reduceMotion: boolean
  lifted: boolean
  popupOpen: boolean
  onSelect: () => void
  onOpenPopup: () => void
  registerDetail: (node: HTMLButtonElement | null) => void
}) {
  const meta = sourceMeta[call.source]
  const command = recentCallCommand(call)
  const detailId = useId()
  const trunkStyle = { left: TRUNK - LINE / 2, width: LINE }
  const fill = (on: boolean) => ({
    transform: `scaleY(${on ? 1 : 0})`,
    transition: `transform ${timing.segment}ms linear ${delay}ms`,
  })

  return (
    <li className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0 bg-border"
        style={{ ...trunkStyle, height: last ? BRANCH_TOP : "100%" }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0 origin-top bg-primary"
        style={{ ...trunkStyle, height: BRANCH_TOP, ...fill(leadOn) }}
      />
      {last ? null : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 origin-top bg-primary"
          style={{ ...trunkStyle, top: BRANCH_TOP, ...fill(passOn) }}
        />
      )}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        width={INDENT}
        height={ROW_HEIGHT}
      >
        <path d={CURVE} fill="none" stroke="var(--border)" strokeWidth={LINE} strokeLinecap="round" strokeLinejoin="round" />
        <path
          d={CURVE}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={LINE}
          strokeLinecap="butt"
          strokeLinejoin="round"
          style={{
            strokeDasharray: CURVE_LENGTH,
            strokeDashoffset: selected ? 0 : CURVE_LENGTH,
            transition: `stroke-dashoffset ${selected ? timing.draw : timing.erase}ms ${EASE} ${curveDelay}ms`,
          }}
        />
      </svg>

      <button
        type="button"
        aria-expanded={selected}
        aria-controls={detailId}
        onClick={onSelect}
        title={call.tool}
        className={cn(
          "relative flex w-full min-w-0 items-center gap-2 text-left transition-colors",
          selected ? "text-primary" : "text-muted-foreground hover:text-foreground",
        )}
        style={{ height: ROW_HEIGHT, paddingLeft: INDENT }}
      >
        <StepStatusIcon status={call.status} className="h-3 w-3" />
        <code className={cn("min-w-0 flex-1 truncate font-mono text-[10.5px]", selected && "font-medium")}>{call.tool}</code>
        {call.risk ? (
          <ShieldAlert
            aria-label={call.risk === "danger" ? "危险操作" : "警告操作"}
            className={cn("h-3 w-3 shrink-0", call.risk === "danger" ? "text-negative" : "text-warning")}
          />
        ) : null}
        <span className="flex shrink-0 items-center gap-1 text-[9px] text-muted-foreground/60">
          <meta.Icon className="h-2.5 w-2.5" />
          {meta.label}
        </span>
      </button>

      <AutoHeight open={selected} duration={reduceMotion ? 0 : FOLD_MS}>
        <div id={detailId} className="pb-2 pr-0.5" style={{ paddingLeft: INDENT }}>
          <motion.div
            initial={false}
            animate={
              selected
                ? { opacity: 1, y: 0, scale: 1, transition: reduceMotion ? { duration: 0 } : DETAIL_SPRING }
                : { opacity: 0, y: -4, scale: 0.96, transition: { duration: reduceMotion ? 0 : 0.14 } }
            }
            style={{ transformOrigin: "top left" }}
          >
            <button
              ref={registerDetail}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={popupOpen}
              aria-label={`查看 ${call.tool} 的完整命令`}
              onClick={onOpenPopup}
              className={cn(
                DETAIL_CLASS,
                "transition-colors hover:border-border hover:bg-foreground/[0.05] focus-visible:border-primary/50 focus-visible:outline-none",
                lifted && "opacity-0",
              )}
            >
              <CommandFace command={command} />
            </button>
          </motion.div>
        </div>
      </AutoHeight>
    </li>
  )
}

function CallPopup({ call, titleId, onClose }: { call: RecentCall; titleId: string; onClose: () => void }) {
  const meta = sourceMeta[call.source]
  const command = recentCallCommand(call)
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle")
  const resetTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
  }, [])

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopy("done")
    } catch {
      setCopy("failed")
    }
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => {
      resetTimer.current = null
      setCopy("idle")
    }, 1_600)
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border bg-foreground/[0.03] text-muted-foreground">
          <meta.Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p id={titleId} className="truncate font-mono text-[13px] font-medium text-foreground">
            {call.tool}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <StepStatusIcon status={call.status} className="h-3 w-3" />
            {statusLabel(call.status)}
            <span aria-hidden="true" className="text-muted-foreground/40">
              ·
            </span>
            {meta.label}
            {call.risk ? (
              <span
                className={cn(
                  "rounded-md border px-1.5 py-px text-[10px]",
                  call.risk === "danger" ? "border-negative/40 text-negative" : "border-warning/40 text-warning",
                )}
              >
                {call.risk === "danger" ? "危险" : "警告"}
              </span>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div>
        <div className="flex h-6 items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">命令</span>
          {command ? (
            <button
              type="button"
              onClick={() => void copyCommand()}
              className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              {copy === "done" ? <Check className="h-3 w-3 text-positive" /> : <Copy className="h-3 w-3" />}
              <span aria-live="polite">{copy === "done" ? "已复制" : copy === "failed" ? "复制失败" : "复制"}</span>
            </button>
          ) : null}
        </div>
        <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background/60 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/90">
          {command || "该调用没有命令参数"}
        </pre>
      </div>

      <p className="truncate text-[11px] text-muted-foreground/70">来自会话「{call.sessionTitle}」</p>
    </div>
  )
}

export function RecentCallsBranch({ calls }: { calls: RecentCall[] }) {
  const { reduceMotion } = useMotionPreference()
  const [listOpen, setListOpen] = useState(true)
  const [selection, setSelection] = useState<Selection>({ key: null, origin: -1 })
  const [popup, setPopup] = useState<Popup | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const detailRefs = useRef(new Map<string, HTMLButtonElement>())
  // 右栏左缘：只在首次放置或视口宽度变化时测量，形变的每一帧都复用
  const railRef = useRef<{ viewportWidth: number; left: number } | null>(null)
  const listId = useId()
  const popupTitleId = useId()

  // 选中的调用被新调用挤出列表后视为未选中
  const selectedIndex = selection.key === null ? -1 : calls.findIndex((call) => call.key === selection.key)
  const origin = Math.max(selection.origin, 0)
  const timing: Timing = reduceMotion
    ? { segment: 0, draw: 0, erase: 0 }
    : { segment: SEGMENT_MS, draw: DRAW_MS, erase: Math.round(DRAW_MS * 0.6) }
  const liveCall = popup ? (calls.find((call) => call.key === popup.call.key) ?? popup.call) : null

  const select = (key: string) => {
    if (popup) return
    setSelection({ key: key === selection.key && selectedIndex >= 0 ? null : key, origin: selectedIndex })
  }

  const openPopup = (call: RecentCall) => {
    if (popup) return
    railRef.current = null
    setPopup({ call, open: true })
  }

  const closePopup = () => setPopup((current) => (current ? { ...current, open: false } : current))

  const placeBesideRail = (size: MorphSize, anchor: MorphRect, viewport: MorphViewport) => {
    let rail = railRef.current
    if (!rail || rail.viewportWidth !== viewport.width) {
      const aside = navRef.current?.closest("aside")
      rail = { viewportWidth: viewport.width, left: aside ? aside.getBoundingClientRect().left : anchor.left }
      railRef.current = rail
    }
    return besideRailPlacement(size, anchor, viewport, rail.left)
  }

  return (
    <>
      <nav ref={navRef} aria-label="最近调用" className="relative pl-3.5">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 top-2 w-0.5 rounded-[1px]"
          style={{ background: "linear-gradient(to bottom, var(--border) 0%, var(--border) 55%, transparent 100%)" }}
        />
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-0 top-2.5 z-[1] h-4 w-0.5 rounded-[1px] bg-primary transition-opacity duration-150",
            selectedIndex >= 0 && listOpen ? "opacity-100" : "opacity-0",
          )}
        />
        <button
          type="button"
          aria-expanded={listOpen}
          aria-controls={listId}
          onClick={() => setListOpen((value) => !value)}
          className={cn(
            "flex w-full items-center gap-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors hover:text-foreground",
            listOpen ? "text-foreground/80" : "text-muted-foreground/70",
          )}
        >
          最近调用
          {calls.length > 0 ? (
            <span className="rounded border border-border/70 px-1 font-mono text-[9px] font-normal tracking-normal text-muted-foreground">
              {calls.length}
            </span>
          ) : null}
          <ChevronDown
            className={cn("ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform", listOpen && "rotate-180")}
          />
        </button>

        <AutoHeight open={listOpen} duration={reduceMotion ? 0 : FOLD_MS}>
          {calls.length === 0 ? (
            <p id={listId} className="pb-2 text-[11px] text-muted-foreground/50">
              暂无调用记录
            </p>
          ) : (
            <ul id={listId} className="flex flex-col pb-1">
              {calls.map((call, index) => {
                const selected = index === selectedIndex
                const delay = branchTraceDelay(index, origin, STEP_MS)
                // 向下推进时，等主干先走到这一行再画分支；向上回收时分支与回收同时到位
                const curveDelay = selected && index >= selection.origin ? delay + STEP_MS : delay
                return (
                  <RecentCallRow
                    key={call.key}
                    call={call}
                    last={index === calls.length - 1}
                    selected={selected}
                    leadOn={selectedIndex >= 0 && index <= selectedIndex}
                    passOn={selectedIndex >= 0 && index < selectedIndex}
                    delay={reduceMotion ? 0 : delay}
                    curveDelay={reduceMotion || !selected ? 0 : curveDelay}
                    timing={timing}
                    reduceMotion={reduceMotion}
                    lifted={popup?.call.key === call.key}
                    popupOpen={Boolean(popup?.open && popup.call.key === call.key)}
                    onSelect={() => select(call.key)}
                    onOpenPopup={() => openPopup(call)}
                    registerDetail={(node) => {
                      if (node) detailRefs.current.set(call.key, node)
                      else detailRefs.current.delete(call.key)
                    }}
                  />
                )
              })}
            </ul>
          )}
        </AutoHeight>
      </nav>

      {popup && liveCall ? (
        <MorphPopover
          open={popup.open}
          getAnchor={() => detailRefs.current.get(popup.call.key) ?? null}
          onRequestClose={closePopup}
          onClosed={() => setPopup(null)}
          width={POPUP_WIDTH}
          gutter={12}
          place={placeBesideRail}
          fromRadius={DETAIL_RADIUS}
          toRadius={POPUP_RADIUS}
          face={
            <div className={cn(DETAIL_CLASS, "h-full w-full")}>
              <CommandFace command={recentCallCommand(popup.call)} />
            </div>
          }
          backdrop="clear"
          modal
          closeLabel="关闭调用详情"
          labelledBy={popupTitleId}
          className="border border-border text-foreground"
          fromSkinClassName="bg-background/85 backdrop-blur-xl"
          toSkinClassName="bg-card"
        >
          <CallPopup call={liveCall} titleId={popupTitleId} onClose={closePopup} />
        </MorphPopover>
      ) : null}
    </>
  )
}
