"use client"

import type { ReactNode } from "react"
import { useId } from "react"
import { Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

/* ---------- 设置分组卡片 ---------- */
export function SettingCard({
  title,
  desc,
  icon,
  action,
  children,
  className,
}: {
  title: string
  desc?: string
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("card-glow flex flex-col overflow-hidden rounded-3xl bg-card p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {icon && (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border text-foreground">
              {icon}
            </span>
          )}
          <div className="leading-tight">
            <h2 className="text-base font-semibold">{title}</h2>
            {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="mt-5 flex flex-col">{children}</div>
    </section>
  )
}

/* ---------- 设置行：左标题 + 右控件，带分隔线 ---------- */
export function SettingRow({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string
  hint?: string
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-t border-border py-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 leading-tight">
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {hint && <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

/* ---------- 开关 ---------- */
export function Toggle({
  checked,
  onChange,
  id,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  id?: string
  label?: string
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 h-5 w-5 rounded-full transition-transform duration-200",
          checked ? "translate-x-5 bg-primary-foreground" : "translate-x-0 bg-foreground",
        )}
      />
    </button>
  )
}

/* ---------- 数字步进输入（带单位与增减） ---------- */
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  unit,
  id,
  className,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  id?: string
  className?: string
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  return (
    <div
      className={cn(
        "flex h-10 items-center rounded-xl border border-border bg-surface/60 transition-colors focus-within:border-primary/60",
        className,
      )}
    >
      <button
        type="button"
        aria-label="减少"
        onClick={() => onChange(clamp(value - step))}
        className="flex h-full w-9 items-center justify-center rounded-l-xl text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
      >
        <Minus className="h-4 w-4" />
      </button>
      <div className="flex min-w-0 items-baseline justify-center gap-1 px-1">
        <input
          id={id}
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          className="w-14 bg-transparent text-center text-sm font-semibold tabular-nums text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {unit && <span className="pointer-events-none whitespace-nowrap text-xs text-muted-foreground">{unit}</span>}
      </div>
      <button
        type="button"
        aria-label="增加"
        onClick={() => onChange(clamp(value + step))}
        className="flex h-full w-9 items-center justify-center rounded-r-xl text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  )
}

/* ---------- 文本输入 ---------- */
export function TextField({
  value,
  onChange,
  placeholder,
  type = "text",
  id,
  invalid,
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  id?: string
  invalid?: boolean
  className?: string
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-invalid={invalid}
      className={cn(
        "h-10 rounded-xl border bg-surface/60 px-3.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:bg-surface",
        invalid ? "border-negative/60 focus:border-negative" : "border-border focus:border-primary/60",
        className,
      )}
    />
  )
}

/* ---------- 阈值滑块（range） ---------- */
export function ThresholdSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = "%",
  tone = "warning",
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  tone?: "warning" | "negative" | "primary"
}) {
  const id = useId()
  const pct = ((value - min) / (max - min)) * 100
  const toneColor = {
    warning: "var(--warning)",
    negative: "var(--negative)",
    primary: "var(--primary)",
  }[tone]

  return (
    <div className="flex w-full items-center gap-3 sm:w-64">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground"
        style={{
          background: `linear-gradient(to right, ${toneColor} 0%, ${toneColor} ${pct}%, var(--muted) ${pct}%, var(--muted) 100%)`,
        }}
      />
      <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums" style={{ color: toneColor }}>
        {value}
        {unit}
      </span>
    </div>
  )
}

/* ---------- 只读信息行（关于页） ---------- */
export function InfoRow({
  label,
  value,
  mono,
  badge,
}: {
  label: string
  value: ReactNode
  mono?: boolean
  badge?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border py-3.5 first:border-t-0 first:pt-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("flex items-center gap-2 text-sm font-medium text-foreground", mono && "font-mono")}>
        {value}
        {badge}
      </span>
    </div>
  )
}
