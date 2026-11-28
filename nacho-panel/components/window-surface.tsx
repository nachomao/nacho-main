"use client"

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"

/** 缩放方向与主进程 window:resize-begin 约定一致 */
type ResizeEdge = "top" | "right" | "bottom" | "left"

/** 四条边 + 四个角，位置与光标由 globals.css 的 .window-resize-* 定义 */
const RESIZE_HANDLES: { key: string; edges: ResizeEdge[] }[] = [
  { key: "top", edges: ["top"] },
  { key: "right", edges: ["right"] },
  { key: "bottom", edges: ["bottom"] },
  { key: "left", edges: ["left"] },
  { key: "top-left", edges: ["top", "left"] },
  { key: "top-right", edges: ["top", "right"] },
  { key: "bottom-right", edges: ["bottom", "right"] },
  { key: "bottom-left", edges: ["bottom", "left"] },
]

/**
 * 桌面壳窗口外形：Electron 窗口本身透明，这里用大圆角裁切出 iOS 风格四角。
 * - data-desktop-shell 由 layout 服务端按 UA 判定，浏览器预览保持直角铺满视口；
 * - data-window-maximized 跟随桌面壳最大化状态，最大化时改回直角，避免四角露出桌面；
 * - 透明窗口没有 Windows 原生缩放边框，边缘手柄把拖动位移交给主进程换算窗口边界。
 */
export function WindowSurface({ children }: { children: ReactNode }) {
  const [desktopShell, setDesktopShell] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const dragRef = useRef<{ edges: ResizeEdge[]; startX: number; startY: number; pointerId: number } | null>(null)

  useEffect(() => {
    const bridge = window.nachoWindow
    if (!bridge) return
    setDesktopShell(true)

    const root = document.documentElement
    const apply = (value: boolean) => {
      setMaximized(value)
      if (value) root.setAttribute("data-window-maximized", "")
      else root.removeAttribute("data-window-maximized")
    }

    let active = true
    Promise.resolve(bridge.isMaximized?.())
      .then((value) => {
        if (active && typeof value === "boolean") apply(value)
      })
      .catch(() => {})

    const unsubscribe = bridge.onMaximizedChange?.(apply)
    return () => {
      active = false
      if (typeof unsubscribe === "function") unsubscribe()
    }
  }, [])

  const startResize = useCallback((edges: ResizeEdge[]) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const bridge = window.nachoWindow
    if (!bridge?.beginResize || event.button !== 0) return
    dragRef.current = { edges, startX: event.screenX, startY: event.screenY, pointerId: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
    bridge.beginResize(edges)
  }, [])

  const moveResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    window.nachoWindow?.resizeTo?.(event.screenX - drag.startX, event.screenY - drag.startY)
  }, [])

  const endResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    window.nachoWindow?.endResize?.()
  }, [])

  return (
    <div className="window-surface">
      {children}
      {desktopShell && !maximized
        ? RESIZE_HANDLES.map((handle) => (
            <div
              key={handle.key}
              className={`window-resize-handle window-resize-${handle.key}`}
              onPointerDown={startResize(handle.edges)}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              aria-hidden="true"
            />
          ))
        : null}
    </div>
  )
}
