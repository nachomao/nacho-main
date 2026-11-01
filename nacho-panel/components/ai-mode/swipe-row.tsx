"use client"

/* 左滑操作行：改编自 React Bits SwipeRow
 * https://reactbits.dev/micro/swipe-row
 * MIT + Commons Clause，Copyright (c) 2026 David Haz。
 * 收敛为单个主操作：左滑露出操作键，越过提交点松手直接执行；执行时操作块铺满整行，随后整行收起高度再交给调用方移除。
 * 只有真正横向拖动后才捕获指针，轻点仍是普通点击；拖动结束或点按收起抽屉时产生的那次点击会被吞掉。 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import { animate, motion, useMotionValue, useTransform } from "motion/react"
import { cn } from "@/lib/utils"
import { useMotionPreference } from "@/lib/motion-preference"
import {
  SWIPE_FLICK,
  SWIPE_HYSTERESIS,
  SWIPE_VMAX,
  canSwipeCommit,
  releaseVelocity,
  swipeCommitPoint,
  swipeExposure,
  swipeRaw,
  swipeReleaseTarget,
  type SwipeGeometry,
  type SwipeSample,
} from "@/lib/swipe-row-physics"

const RESISTANCE = 0.55
const COMMIT_AT = 0.6
const SNAP_BOUNCE = 0.2
const COLLAPSE_MS = 220
/** 松手后这段时间内到达的 click 视为拖动 / 收起抽屉的副产物 */
const CLICK_GUARD_MS = 400
const EASE_OUT = [0.23, 1, 0.32, 1] as const
const SPRING_UI = { type: "spring", duration: 0.3, bounce: 0 } as const

type Phase = "idle" | "committing" | "collapsing"
type Grip = { id: number; x0: number; y0: number; grab: number | null; moved: boolean; hist: SwipeSample[]; touch: boolean }
type Live = { move: (event: PointerEvent) => void; up: (event: PointerEvent) => void }

function watchWindow(live: { current: Live }) {
  const onMove = (event: PointerEvent) => {
    if (event.isTrusted) live.current.move(event)
  }
  const onUp = (event: PointerEvent) => {
    if (event.isTrusted) live.current.up(event)
  }
  window.addEventListener("pointermove", onMove)
  window.addEventListener("pointerup", onUp)
  window.addEventListener("pointercancel", onUp)
  return () => {
    window.removeEventListener("pointermove", onMove)
    window.removeEventListener("pointerup", onUp)
    window.removeEventListener("pointercancel", onUp)
  }
}

export type SwipeRowAction = { label: string; icon: ReactNode }

type SwipeRowProps = {
  children: ReactNode
  action: SwipeRowAction
  /** 整行收起后调用；返回 false 或抛错时整行恢复原状 */
  onCommit: () => unknown
  label: string
  height: number
  actionWidth?: number
  /** 禁止拖动与执行操作，行内容仍可点击 */
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  /** 圆角容器：承载边框、底色与悬停态，内容与操作块都裁剪在里面 */
  frameClassName?: string
}

