"use client"

import { Sparkles, Blocks, Server, Puzzle, Plus, Trash2 } from "lucide-react"
import { SettingCard, SettingRow, Toggle, TextField } from "./primitives"
import { useAIConfig, aiConfigStore } from "./ai-data"
import { AIConnectionTestButton, AIModelFields, useAIConnectionTest } from "./ai-model-fields"
import { cn } from "@/lib/utils"

/** AI Mode 设置面板：连接、模型、技能、MCP、插件授权 */
export function AIPanel() {
  const cfg = useAIConfig()
  const connection = useAIConnectionTest()

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
          <AIConnectionTestButton
            state={connection.state}
            message={connection.message}
            onTest={() => void connection.test()}
          />
        }
      >
        <AIModelFields />
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
