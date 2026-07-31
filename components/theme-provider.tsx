"use client"

/* 主题色系统：通过 <html data-theme="..."> 切换 globals.css 中定义的配色。 */

import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react"
import { useLocalSettings } from "@/components/local-settings-provider"
import type { LocalThemeId } from "@/lib/local-settings-schema"

export type ThemeId = LocalThemeId

export type ThemeOption = {
  id: ThemeId
  label: string
  /* 用于选择器中展示的代表色（与 CSS 中 --primary 保持一致） */
  swatch: string
}

export const themeOptions: readonly ThemeOption[] = [
  { id: "blue", label: "深海蓝", swatch: "oklch(0.75 0.15 245)" },
  { id: "green", label: "猫叶绿", swatch: "oklch(0.82 0.19 145)" },
  { id: "cyan", label: "冰川青", swatch: "oklch(0.8 0.13 200)" },
  { id: "orange", label: "落日橙", swatch: "oklch(0.8 0.16 60)" },
  { id: "rose", label: "樱花粉", swatch: "oklch(0.78 0.15 5)" },
]

const ThemeContext = createContext<{
  theme: ThemeId
  setTheme: (t: ThemeId) => void
} | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, hydrated, update } = useLocalSettings()
  const theme = settings.theme

  useEffect(() => {
    if (!hydrated) return
    const root = document.documentElement
    if (theme === "blue") root.removeAttribute("data-theme")
    else root.setAttribute("data-theme", theme)
  }, [hydrated, theme])

  const setTheme = useCallback((t: ThemeId) => {
    const root = document.documentElement
    if (t === "blue") root.removeAttribute("data-theme")
    else root.setAttribute("data-theme", t)
    void update({ theme: t })
  }, [update])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme 必须在 <ThemeProvider> 内部使用")
  return ctx
}
