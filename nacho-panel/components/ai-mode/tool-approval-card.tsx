"use client"

/* 赋权确认卡：工具的详情仍留在工具分支里，真正需要用户决定的按钮统一放到正文末尾。
 * 这样正文流式增长时确认入口不会被顶出可视区；确认卡出现 / 消失由外层 AutoHeight 过渡。 */

import { ShieldAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ToolStep } from "@/lib/ai/chat-history"
import { sourceMeta } from "./tool-source-meta"

export function ToolApprovalCard({
  step,
  onConfirm,
  onDeny,
  className,
}: {
  step: ToolStep
  onConfirm: (stepId: string) => void
  onDeny: (stepId: string) => void
  className?: string
}) {
  const meta = sourceMeta[step.source]
  const danger = step.risk === "danger"
  return (
    <div
      role="group"
      aria-label={`${step.tool} 需要确认`}
      className={cn(
        "rounded-xl border p-3",
        danger
          ? "border-negative/45 bg-negative/[0.06] shadow-[0_18px_48px_-30px] shadow-negative/70"
          : "border-warning/40 bg-warning/[0.06] shadow-[0_18px_48px_-30px] shadow-warning/70",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
            danger ? "border-negative/40 bg-negative/10 text-negative" : "border-warning/40 bg-warning/10 text-warning",
          )}
        >
          <ShieldAlert className="h-3.5 w-3.5" />
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className={cn("font-medium", danger ? "text-negative" : "text-warning")}>需要你确认</span>
          <span className="text-[10px] text-muted-foreground/70">工具调用已暂停，确认后继续执行</span>
        </span>
        <span className="ml-auto flex items-center gap-1 rounded-md border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          <meta.Icon className="h-3 w-3" />
          {meta.label}
        </span>
        {step.risk ? (
          <span
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-[10px]",
              danger ? "border-negative/40 text-negative" : "border-warning/40 text-warning",
            )}
          >
            {danger ? "危险" : "警告"}
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
        <code className="min-w-0 truncate font-mono text-[11px] text-primary">{step.tool}</code>
        {step.detail && step.detail !== step.tool ? (
          <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/70">{step.detail}</span>
        ) : null}
      </div>

      <p
        className={cn(
          "mt-2 rounded-md border px-2 py-1.5 text-[11px] leading-relaxed text-foreground/90",
          danger ? "border-negative/25 bg-negative/5" : "border-warning/30 bg-warning/5",
        )}
      >
        {step.ask || "该操作会改动本机或服务端状态，确认后才会执行。"}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className={cn("text-[11px]", danger ? "text-negative/80" : "text-warning/80")}>等待你的决定</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => onDeny(step.id)}
            className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            拒绝
          </button>
          <button
            type="button"
            onClick={() => onConfirm(step.id)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all hover:brightness-105",
              danger ? "bg-negative text-white" : "bg-warning text-background",
            )}
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  )
}
