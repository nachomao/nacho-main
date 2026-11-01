"use client"

/* 模型连接字段与连接测试：设置页「模型连接」卡片与 AI Mode 的模型设置卡片共用。 */

import { useEffect, useId, useRef, useState } from "react"
import { Check, CircleAlert, Eye, EyeOff, KeyRound, RefreshCw } from "lucide-react"
import { SettingRow, TextField, ThresholdSlider, Toggle } from "./primitives"
import { aiConfigStore, modelOptions, useAIConfig, type AIModelId } from "./ai-data"
import { applyAISettingsMeta, flushAISettings, useAIRuntimeStatus } from "./ai-config-sync"
import { testAIConnection } from "@/lib/ai/client"
import { cn } from "@/lib/utils"

export type AIConnectionTestState = "idle" | "testing" | "ok" | "error"

/** 先落盘当前设置再探测上游；结果保留 3.5 秒后复位。 */
export function useAIConnectionTest() {
  const runtime = useAIRuntimeStatus()
  const [state, setState] = useState<AIConnectionTestState>("idle")
  const [message, setMessage] = useState("")
  const resetTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
  }, [])

  const scheduleReset = () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => {
      resetTimer.current = null
      setState("idle")
    }, 3_500)
  }

  const test = async () => {
    if (state === "testing") return
    setState("testing")
    setMessage("")
    if (!runtime.desktop) {
      setState("error")
      setMessage("AI Mode 仅支持 Windows 桌面版")
      scheduleReset()
      return
    }
    try {
      await flushAISettings()
      const result = await testAIConnection()
      applyAISettingsMeta(result.settings)
      if (result.provider.ok) {
        setState("ok")
        setMessage(`连接正常${typeof result.provider.models === "number" ? ` · ${result.provider.models} 个模型` : ""}`)
      } else {
        setState("error")
        setMessage(result.provider.error?.message || "连接失败")
      }
    } catch (error) {
      setState("error")
      setMessage(error instanceof Error ? error.message : "连接失败")
    }
    scheduleReset()
  }

  return { state, message, test }
}

export function AIConnectionTestButton({
  state,
  message,
  onTest,
}: {
  state: AIConnectionTestState
  message: string
  onTest: () => void
}) {
  return (
    <button
      type="button"
      onClick={onTest}
      title={message || undefined}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-border px-3.5 text-sm font-medium transition-colors",
        state === "ok"
          ? "border-positive/50 text-positive"
          : state === "error"
            ? "border-negative/50 text-negative"
            : "text-foreground hover:bg-surface",
      )}
    >
      {state === "testing" ? (
        <RefreshCw className="h-4 w-4 animate-spin" />
      ) : state === "ok" ? (
        <Check className="h-4 w-4" />
      ) : state === "error" ? (
        <CircleAlert className="h-4 w-4" />
      ) : (
        <KeyRound className="h-4 w-4" />
      )}
      {state === "ok" ? "连接正常" : state === "testing" ? "测试中" : state === "error" ? "连接失败" : "测试连接"}
    </button>
  )
}

/**
 * 模型连接字段，返回若干 SettingRow，需放进纵向 flex 容器（首行自动去掉分隔线）。
 * 输入框 id 由 useId 生成：设置页与 AI Mode 卡片同时挂载时 label 关联也不会串。
 */
export function AIModelFields({ showEnable = true }: { showEnable?: boolean }) {
  const cfg = useAIConfig()
  const [showKey, setShowKey] = useState(false)
  const id = useId()
  const urlId = `${id}-url`
  const keyId = `${id}-key`
  const customModelId = `${id}-custom-model`

  return (
    <>
      {showEnable ? (
        <SettingRow label="启用 AI Mode" hint="关闭后顶栏入口将置灰，所有 AI 操作不可用">
          <Toggle checked={cfg.enabled} onChange={(v) => aiConfigStore.set({ enabled: v })} label="启用 AI Mode" />
        </SettingRow>
      ) : null}
      <SettingRow label="API 地址" hint="OpenAI 兼容接口的 Base URL" htmlFor={urlId}>
        <TextField
          id={urlId}
          value={cfg.baseUrl}
          onChange={(v) => aiConfigStore.set({ baseUrl: v })}
          placeholder="https://api.example.com/v1"
          className="w-full font-mono sm:w-72"
        />
      </SettingRow>
      <SettingRow label="API Key" hint="仅保存在本机，不会上传" htmlFor={keyId}>
        <div className="relative w-full sm:w-72">
          <TextField
            id={keyId}
            type={showKey ? "text" : "password"}
            value={cfg.apiKey}
            onChange={(v) => aiConfigStore.set({ apiKey: v })}
            placeholder={cfg.hasApiKey ? "已加密保存，可输入新 Key 替换" : "sk-..."}
            className="w-full pr-10 font-mono"
          />
          <button
            type="button"
            aria-label={showKey ? "隐藏密钥" : "显示密钥"}
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </SettingRow>
      <SettingRow label="模型" hint="选择用于理解与规划操作的模型">
        <div className="grid w-full grid-cols-2 gap-2 sm:w-80">
          {modelOptions.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => aiConfigStore.set({ model: m.id as AIModelId })}
              aria-pressed={cfg.model === m.id}
              className={cn(
                "flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors",
                cfg.model === m.id ? "border-primary/60 bg-primary/8" : "border-border bg-surface/60 hover:bg-surface",
              )}
            >
              <span className="text-sm font-medium text-foreground">{m.label}</span>
              <span className="text-[11px] text-muted-foreground">{m.vendor}</span>
            </button>
          ))}
        </div>
      </SettingRow>
      {cfg.model === "custom" && (
        <SettingRow label="自定义模型 ID" htmlFor={customModelId}>
          <TextField
            id={customModelId}
            value={cfg.customModel}
            onChange={(v) => aiConfigStore.set({ customModel: v })}
            placeholder="例如 llama-4-70b-instruct"
            className="w-full font-mono sm:w-72"
          />
        </SettingRow>
      )}
      <SettingRow label="温度" hint="越低越保守，运维场景建议 0.2 - 0.4">
        <ThresholdSlider
          value={Math.round(cfg.temperature * 100)}
          onChange={(v) => aiConfigStore.set({ temperature: v / 100 })}
          min={0}
          max={100}
          unit=""
          tone="primary"
        />
      </SettingRow>
      <SettingRow label="危险操作确认" hint="执行重启、删除等操作前必须人工点击确认">
        <Toggle
          checked={cfg.confirmDanger}
          onChange={(v) => aiConfigStore.set({ confirmDanger: v })}
          label="危险操作确认"
        />
      </SettingRow>
    </>
  )
}
