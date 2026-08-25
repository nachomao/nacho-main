"use client"

import { useEffect, useState, type ReactElement } from "react"
import { ContextMenu } from "@base-ui/react/context-menu"
import { Menu } from "@base-ui/react/menu"
import { Check, EllipsisVertical, Leaf, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { processActionRestrictionText, processTerminationRestrictionText, type WindowsProcessItem } from "@/lib/windows-process-inventory"

export type ProcessMenuAction = "terminate" | "restart" | "efficiency"
export type ProcessMenuActionOptions = {
  enabled?: boolean
  confirmedByMenu?: boolean
}

type Props = {
  process: WindowsProcessItem
  supported: boolean
  busyAction: ProcessMenuAction | null
  onAction: (action: ProcessMenuAction, options?: ProcessMenuActionOptions) => void
}

const popupCls = "z-[100] min-w-64 origin-[var(--transform-origin)] rounded-xl border border-border bg-background/98 p-1.5 text-sm text-foreground shadow-2xl outline-none backdrop-blur will-change-[transform,translate,scale,opacity,filter] transition-[transform,translate,scale,opacity,filter] duration-[380ms] ease-[cubic-bezier(0.16,1.18,0.3,1)] data-starting-style:translate-y-2 data-starting-style:scale-[0.86] data-starting-style:opacity-0 data-starting-style:blur-[5px] data-ending-style:translate-y-1 data-ending-style:scale-[0.96] data-ending-style:opacity-0 data-ending-style:blur-[2px] data-ending-style:duration-150 data-ending-style:ease-[cubic-bezier(0.4,0,1,1)] motion-reduce:transition-none motion-reduce:data-starting-style:translate-y-0 motion-reduce:data-starting-style:scale-100 motion-reduce:data-starting-style:blur-none motion-reduce:data-ending-style:translate-y-0 motion-reduce:data-ending-style:scale-100 motion-reduce:data-ending-style:blur-none"
const itemCls = "flex min-h-10 cursor-default items-center gap-3 rounded-lg px-3 py-2 outline-none data-highlighted:bg-primary/10 data-disabled:opacity-45"
const actionMorphDurationMs = 1000

type ConfirmableProcessAction = Extract<ProcessMenuAction, "terminate" | "restart">
type ActionPhase = "idle" | "morphing" | "armed"

function Header({ process, supported }: Pick<Props, "process" | "supported">) {
  return <div className="px-3 py-2"><p className="truncate font-mono text-xs font-semibold">{process.processName}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">PID {process.processId}</p>{!supported && <p className="mt-1 text-[11px] text-warning">需要 Agent 1.1.20 或更高版本</p>}</div>
}

function ItemLabel({ title, reason }: { title: string; reason: string | null }) {
  return <span className="min-w-0"><span className="block font-medium">{title}</span>{reason && <span className="mt-0.5 block break-words text-[11px] text-muted-foreground">{reason}</span>}</span>
}

function BusyIcon({ active, icon }: { active: boolean; icon: ReactElement }) {
  return active ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : icon
}

function useProcessActionConfirmation(onConfirm: (action: ConfirmableProcessAction) => void) {
  const [activeAction, setActiveAction] = useState<ConfirmableProcessAction | null>(null)
  const [phase, setPhase] = useState<ActionPhase>("idle")
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    if (phase !== "morphing") return
    const timer = window.setTimeout(() => setPhase("armed"), reducedMotion ? 0 : actionMorphDurationMs)
    return () => window.clearTimeout(timer)
  }, [phase, reducedMotion])

  function activate(action: ConfirmableProcessAction) {
    if (activeAction !== action) {
      setActiveAction(action)
      setPhase("morphing")
    } else if (phase === "armed") {
      onConfirm(action)
    }
  }

  function stateFor(action: ConfirmableProcessAction) {
    const active = activeAction === action
    return {
      activate: () => activate(action),
      morphed: active,
      ready: active && phase === "armed",
      reducedMotion,
    }
  }

  return { stateFor }
}

function WarningIconPaths({ morphed, reducedMotion }: { morphed: boolean; reducedMotion: boolean }) {
  return <>
    <path
      d="M12 3 22 20H2Z"
      pathLength="1"
      strokeDasharray="1"
      style={{
        strokeDashoffset: morphed ? 0 : 1,
        transition: reducedMotion ? "none" : morphed
          ? "stroke-dashoffset 420ms cubic-bezier(0.22,1,0.36,1) 430ms"
          : "none",
      }}
    />
    <path
      d="M12 9v5"
      pathLength="1"
      strokeDasharray="1"
      style={{
        strokeDashoffset: morphed ? 0 : 1,
        transition: reducedMotion ? "none" : morphed
          ? "stroke-dashoffset 160ms cubic-bezier(0.22,1,0.36,1) 790ms"
          : "none",
      }}
    />
    <path
      d="M12 18h.01"
      pathLength="1"
      strokeDasharray="1"
      style={{
        strokeDashoffset: morphed ? 0 : 1,
        transition: reducedMotion ? "none" : morphed
          ? "stroke-dashoffset 100ms ease-out 900ms"
          : "none",
      }}
    />
  </>
}

