"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export type SelectOption = string | { label: string; value: string; disabled?: boolean }

function normalize(opt: SelectOption): { label: string; value: string; disabled?: boolean } {
  return typeof opt === "string" ? { label: opt, value: opt } : opt
}

/**
 * 全局自定义下拉选择组件。
 * 用来替代原生 <select>，适配深色主题，支持字符串数组或 {label,value} 对象数组。
 */
export function Select({
  options,
  value,
  onChange,
  placeholder = "请选择",
  disabled,
  className,
  align = "start",
}: {
  options: SelectOption[]
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  align?: "start" | "end"
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const items = options.map(normalize)
  const selected = items.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDocClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface/60 px-4 text-left text-sm text-foreground outline-none transition-colors focus:border-primary/60 focus:bg-surface disabled:cursor-not-allowed disabled:opacity-50",
          open && "border-primary/60 bg-surface",
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground/60")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-30 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-border bg-card p-1.5 shadow-xl shadow-black/30",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((opt) => {
            const active = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                disabled={opt.disabled}
                onClick={() => {
                  onChange?.(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  active ? "bg-primary/15 text-primary" : "text-foreground hover:bg-surface",
                )}
              >
                <span className="truncate">{opt.label}</span>
                {active && <Check className="h-4 w-4 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
