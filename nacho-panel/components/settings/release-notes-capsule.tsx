"use client"

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import { ChevronDown, FileText } from "lucide-react"
import { ProgressiveBlur } from "@/components/ui/progressive-blur"
import { holdForegroundMotion } from "@/lib/foreground-motion"
import { cn } from "@/lib/utils"

/** 与 duration-500 保持一致；收起期间仍需保持抬升层级，结束后再回落。 */
const MOTION_MS = 500
const MOTION = "duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"

/**
 * 更新说明胶囊：以原位置为中心向上下两侧展开并浮于卡片内容之上，
 * 即将被遮挡的文字边缘与正文滚动边缘均做渐进式模糊。
 */
export function ReleaseNotesCapsule({ title, notes }: { title?: string; notes?: string }) {
  const [open, setOpen] = useState(false)
  const [edges, setEdges] = useState({ top: false, bottom: false })
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const regionId = useId()
  const body = notes || title

  const setExpanded = useCallback((next: boolean) => {
    // 让背景 WebGL 光晕在过渡期间让出帧预算，避免展开动画掉帧；超时后自动释放。
    holdForegroundMotion(MOTION_MS + 60)
    setOpen(next)
  }, [])

  const syncEdges = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const top = element.scrollTop > 1
    const bottom = element.scrollTop + element.clientHeight < element.scrollHeight - 1
    setEdges((current) => current.top === top && current.bottom === bottom ? current : { top, bottom })
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    syncEdges()
    const observer = new ResizeObserver(syncEdges)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [body, syncEdges])

  useEffect(() => {
    if (!open) return
    const collapseOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setExpanded(false)
    }
    document.addEventListener("pointerdown", collapseOnOutsidePointer)
    return () => document.removeEventListener("pointerdown", collapseOnOutsidePointer)
  }, [open, setExpanded])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !open) return
    event.stopPropagation()
    setExpanded(false)
    toggleRef.current?.focus()
  }

  return (
    <div
      ref={rootRef}
      onKeyDown={handleKeyDown}
      className={cn("relative h-10 text-xs", open ? "z-20" : "z-0")}
      style={{ transition: `z-index 0s linear ${open ? 0 : MOTION_MS}ms` }}
    >
      {/* 胶囊高度超出占位时，flex 居中会让溢出在上下两侧等分，从而实现以原位置为中心的双向展开 */}
      <div className="absolute inset-0 flex items-center">
        <div className="relative w-full">
          {/* card-glow 实际呈现为近黑玻璃，色调取 --background 才不会在卡片上显出灰色矩形 */}
          <ProgressiveBlur strongEdge="bottom" visible={open} tint="var(--background)" className="bottom-full h-8" />
          <ProgressiveBlur strongEdge="top" visible={open} tint="var(--background)" className="top-full h-8" />

          <div
            className={cn(
              "overflow-hidden rounded-2xl ring-1 backdrop-blur-xl transition-[background-color,box-shadow]",
              MOTION,
              open
                ? "bg-surface/90 shadow-2xl ring-foreground/12"
                : "bg-surface/30 ring-border",
            )}
          >
            <button
              ref={toggleRef}
              type="button"
              aria-expanded={open}
              aria-controls={regionId}
              onClick={() => setExpanded(!open)}
              className="flex h-10 w-full items-center gap-2.5 px-3.5 text-left transition-colors hover:bg-surface/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60"
            >
              <FileText aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={title}>
                <span className="font-medium text-foreground">更新说明</span>
                {title && <span className="text-muted-foreground"> · {title}</span>}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn("size-4 shrink-0 text-muted-foreground transition-transform", MOTION, open && "rotate-180")}
              />
            </button>

            <div
              id={regionId}
              role="region"
              aria-label="更新说明正文"
              inert={!open}
              className={cn("grid transition-[grid-template-rows]", MOTION, open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="relative border-t border-border">
                  <div
                    ref={scrollRef}
                    onScroll={syncEdges}
                    className={cn(
                      "max-h-36 overflow-y-auto overscroll-contain px-3.5 py-3 transition-opacity",
                      MOTION,
                      open ? "opacity-100" : "opacity-0",
                    )}
                  >
                    <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground text-pretty">{body}</p>
                  </div>
                  <ProgressiveBlur strongEdge="top" visible={open && edges.top} tint="var(--surface)" className="top-0 h-6" />
                  <ProgressiveBlur strongEdge="bottom" visible={open && edges.bottom} tint="var(--surface)" className="bottom-0 h-6" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