function AnimatedActionIcon({ action, busy, morphed, reducedMotion }: { action: ConfirmableProcessAction; busy: boolean; morphed: boolean; reducedMotion: boolean }) {
  if (busy) return <Loader2 className="h-4 w-4 shrink-0 animate-spin" />

  return (
    <span className="relative h-4 w-4 shrink-0" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute inset-0 h-4 w-4">
        {action === "terminate" ? <>
          <circle
            cx="12"
            cy="12"
            r="10"
            pathLength="1"
            strokeDasharray="1"
            style={{
              strokeDashoffset: morphed ? 1 : 0,
              opacity: morphed ? 0 : 1,
              transition: reducedMotion ? "none" : morphed
                ? "stroke-dashoffset 240ms cubic-bezier(0.4,0,0.2,1), opacity 1ms linear 240ms"
                : "none",
            }}
          />
          <rect
            x="9"
            y="9"
            width="6"
            height="6"
            rx="1"
            pathLength="1"
            strokeDasharray="1"
            style={{
              strokeDashoffset: morphed ? 1 : 0,
              opacity: morphed ? 0 : 1,
              transition: reducedMotion ? "none" : morphed
                ? "stroke-dashoffset 200ms cubic-bezier(0.4,0,0.2,1) 210ms, opacity 1ms linear 410ms"
                : "none",
            }}
          />
        </> : <>
          <path
            d="M21 3v5h-5"
            pathLength="1"
            strokeDasharray="1"
            style={{
              strokeDashoffset: morphed ? 1 : 0,
              opacity: morphed ? 0 : 1,
              transition: reducedMotion ? "none" : morphed
                ? "stroke-dashoffset 180ms cubic-bezier(0.4,0,0.2,1), opacity 1ms linear 180ms"
                : "none",
            }}
          />
          <path
            d="M21 12a9 9 0 1 1-2.64-6.36L21 8"
            pathLength="1"
            strokeDasharray="1"
            style={{
              strokeDashoffset: morphed ? 1 : 0,
              opacity: morphed ? 0 : 1,
              transition: reducedMotion ? "none" : morphed
                ? "stroke-dashoffset 260ms cubic-bezier(0.4,0,0.2,1) 150ms, opacity 1ms linear 410ms"
                : "none",
            }}
          />
        </>}
      </svg>

      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute inset-0 h-4 w-4 text-warning">
        <WarningIconPaths morphed={morphed} reducedMotion={reducedMotion} />
      </svg>
    </span>
  )
}

function ConfirmableItemContent({ action, busy, morphed, reason, reducedMotion }: { action: ConfirmableProcessAction; busy: boolean; morphed: boolean; reason: string | null; reducedMotion: boolean }) {
  const idleLabel = action === "terminate" ? "终止进程" : "重启进程"
  const confirmLabel = action === "terminate" ? "确认终止" : "确认重启"
  const label = morphed ? confirmLabel : idleLabel
  return <>
    <AnimatedActionIcon action={action} busy={busy} morphed={morphed} reducedMotion={reducedMotion} />
    <span className="min-w-0">
      <span className="relative grid min-w-16" aria-live="polite">
        <span
          aria-hidden="true"
          className="col-start-1 row-start-1 block font-medium motion-reduce:transition-none"
          style={{
            opacity: morphed ? 0 : 1,
            filter: morphed ? "blur(6px)" : "blur(0)",
            transform: morphed ? "translateY(-3px)" : "translateY(0)",
            transition: reducedMotion ? "none" : morphed ? "opacity 220ms ease-in, filter 260ms ease-in, transform 260ms ease-in" : "none",
          }}
        >{idleLabel}</span>
        <span
          aria-hidden="true"
          className="col-start-1 row-start-1 block font-medium motion-reduce:transition-none"
          style={{
            opacity: morphed ? 1 : 0,
            filter: morphed ? "blur(0)" : "blur(7px)",
            transform: morphed ? "translateY(0)" : "translateY(3px)",
            transition: reducedMotion ? "none" : morphed
              ? "opacity 300ms ease-out 460ms, filter 340ms ease-out 460ms, transform 340ms cubic-bezier(0.22,1,0.36,1) 460ms"
              : "none",
          }}
        >{confirmLabel}</span>
        <span className="sr-only">{label}</span>
      </span>
      {reason && <span className="mt-0.5 block break-words text-[11px] text-muted-foreground">{reason}</span>}
    </span>
  </>
}

