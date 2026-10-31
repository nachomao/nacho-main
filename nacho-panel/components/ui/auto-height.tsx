"use client"

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { cn } from "@/lib/utils"

const EASING = "cubic-bezier(0.23, 1, 0.32, 1)"

type AutoHeightProps = {
  /** 收起时高度为 0，内容同时变为 inert。 */
  open?: boolean
  /** 首次挂载且处于展开状态时，从 0 展开到内容高度。嵌套使用时只给最外层开启。 */
  appear?: boolean
  /** 过渡时长（毫秒）；0 表示直接跳到目标高度（削弱动画效果）。 */
  duration?: number
  className?: string
  innerClassName?: string
  children?: ReactNode
}

/**
 * 平滑高度容器：展开 / 收起、首次出现以及内容增减时，外层高度从当前值过渡到内容实际高度。
 *
 * 静止时外层保持 `height: auto`（展开）或 `0px`（收起），所以嵌套 AutoHeight 的过渡会被父级逐帧自然跟随；
 * 内容变化在 layout effect 中先钉回旧高度再过渡，ResizeObserver 只在自身过渡途中改目标，且不改变当前高度，
 * 因而不会触发 “ResizeObserver loop” 警告。
 */
export function AutoHeight({
  open = true,
  appear = false,
  duration = 300,
  className,
  innerClassName,
  children,
}: AutoHeightProps) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<Animation | null>(null)
  const contentHeightRef = useRef(0)
  const openRef = useRef(open)
  const appearRef = useRef(appear)
  const durationRef = useRef(duration)
  const readyRef = useRef(false)
  const [initialStyle] = useState<CSSProperties | undefined>(() => (open && !appear ? undefined : { height: 0 }))

  const renderedHeight = () => {
    const outer = outerRef.current
    return outer ? Number.parseFloat(getComputedStyle(outer).height) || 0 : 0
  }

  const glide = (from: number, to: number) => {
    const outer = outerRef.current
    if (!outer) return
    animationRef.current?.cancel()
    animationRef.current = null
    if (durationRef.current <= 0 || Math.abs(to - from) < 1 || typeof outer.animate !== "function") {
      outer.style.height = openRef.current ? "auto" : "0px"
      return
    }
    outer.style.height = `${to}px`
    const animation = outer.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: durationRef.current, easing: EASING },
    )
    animationRef.current = animation
    animation.onfinish = () => {
      if (animationRef.current !== animation) return
      animationRef.current = null
      outer.style.height = openRef.current ? "auto" : "0px"
    }
  }

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return
    contentHeightRef.current = inner.offsetHeight
    if (openRef.current && appearRef.current) glide(0, contentHeightRef.current)
    else outer.style.height = openRef.current ? "auto" : "0px"
    readyRef.current = true

    const observer = new ResizeObserver(() => {
      const height = inner.offsetHeight
      if (Math.abs(height - contentHeightRef.current) < 1) return
      contentHeightRef.current = height
      if (openRef.current && animationRef.current) glide(renderedHeight(), height)
    })
    observer.observe(inner)
    return () => {
      observer.disconnect()
      animationRef.current?.cancel()
      animationRef.current = null
      readyRef.current = false
    }
  }, [])

  useLayoutEffect(() => {
    durationRef.current = duration
  }, [duration])

  useLayoutEffect(() => {
    if (openRef.current === open) return
    openRef.current = open
    const inner = innerRef.current
    if (!inner || !readyRef.current) return
    const from = renderedHeight()
    contentHeightRef.current = inner.offsetHeight
    glide(from, open ? contentHeightRef.current : 0)
  }, [open])

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner || !readyRef.current) return
    const height = inner.offsetHeight
    const previous = contentHeightRef.current
    if (Math.abs(height - previous) < 1) return
    contentHeightRef.current = height
    if (!openRef.current) return
    glide(animationRef.current ? renderedHeight() : previous, height)
  })

  return (
    <div ref={outerRef} className={cn("overflow-clip", className)} style={initialStyle}>
      <div ref={innerRef} className={cn("flow-root", innerClassName)} inert={!open}>
        {children}
      </div>
    </div>
  )
}
