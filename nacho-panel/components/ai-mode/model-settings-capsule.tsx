"use client"

/* 左栏「模型设置」胶囊：点击后胶囊原地浮起，弹性形变为屏幕正中的设置卡片（背景模糊压暗），
 * 关闭时卡片沿原路收回成胶囊并轻压回弹；卡片内容与设置页「模型连接」共用同一套字段。 */

import { useId, useRef, useState } from "react"
import { ChevronRight, Settings2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { centerInViewport, type MorphRect, type MorphSize, type MorphViewport } from "@/lib/morph-geometry"
import { AIConnectionTestButton, AIModelFields, useAIConnectionTest } from "@/components/settings/ai-model-fields"
import { MorphPopover } from "./morph-popover"

const CAPSULE_CLASS =
  "flex h-9 w-full min-w-0 items-center gap-2 rounded-full border border-border/70 bg-foreground/[0.03] pl-3 pr-2.5 text-[11px] text-muted-foreground"
const CAPSULE_RADIUS = 18
const SHEET_RADIUS = 26
const SHEET_WIDTH = 576

function centerPlacement(size: MorphSize, _anchor: MorphRect, viewport: MorphViewport) {
  return centerInViewport(size, viewport)
}

function CapsuleFace({ modelLabel }: { modelLabel: string }) {
  return (
    <>
      <Settings2 className="h-3.5 w-3.5 shrink-0" />
      <span className="shrink-0 font-medium text-foreground/90">模型设置</span>
      <span className="ml-auto min-w-0 truncate font-mono text-[10px] text-muted-foreground/70">{modelLabel}</span>
      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
    </>
  )
}

function ModelSettingsSheet({ titleId, onDone }: { titleId: string; onDone: () => void }) {
  const connection = useAIConnectionTest()
  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-card px-6 pb-4 pt-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border text-foreground">
            <Settings2 className="h-5 w-5" />
          </span>
          <div className="min-w-0 leading-tight">
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              模型设置
            </h2>
            <p className="mt-1 text-pretty text-sm text-muted-foreground">推理服务、模型与执行策略，修改后立即生效</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="h-9 shrink-0 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          完成
        </button>
      </header>
      <div className="flex flex-col px-6 pb-1 pt-5">
        <AIModelFields showEnable={false} />
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
        <p
          aria-live="polite"
          className={cn(
            "min-w-0 text-pretty text-xs leading-relaxed",
            connection.state === "ok"
              ? "text-positive"
              : connection.state === "error"
                ? "text-negative"
                : "text-muted-foreground",
          )}
        >
          {connection.message || "技能、MCP 与插件授权请在「系统设置 → AI」中管理"}
        </p>
        <AIConnectionTestButton
          state={connection.state}
          message={connection.message}
          onTest={() => void connection.test()}
        />
      </footer>
    </div>
  )
}

export function ModelSettingsCapsule({ modelLabel }: { modelLabel: string }) {
  const [open, setOpen] = useState(false)
  // 卡片浮起到收回落位之前，真实胶囊保持透明，由卡片上的同款外观接替显示
  const [lifted, setLifted] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setLifted(true)
          setOpen(true)
        }}
        className={cn(
          CAPSULE_CLASS,
          "transition-colors hover:border-border hover:bg-foreground/[0.06] hover:text-foreground focus-visible:border-primary/50 focus-visible:outline-none",
          lifted && "opacity-0",
        )}
      >
        <CapsuleFace modelLabel={modelLabel} />
      </button>
      <MorphPopover
        open={open}
        getAnchor={() => anchorRef.current}
        onRequestClose={() => setOpen(false)}
        onClosed={() => setLifted(false)}
        width={SHEET_WIDTH}
        place={centerPlacement}
        fromRadius={CAPSULE_RADIUS}
        toRadius={SHEET_RADIUS}
        face={
          <div className={cn(CAPSULE_CLASS, "h-full w-full")}>
            <CapsuleFace modelLabel={modelLabel} />
          </div>
        }
        backdrop="blur"
        modal
        closeLabel="关闭模型设置"
        labelledBy={titleId}
        className="border border-border text-foreground"
        fromSkinClassName="bg-background/85 backdrop-blur-xl"
        toSkinClassName="bg-card"
      >
        <ModelSettingsSheet titleId={titleId} onDone={() => setOpen(false)} />
      </MorphPopover>
    </>
  )
}
