"use client"

import { useEffect, useRef, useState } from "react"
import { Sparkles, KeyRound, Blocks, Server, Puzzle, Eye, EyeOff, RefreshCw, Check, CircleAlert, Plus, Trash2 } from "lucide-react"
import { SettingCard, SettingRow, Toggle, TextField, ThresholdSlider } from "./primitives"
import { modelOptions, useAIConfig, aiConfigStore, type AIModelId } from "./ai-data"
import { applyAISettingsMeta, flushAISettings, useAIRuntimeStatus } from "./ai-config-sync"
import { testAIConnection } from "@/lib/ai/client"
import { cn } from "@/lib/utils"

/** AI Mode 设置面板：连接、模型、技能、MCP、插件授权 */
export function AIPanel() {
  const cfg = useAIConfig()
  const runtime = useAIRuntimeStatus()
  const [showKey, setShowKey] = useState(false)
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "error">("idle")
  const [testMessage, setTestMessage] = useState("")
  const resetTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
  }, [])

  const scheduleReset = () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => {
      resetTimer.current = null
      setTestState("idle")
    }, 3_500)
  }

  const testConnection = async () => {
    if (testState === "testing") return
    setTestState("testing")
    setTestMessage("")
    if (!runtime.desktop) {
      setTestState("error")
      setTestMessage("AI Mode 仅支持 Windows 桌面版")
      scheduleReset()
      return
    }
    try {
      await flushAISettings()
      const result = await testAIConnection()
      applyAISettingsMeta(result.settings)
      if (result.provider.ok) {
        setTestState("ok")
        setTestMessage(`连接正常${typeof result.provider.models === "number" ? ` · ${result.provider.models} 个模型` : ""}`)
      } else {
        setTestState("error")
        setTestMessage(result.provider.error?.message || "连接失败")
      }
    } catch (error) {
      setTestState("error")
      setTestMessage(error instanceof Error ? error.message : "连接失败")
    }
    scheduleReset()
  }

  const updateMcp = (id: string, patch: Partial<typeof cfg.mcpServers[number]>) => {
    aiConfigStore.set({
      mcpServers: cfg.mcpServers.map((server) => (server.id === id ? { ...server, ...patch } : server)),
    })
  }

  const addMcp = () => {
    if (cfg.mcpServers.length >= 16) return
    const id = `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    aiConfigStore.set({
      mcpServers: [
        ...cfg.mcpServers,
        { id, name: "MCP 服务器", url: "", status: "disabled", tools: 0 },
      ],
    })
  }

  const removeMcp = (id: string) => {
    aiConfigStore.set({ mcpServers: cfg.mcpServers.filter((server) => server.id !== id) })
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {/* 连接与模型 */}
      <SettingCard
        title="模型连接"
        desc="配置 AI Mode 使用的推理服务与模型"
        icon={<Sparkles className="h-5 w-5" />}
        action={
          <button
            type="button"
            onClick={() => void testConnection()}
            title={testMessage || undefined}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-xl border border-border px-3.5 text-sm font-medium transition-colors",
              testState === "ok"
                ? "border-positive/50 text-positive"
                : testState === "error"
                  ? "border-negative/50 text-negative"
                  : "text-foreground hover:bg-surface",
            )}
          >
            {testState === "testing" ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : testState === "ok" ? (
              <Check className="h-4 w-4" />
            ) : testState === "error" ? (
              <CircleAlert className="h-4 w-4" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            {testState === "ok" ? "连接正常" : testState === "testing" ? "测试中" : testState === "error" ? "连接失败" : "测试连接"}
          </button>
        }
      >
        <SettingRow label="启用 AI Mode" hint="关闭后顶栏入口将置灰，所有 AI 操作不可用">
          <Toggle checked={cfg.enabled} onChange={(v) => aiConfigStore.set({ enabled: v })} label="启用 AI Mode" />
        </SettingRow>
        <SettingRow label="API 地址" hint="OpenAI 兼容接口的 Base URL" htmlFor="ai-url">
          <TextField
            id="ai-url"
            value={cfg.baseUrl}
            onChange={(v) => aiConfigStore.set({ baseUrl: v })}
            placeholder="https://api.example.com/v1"
            className="w-full font-mono sm:w-72"
          />
        </SettingRow>
        <SettingRow label="API Key" hint="仅保存在本机，不会上传" htmlFor="ai-key">
          <div className="relative w-full sm:w-72">
            <TextField
              id="ai-key"
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
                  cfg.model === m.id
                    ? "border-primary/60 bg-primary/8"
                    : "border-border bg-surface/60 hover:bg-surface",
                )}
              >
                <span className="text-sm font-medium text-foreground">{m.label}</span>
                <span className="text-[11px] text-muted-foreground">{m.vendor}</span>
              </button>
            ))}
          </div>
        </SettingRow>
        {cfg.model === "custom" && (
          <SettingRow label="自定义模型 ID" htmlFor="ai-custom-model">
            <TextField
              id="ai-custom-model"
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
      </SettingCard>

      <div className="flex flex-col gap-4">
        {/* Skills */}
        <SettingCard title="Skills 技能" desc="决定 AI 能理解并执行哪些类别的操作" icon={<Blocks className="h-5 w-5" />}>
          {cfg.skills.map((s) => (
            <SettingRow key={s.id} label={s.name} hint={s.desc}>
              <div className="flex items-center gap-2.5">
                {s.builtin && (
                  <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    内置
                  </span>
                )}
                <Toggle
                  checked={s.enabled}
                  onChange={(v) =>
                    aiConfigStore.set({
                      skills: cfg.skills.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)),
                    })
                  }
                  label={s.name}
                />
              </div>
            </SettingRow>
          ))}
        </SettingCard>

        {/* MCP */}
        <SettingCard
          title="MCP 服务器"
          desc="通过 Model Context Protocol 扩展 AI 的工具集（仅支持 HTTP）"
          icon={<Server className="h-5 w-5" />}
          action={
            <button
              type="button"
              onClick={addMcp}
              disabled={cfg.mcpServers.length >= 16}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-border px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-surface disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
              添加
            </button>
          }
        >
          {cfg.mcpServers.length === 0 && (
            <p className="text-xs text-muted-foreground/70">尚未配置 MCP 服务器</p>
          )}
          {cfg.mcpServers.map((m) => (
            <SettingRow
              key={m.id}
              label={m.name}
              hint={`${m.tools} 个工具${m.lastCheckedAt ? ` · 上次检测 ${new Date(m.lastCheckedAt).toLocaleTimeString()}` : ""}`}
            >
              <div className="flex w-full flex-col gap-2 sm:w-80">
                <div className="flex items-center gap-2">
                  <TextField
                    value={m.url}
                    onChange={(v) => updateMcp(m.id, { url: v })}
                    placeholder="https://mcp.example.com/mcp"
                    className="min-w-0 flex-1 font-mono text-xs"
                  />
                  <button
                    type="button"
                    aria-label="删除 MCP 服务器"
                    onClick={() => removeMcp(m.id)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-negative/50 hover:text-negative"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <TextField
                  type="password"
                  value={m.token ?? ""}
                  onChange={(v) => updateMcp(m.id, { token: v })}
                  placeholder={m.hasToken ? "Token 已加密保存，可输入新值替换" : "Token（可选）"}
                  className="w-full font-mono text-xs"
                />
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "flex items-center gap-1.5 text-xs",
                      m.status === "connected"
                        ? "text-positive"
                        : m.status === "error"
                          ? "text-negative"
                          : "text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        m.status === "connected" ? "bg-positive" : m.status === "error" ? "bg-negative" : "bg-muted-foreground/50",
                      )}
                    />
                    {m.status === "connected" ? "已启用" : m.status === "error" ? "异常" : "停用"}
                  </span>
                  <Toggle
                    checked={m.status === "connected"}
                    onChange={(v) => updateMcp(m.id, { status: v ? "connected" : "disabled" })}
                    label={m.name}
                  />
                </div>
              </div>
            </SettingRow>
          ))}
        </SettingCard>

        {/* 插件授权 */}
        <SettingCard title="插件授权" desc="允许 AI 调用已安装插件的能力" icon={<Puzzle className="h-5 w-5" />}>
          {cfg.plugins.map((p) => (
            <SettingRow key={p.id} label={p.name} hint={p.desc}>
              <Toggle
                checked={p.enabled}
                onChange={(v) =>
                  aiConfigStore.set({
                    plugins: cfg.plugins.map((x) => (x.id === p.id ? { ...x, enabled: v } : x)),
                  })
                }
                label={p.name}
              />
            </SettingRow>
          ))}
        </SettingCard>
      </div>
    </div>
  )
}
