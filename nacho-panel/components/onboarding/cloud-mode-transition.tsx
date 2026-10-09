"use client"

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"

/** 为设置卡片提供确定的高度过渡，内容淡入沿用首次引导的 cloud-mode 样式。 */
export function CloudModeTransition({ mode, children }: { mode: "deploy" | "connect"; children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()

  useLayoutEffect(() => {
    const content = container.current?.querySelector<HTMLElement>('[data-active="true"] .cloud-mode-content')
    if (!content) return
    // offsetHeight 不包含淡入过程中的 scale，避免观察缩放导致高度反复跳动。
    const measure = () => setHeight(content.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [mode])

  return <div ref={container} className="cloud-mode-transition" style={{ height }}>{children}</div>
}
