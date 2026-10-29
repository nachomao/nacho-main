"use client"

import { useLocalSettings } from "@/components/local-settings-provider"

/**
 * 判定当前面板是否处于「削弱动画效果」状态。
 *
 * 核心机制：
 * 1. 默认状态：关闭（返回 false）。面板默认始终开启完整的流畅动效与 AI 卡片变形，
 *    完全不再受 Windows 系统开关（prefers-reduced-motion）的被动干扰；
 * 2. 开启后：当用户在「系统设置」→「常规」中主动打开「削弱动画效果」开关后，返回 true；
 * 3. 实时生效：切换开关时立刻更新状态与 <html> 的 data-reduce-motion 属性，无需重启面板。
 */
export function useMotionPreference(): {
  reduceMotion: boolean
  setReduceMotion: (value: boolean) => Promise<void>
} {
  const { settings, update } = useLocalSettings()
  return {
    reduceMotion: settings.reduceMotion,
    setReduceMotion: (reduceMotion: boolean) => update({ reduceMotion }),
  }
}

/**
 * 非 React 组件或即时调用的动效状态检测。
 * 检查 <html> 上是否由面板主动设置了 data-reduce-motion="true"。
 * 注意：不读取浏览器的 window.matchMedia("(prefers-reduced-motion: reduce)")，
 * 从而彻底与 Windows 系统的辅助功能开关解耦。
 */
export function isReducedMotion(): boolean {
  if (typeof document === "undefined") return false
  return document.documentElement.getAttribute("data-reduce-motion") === "true"
}
