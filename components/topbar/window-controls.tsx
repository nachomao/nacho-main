"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * 定制窗口控制图标：16 视口、1.6 线宽、圆头线帽，
 * 光学尺寸与顶栏铃铛/搜索图标的轻盈线条对齐，
 * 方框用大圆角呼应面板的胶囊造型语言。
 */
const ICON_STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
}

/** 最小化：低位短横线，示意窗口收入底部任务栏 */
function MinimizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 11.5h7" {...ICON_STROKE} />
    </svg>
  )
}

/** 最大化：大圆角方框，圆角与面板卡片造型呼应 */
function MaximizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="3.5" width="9" height="9" rx="2.5" {...ICON_STROKE} />
    </svg>
  )
}

/** 还原：前窗完整圆角框 + 后窗一段圆弧探出，示意双层窗口 */
function RestoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3.5h4A2.5 2.5 0 0 1 12.5 6v4" {...ICON_STROKE} />
      <rect x="3.5" y="6.5" width="6" height="6" rx="2" {...ICON_STROKE} />
    </svg>
  )
}

/** 关闭：收拢的小尺寸圆头斜叉，克制不张扬 */
function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6" {...ICON_STROKE} />
    </svg>
  )
}

/**
 * 桌面壳窗口控制协议：封装成 exe 时由桌面壳（Electron preload / Tauri 注入等）
 * 在 window.nachoWindow 上暴露原生窗口接口；浏览器环境下不存在该对象。
 */
interface NachoWindowBridge {
  minimize: () => void
  /** 切换最大化/还原，可返回切换后的最大化状态 */
  toggleMaximize: () => boolean | void | Promise<boolean | void>
  close: () => void
  /** 可选：查询当前是否最大化 */
  isMaximized?: () => boolean | Promise<boolean>
  /** 可选：订阅最大化状态变化，返回取消订阅函数 */
  onMaximizedChange?: (cb: (maximized: boolean) => void) => (() => void) | void
}

declare global {
  interface Window {
    nachoWindow?: NachoWindowBridge
  }
}

/** 读取桌面壳 bridge（仅客户端调用） */
function getBridge(): NachoWindowBridge | null {
  if (typeof window === "undefined") return null
  return window.nachoWindow ?? null
}

/**
 * 顶栏窗口控制按钮组（缩小 / 最大化 / 关闭），Windows 排布风格。
 * 视觉延续顶栏胶囊语言：整组为 bg-surface 圆角胶囊 + border-border 描边，
 * 图标悬浮浮现 bg-muted，关闭键悬浮切换为 bg-negative 警示色。
 *
 * 行为分两种环境：
 * - 桌面壳（window.nachoWindow 存在）：三键直接调用原生窗口接口；
 * - 浏览器预览：缩小/关闭禁用置灰，最大化降级为浏览器全屏切换。
 */
export function WindowControls() {
  // 是否运行在桌面壳内（挂载后探测，避免 SSR/水合不一致）
  const [hasBridge, setHasBridge] = useState(false)
  // 当前是否处于最大化（桌面壳）或浏览器全屏状态
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const bridge = getBridge()
    if (bridge) {
      setHasBridge(true)
      // 初始状态与订阅：接口均为可选，桌面壳可按需实现
      Promise.resolve(bridge.isMaximized?.()).then((v) => {
        if (typeof v === "boolean") setMaximized(v)
      })
      const off = bridge.onMaximizedChange?.((v) => setMaximized(v))
      return () => {
        if (typeof off === "function") off()
      }
    }
    // 浏览器环境：跟踪网页全屏状态（Esc 退出等场景保持同步）
    const onFsChange = () => setMaximized(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onFsChange)
    onFsChange()
    return () => document.removeEventListener("fullscreenchange", onFsChange)
  }, [])

  const handleMinimize = () => {
    getBridge()?.minimize()
  }

  const handleToggleMaximize = async () => {
    const bridge = getBridge()
    if (bridge) {
      const result = await Promise.resolve(bridge.toggleMaximize())
      // 未实现订阅接口时，以返回值或本地取反兜底
      setMaximized((prev) => (typeof result === "boolean" ? result : !prev))
      return
    }
    // 浏览器降级：切换网页全屏；状态由 fullscreenchange 监听统一更新
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await document.documentElement.requestFullscreen()
      }
    } catch {
      // 用户手势限制或浏览器拒绝时静默忽略
    }
  }

  const handleClose = () => {
    getBridge()?.close()
  }

  // 缩小/关闭仅在桌面壳内可用；浏览器中禁用（仅图标降低透明度，保持占位，封装后无缝启用）
  const nativeOnly = !hasBridge

  // 内部小圆钮：36px 圆形，悬浮浮现圆形高亮 + 图标微缩放，与顶栏图标簇的圆形按钮语言一致
  const innerBtn =
    "group flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-out [&>svg]:transition-transform [&>svg]:duration-200 [&>svg]:ease-out hover:[&>svg]:scale-110"

  return (
    <div
      role="group"
      aria-label="窗口控制"
      className="ml-1 flex h-12 items-center gap-0.5 rounded-full bg-surface px-1.5"
    >
      <button
        type="button"
        aria-label="最小化窗口"
        title={nativeOnly ? "最小化（桌面版可用）" : "最小化"}
        disabled={nativeOnly}
        onClick={handleMinimize}
        className={cn(
          innerBtn,
          nativeOnly
            ? "cursor-not-allowed text-muted-foreground/40"
            : "hover:bg-muted hover:text-foreground active:bg-muted",
        )}
      >
        <MinimizeIcon />
      </button>

      <button
        type="button"
        aria-label={maximized ? "还原窗口" : "最大化窗口"}
        title={maximized ? "还原" : hasBridge ? "最大化" : "全屏"}
        onClick={handleToggleMaximize}
        className={cn(innerBtn, "hover:bg-muted hover:text-foreground active:bg-muted")}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>

      <button
        type="button"
        aria-label="关闭窗口"
        title={nativeOnly ? "关闭（桌面版可用）" : "关闭"}
        disabled={nativeOnly}
        onClick={handleClose}
        className={cn(
          innerBtn,
          nativeOnly
            ? "cursor-not-allowed text-muted-foreground/40"
            : "hover:bg-negative hover:text-primary-foreground active:bg-negative",
        )}
      >
        <CloseIcon />
      </button>
    </div>
  )
}