function ContextItems({ process, supported, busyAction, onAction }: Props) {
  const terminateReason = !supported ? "需要 Agent 1.1.20" : processTerminationRestrictionText(process)
  const restartReason = !supported ? "需要 Agent 1.1.20" : processActionRestrictionText(process.restartRestriction)
  const efficiencyReason = !supported ? "需要 Agent 1.1.20" : processActionRestrictionText(process.efficiencyRestriction)
  const busy = busyAction !== null
  const confirmation = useProcessActionConfirmation((action) => onAction(action, { confirmedByMenu: true }))
  const terminate = confirmation.stateFor("terminate")
  const restart = confirmation.stateFor("restart")
  return <>
    <Header process={process} supported={supported} />
    <ContextMenu.Separator className="mx-1 my-1 h-px bg-border" />
    <ContextMenu.Item label={terminate.morphed ? "确认终止" : "终止进程"} closeOnClick={terminate.ready} className={cn(itemCls, "text-negative")} disabled={busy || Boolean(terminateReason)} onClick={terminate.activate}><ConfirmableItemContent action="terminate" busy={busyAction === "terminate"} morphed={terminate.morphed} reason={terminateReason} reducedMotion={terminate.reducedMotion} /></ContextMenu.Item>
    <ContextMenu.Item label={restart.morphed ? "确认重启" : "重启进程"} closeOnClick={restart.ready} className={itemCls} disabled={busy || Boolean(restartReason)} onClick={restart.activate}><ConfirmableItemContent action="restart" busy={busyAction === "restart"} morphed={restart.morphed} reason={restartReason} reducedMotion={restart.reducedMotion} /></ContextMenu.Item>
    <ContextMenu.Separator className="mx-1 my-1 h-px bg-border" />
    <ContextMenu.CheckboxItem className={itemCls} checked={process.efficiencyMode === true} disabled={busy || Boolean(efficiencyReason)} closeOnClick onCheckedChange={(checked) => onAction("efficiency", { enabled: checked })}><BusyIcon active={busyAction === "efficiency"} icon={<Leaf className="h-4 w-4 shrink-0 text-positive" />} /><ItemLabel title="效能模式" reason={efficiencyReason} /><span className="ml-auto flex h-4 w-4 items-center justify-center">{process.efficiencyMode && <Check className="h-4 w-4" />}</span></ContextMenu.CheckboxItem>
  </>
}

function MobileItems(props: Props) {
  const { process, supported, busyAction, onAction } = props
  const busy = busyAction !== null
  const terminateReason = !supported ? "需要 Agent 1.1.20" : processTerminationRestrictionText(process)
  const restartReason = !supported ? "需要 Agent 1.1.20" : processActionRestrictionText(process.restartRestriction)
  const efficiencyReason = !supported ? "需要 Agent 1.1.20" : processActionRestrictionText(process.efficiencyRestriction)
  const confirmation = useProcessActionConfirmation((action) => onAction(action, { confirmedByMenu: true }))
  const terminate = confirmation.stateFor("terminate")
  const restart = confirmation.stateFor("restart")
  return <>
    <Header process={process} supported={supported} />
    <Menu.Separator className="mx-1 my-1 h-px bg-border" />
    <Menu.Item label={terminate.morphed ? "确认终止" : "终止进程"} closeOnClick={terminate.ready} className={cn(itemCls, "text-negative")} disabled={busy || Boolean(terminateReason)} onClick={terminate.activate}><ConfirmableItemContent action="terminate" busy={busyAction === "terminate"} morphed={terminate.morphed} reason={terminateReason} reducedMotion={terminate.reducedMotion} /></Menu.Item>
    <Menu.Item label={restart.morphed ? "确认重启" : "重启进程"} closeOnClick={restart.ready} className={itemCls} disabled={busy || Boolean(restartReason)} onClick={restart.activate}><ConfirmableItemContent action="restart" busy={busyAction === "restart"} morphed={restart.morphed} reason={restartReason} reducedMotion={restart.reducedMotion} /></Menu.Item>
    <Menu.Separator className="mx-1 my-1 h-px bg-border" />
    <Menu.CheckboxItem className={itemCls} checked={process.efficiencyMode === true} disabled={busy || Boolean(efficiencyReason)} closeOnClick onCheckedChange={(checked) => onAction("efficiency", { enabled: checked })}><BusyIcon active={busyAction === "efficiency"} icon={<Leaf className="h-4 w-4 shrink-0 text-positive" />} /><ItemLabel title="效能模式" reason={efficiencyReason} /><span className="ml-auto">{process.efficiencyMode && <Check className="h-4 w-4" />}</span></Menu.CheckboxItem>
  </>
}

export function ProcessRowContextMenu({ trigger, ...props }: Props & { trigger: ReactElement }) {
  return <ContextMenu.Root><ContextMenu.Trigger render={trigger} /><ContextMenu.Portal><ContextMenu.Positioner className="z-[100] outline-none"><ContextMenu.Popup className={popupCls}><ContextItems {...props} /></ContextMenu.Popup></ContextMenu.Positioner></ContextMenu.Portal></ContextMenu.Root>
}

export function ProcessMobileMenu(props: Props) {
  return <Menu.Root><Menu.Trigger aria-label={`进程操作 ${props.process.processName} PID ${props.process.processId}`} onClick={(event) => event.stopPropagation()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted"><EllipsisVertical className="h-4 w-4" /></Menu.Trigger><Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="z-[100] outline-none"><Menu.Popup className={popupCls}><MobileItems {...props} /></Menu.Popup></Menu.Positioner></Menu.Portal></Menu.Root>
}
