"use client"

import { Palette, Check } from "lucide-react"
import { SettingCard } from "./primitives"
import { themeOptions, useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

/* 外观主题选择：点击即生效并自动保存，不走底部保存条 */
export function AppearanceCard() {
  const { theme, setTheme } = useTheme()

  return (
    <SettingCard
      title="外观主题"
      desc="选择控制面板的主题色，切换后立即生效并自动保存"
      icon={<Palette className="h-5 w-5" />}
    >
      <div
        role="radiogroup"
        aria-label="主题色"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      >
        {themeOptions.map((opt) => {
          const active = theme === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(opt.id)}
              className={cn(
                "group flex flex-col items-center gap-2.5 rounded-2xl border px-3 py-4 transition-all",
                active
                  ? "border-primary/60 bg-primary/8 shadow-lg shadow-primary/10"
                  : "border-border bg-surface/40 hover:border-border hover:bg-surface/70",
              )}
            >
              <span
                className="relative flex h-9 w-9 items-center justify-center rounded-full transition-transform group-active:scale-90"
                style={{ backgroundColor: opt.swatch }}
              >
                {active && <Check className="h-4 w-4" style={{ color: "oklch(0.2 0.04 0)" }} aria-hidden />}
              </span>
              <span
                className={cn(
                  "text-xs font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                )}
              >
                {opt.label}
              </span>
            </button>
          )
        })}
      </div>
    </SettingCard>
  )
}