export function SwipeRow({
  children,
  action,
  onCommit,
  label,
  height,
  actionWidth = 72,
  disabled = false,
  open: openProp,
  onOpenChange,
  className,
  frameClassName,
}: SwipeRowProps) {
  const { reduceMotion } = useMotionPreference()
  const A = actionWidth
  const [openState, setOpenState] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [say, setSay] = useState("")
  const open = openProp ?? openState

  const root = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const rowWidth = useRef(240)
  const grip = useRef<Grip | null>(null)
  const unwatch = useRef<(() => void) | null>(null)
  const live = useRef<Live>({ move: () => {}, up: () => {} })
  const foldTimer = useRef<number | undefined>(undefined)
  const heading = useRef<number | null>(null)
  const spreadOn = useRef(false)
  const releaseClickGuard = useRef<(() => void) | null>(null)
  const latest = useRef({ onCommit, onOpenChange })
  latest.current = { onCommit, onOpenChange }

  // x 为内容层位移（左滑为负）；exposed 为露出宽度
  const x = useMotionValue(0)
  const spread = useMotionValue(0)
  const landed = useMotionValue(0)
  const exposed = useTransform(x, (value: number) => -value)
  const surfaceTransform = useTransform(x, (value: number) => `translateX(${value}px)`)
  const railTransform = useTransform(exposed, (value: number) => `translateX(${Math.max(0, A - value)}px)`)
  const shift = useTransform([exposed, spread], ([value, amount]: number[]) => amount * Math.max(0, value - A))
  const blockTransform = useTransform(shift, (value: number) => `translateX(${-value}px)`)
  const glyphTransform = useTransform(
    [shift, landed],
    ([value, amount]: number[]) => `translateX(${amount * (value - (rowWidth.current - A) / 2)}px)`,
  )

  const geometry = (): SwipeGeometry => ({
    width: rowWidth.current,
    actionWidth: A,
    resistance: RESISTANCE,
    commitAt: COMMIT_AT,
  })
  const commitReady = (value: number) => canSwipeCommit(geometry()) && value >= swipeCommitPoint(geometry())

  useLayoutEffect(() => {
    const node = root.current
    if (!node) return undefined
    rowWidth.current = node.offsetWidth || rowWidth.current
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) rowWidth.current = width
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(
    () => () => {
      window.clearTimeout(foldTimer.current)
      unwatch.current?.()
      releaseClickGuard.current?.()
    },
    [],
  )

  const setOpen = (next: boolean) => {
    if (next === open) return
    setOpenState(next)
    latest.current.onOpenChange?.(next)
  }

  const settle = (target: number, velocity = 0) => {
    heading.current = target
    if (reduceMotion) {
      animate(x, -target, { duration: 0.16, ease: EASE_OUT })
      return
    }
    const flick = Math.abs(velocity) >= SWIPE_FLICK
    animate(
      x,
      -target,
      flick
        ? { type: "spring", duration: 0.4, bounce: SNAP_BOUNCE, velocity: -Math.min(SWIPE_VMAX, Math.max(-SWIPE_VMAX, velocity)) }
        : { ...SPRING_UI, velocity: -velocity },
    )
  }

  const setSpread = (on: boolean) => {
    if (spreadOn.current === on) return
    spreadOn.current = on
    if (reduceMotion) spread.set(on ? 1 : 0)
    else animate(spread, on ? 1 : 0, SPRING_UI)
    if (on) {
      setSay(`松手即${action.label}`)
      if (grip.current?.touch) navigator.vibrate?.(8)
    }
  }

  /** 吞掉紧随其后的那次 click，避免拖动或收起抽屉时误触行内按钮 */
  const guardClick = () => {
    const node = root.current
    if (!node) return
    releaseClickGuard.current?.()
    let timer = 0
    function release() {
      window.clearTimeout(timer)
      node?.removeEventListener("click", swallow, true)
      if (releaseClickGuard.current === release) releaseClickGuard.current = null
    }
    function swallow(event: MouseEvent) {
      event.preventDefault()
      event.stopPropagation()
      release()
    }
    node.addEventListener("click", swallow, true)
    timer = window.setTimeout(release, CLICK_GUARD_MS)
    releaseClickGuard.current = release
  }

  const restore = () => {
    heading.current = 0
    spreadOn.current = false
    spread.set(0)
    landed.set(0)
    x.set(0)
    setSay("")
    setPhase("idle")
  }

  const commit = (viaKey: boolean, velocity = 0) => {
    setPhase("committing")
    setSay(action.label)
    setOpen(false)
    spreadOn.current = true
    const fold = () => {
      setPhase("collapsing")
      foldTimer.current = window.setTimeout(
        () => {
          Promise.resolve()
            .then(() => latest.current.onCommit())
            .then((result) => {
              if (result === false) restore()
            }, restore)
        },
        reduceMotion ? 0 : COLLAPSE_MS,
      )
    }
    if (viaKey || reduceMotion) {
      spread.set(1)
      landed.set(1)
      if (viaKey) {
        x.set(-rowWidth.current)
        fold()
      } else {
        void animate(x, -rowWidth.current, { duration: 0.2, ease: EASE_OUT }).then(fold)
      }
      return
    }
    if (spread.get() < 1) animate(spread, 1, SPRING_UI)
    animate(landed, 1, SPRING_UI)
    void animate(x, -rowWidth.current, { ...SPRING_UI, velocity: -velocity }).then(fold)
  }

  // 受控开合：外部切换 open 时滑到对应位置；拖动中或执行中不打断
  useEffect(() => {
    if (openProp === undefined || grip.current || phase !== "idle") return
    const target = open ? A : 0
    if (heading.current === target) return
    if (Math.abs(exposed.get() - target) > 0.5) settle(target)
    // settle 只读写 motion value；仅响应开合变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, A])

  // 抽屉打开时点按行外任意位置即收起
  useEffect(() => {
    if (!open || phase !== "idle") return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return
      setOpen(false)
      settle(0)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => document.removeEventListener("pointerdown", onPointerDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase])

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || phase !== "idle" || grip.current || event.button !== 0) return
    releaseClickGuard.current?.()
    x.stop()
    heading.current = null
    grip.current = {
      id: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      grab: null,
      moved: false,
      hist: [],
      touch: event.pointerType === "touch",
    }
    unwatch.current?.()
    unwatch.current = watchWindow(live)
  }

  const move = (event: PointerEvent) => {
    const g = grip.current
    if (!g || g.id !== event.pointerId) return
    if (g.grab === null) {
      const dx = event.clientX - g.x0
      const dy = event.clientY - g.y0
      if (Math.abs(dx) < SWIPE_HYSTERESIS || Math.abs(dx) < Math.abs(dy)) return
      // 从当前露出宽度接着拖：把它换算回手指位移，起手不跳
      g.grab = -(g.x0 + Math.sign(dx) * SWIPE_HYSTERESIS) - swipeRaw(exposed.get(), geometry())
      g.moved = true
      root.current?.setAttribute("data-dragging", "")
      try {
        surface.current?.setPointerCapture(g.id)
      } catch {
        // 指针已释放时无法捕获，窗口级监听仍会收到后续事件
      }
    }
    const value = swipeExposure(-event.clientX - g.grab, geometry())
    x.set(-value)
    g.hist.push([performance.now(), value])
    if (g.hist.length > 4) g.hist.shift()
    setSpread(commitReady(value))
  }

  const up = (event: PointerEvent) => {
    const g = grip.current
    if (!g || g.id !== event.pointerId) return
    grip.current = null
    unwatch.current?.()
    unwatch.current = null
    root.current?.removeAttribute("data-dragging")
    try {
      surface.current?.releasePointerCapture(event.pointerId)
    } catch {
      // 未捕获过指针
    }
    const value = exposed.get()
    if (!g.moved) {
      if (open) {
        guardClick()
        setOpen(false)
        settle(0)
      } else if (Math.abs(value) > 0.5) {
        settle(0)
      }
      return
    }
    guardClick()
    const velocity = releaseVelocity(g.hist)
    if (commitReady(value)) {
      commit(false, velocity)
      return
    }
    const target = swipeReleaseTarget(value, velocity, A)
    setSpread(false)
    setOpen(target === A)
    settle(target, velocity)
  }
  live.current = { move, up }

  const act = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (phase !== "idle" || disabled) return
    commit(event.detail === 0)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing || !open || phase !== "idle") return
    // 只收起抽屉，不让 Esc 继续冒泡去退出 AI Mode
    event.preventDefault()
    event.stopPropagation()
    if (surface.current && !surface.current.contains(document.activeElement)) {
      surface.current.querySelector<HTMLElement>("button")?.focus({ preventScroll: true })
    }
    setOpen(false)
    settle(0)
  }

  return (
    <div
      ref={root}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      data-open={open ? "" : undefined}
      data-phase={phase}
      className={cn(
        "group/swipe relative overflow-hidden transition-[height,margin,opacity] ease-[cubic-bezier(0.23,1,0.32,1)] data-[phase=collapsing]:mb-0! data-[phase=collapsing]:h-0! data-[phase=collapsing]:opacity-0",
        className,
      )}
      style={{ height, transitionDuration: `${reduceMotion ? 0 : COLLAPSE_MS}ms` }}
    >
      <div className={cn("relative h-full overflow-hidden", frameClassName)}>
        <motion.div
          ref={surface}
          className="relative z-[1] flex h-full touch-pan-y items-center group-data-[dragging]/swipe:cursor-grabbing group-data-[dragging]/swipe:select-none group-data-[dragging]/swipe:[&_*]:cursor-grabbing"
          style={{ transform: surfaceTransform }}
          onPointerDown={down}
        >
          {children}
        </motion.div>
        {/* 操作层在 DOM 中排在内容之后，Tab 顺序为：行内容 → 行内按钮 → 操作键；层叠由内容层 z-[1] 保证 */}
        <motion.div
          className="absolute inset-0"
          style={{ transform: railTransform }}
          inert={!open}
          aria-hidden={!open}
        >
          <motion.div
            className="absolute top-0 h-full w-full bg-negative"
            style={{ left: `calc(100% - ${A}px)`, transform: blockTransform }}
          >
            <motion.button
              type="button"
              onClick={act}
              tabIndex={open ? 0 : -1}
              className="absolute left-0 top-0 grid h-full place-items-center text-foreground outline-none after:pointer-events-none after:absolute after:inset-0 after:bg-foreground after:opacity-0 after:transition-opacity after:content-[''] hover:after:opacity-10 focus-visible:after:opacity-15"
              style={{ width: A, transform: glyphTransform }}
            >
              <span className="grid justify-items-center gap-1 text-[11px] font-medium leading-none">
                {action.icon}
                <span>{action.label}</span>
              </span>
            </motion.button>
          </motion.div>
        </motion.div>
      </div>
      <span className="sr-only" aria-live="polite">
        {say}
      </span>
    </div>
  )
}
