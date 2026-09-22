"use client"

import { useEffect, useMemo, useState } from "react"
import { SlidersHorizontal, Bell, ShieldCheck, Info, Save, RotateCcw, Check, Sparkles, Network } from "lucide-react"
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control"
import { GeneralPanel } from "./general-panel"
import { NotificationsPanel } from "./notifications-panel"
import { SecurityPanel } from "./security-panel"
import { AboutPanel } from "./about-panel"
import { AIPanel } from "./ai-panel"
import { ConnectionPanel } from "./connection-panel"
import { defaultSettings, type SettingsState } from "./settings-data"
import { cn } from "@/lib/utils"
import { useLocalSettings } from "@/components/local-settings-provider"
import { useServerData } from "@/components/server-data-context"

type TabId = "general" | "connection" | "notifications" | "security" | "ai" | "about"

const tabs: readonly SegmentedOption<TabId>[] = [
  { id: "general", label: "常规", icon: SlidersHorizontal },
  { id: "connection", label: "连接", icon: Network },
  { id: "notifications", label: "通知", icon: Bell },
  { id: "security", label: "安全", icon: ShieldCheck },
  { id: "ai", label: "AI Mode", icon: Sparkles },
  { id: "about", label: "关于", icon: Info },
]

export function SettingsView() {
  const local = useLocalSettings()
  const { apiRequest } = useServerData()
  const [tab, setTab] = useState<TabId>("general")
  // 内容跟随药丸滑动方向水平平移进场
  const [enterAnim, setEnterAnim] = useState("animate-slide-in-right")
  const [settings, setSettings] = useState<SettingsState>(defaultSettings)

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab")
    if (tabs.some((item) => item.id === requested)) setTab(requested as TabId)
  }, [])

  const switchTab = (next: TabId) => {
    if (next === tab) return
    const from = tabs.findIndex((t) => t.id === tab)
    const to = tabs.findIndex((t) => t.id === next)
    // 药丸右移 → 新内容从右侧滑入；左移 → 从左侧滑入，与滑块同向
    setEnterAnim(to > from ? "animate-slide-in-right" : "animate-slide-in-left")
    setTab(next)
  }
  const [saved, setSaved] = useState<SettingsState>(defaultSettings)
  const [justSaved, setJustSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void apiRequest<Record<string, unknown>>("/settings")
      .then((remote) => {
        const security = remote.security
        if (!security || typeof security !== "object" || Array.isArray(security)) return
        const openEnrollment = (security as Record<string, unknown>).openEnrollment
        if (typeof openEnrollment !== "boolean" || !active) return
        setSettings((current) => ({ ...current, security: { ...current.security, openEnrollment } }))
        setSaved((current) => ({ ...current, security: { ...current.security, openEnrollment } }))
      })
      .catch(() => {
        // 服务端尚未连接时保留默认关闭状态，连接恢复后会再次加载。
      })
    return () => { active = false }
  }, [apiRequest])

  const dirty = useMemo(() => JSON.stringify(settings) !== JSON.stringify(saved), [settings, saved])

  const patch = <K extends keyof SettingsState>(key: K, value: Partial<SettingsState[K]>) =>
    setSettings((s) => ({ ...s, [key]: { ...s[key], ...value } }))

  const handleSave = async () => {
    setSaveError(null)
    setSaving(true)
    try {
      if (settings.security.openEnrollment !== saved.security.openEnrollment) {
        await apiRequest("/settings", {
          method: "PUT",
          body: JSON.stringify({ security: { openEnrollment: settings.security.openEnrollment } }),
        })
      }
      setSaved(settings)
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2000)
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "设置保存失败")
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => setSettings(saved)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      {/* 选项卡 */}
      <SegmentedControl options={tabs} value={tab} onChange={switchTab} />

      {/* 面板内容（可滚动，切换时按药卡方向平移进场） */}
      <div key={tab} className={cn("min-h-0 flex-1 overflow-auto pb-24 pr-1", enterAnim)}>
        {tab === "general" && (
          <GeneralPanel value={settings.general} onChange={(p) => patch("general", p)} />
        )}
        {tab === "connection" && <ConnectionPanel />}
        {tab === "notifications" && (
          <NotificationsPanel
            email={settings.email}
            conditions={settings.conditions}
            onEmailChange={(p) => patch("email", p)}
            onConditionsChange={(p) => patch("conditions", p)}
            notificationCenter={local.settings.notificationCenter}
            onNotificationCenterChange={(p) => void local.update({ notificationCenter: p })}
          />
        )}
        {tab === "security" && (
          <SecurityPanel value={settings.security} onChange={(p) => patch("security", p)} />
        )}
        {/* AI Mode 面板使用独立的共享存储，改动即时生效，无需保存条 */}
        {tab === "ai" && <AIPanel />}
        {tab === "about" && <AboutPanel />}
      </div>

      {/* 底部保存条：有改动时浮现（AI Mode 即时生效，不走保存流程） */}
      {tab !== "about" && tab !== "ai" && tab !== "connection" && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-4"
          style={{ zIndex: 40 }}
        >
          <div
            className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-xl backdrop-blur transition-all duration-300"
            style={{
              transform: dirty || justSaved ? "translateY(0)" : "translateY(150%)",
              opacity: dirty || justSaved ? 1 : 0,
            }}
          >
            {justSaved ? (
              <span className="flex items-center gap-2 px-2 text-sm font-medium text-primary">
                <Check className="h-4 w-4" />
                设置已保存
              </span>
            ) : (
              <>
                <span className={cn("hidden text-sm sm:block", saveError ? "text-negative" : "text-muted-foreground")}>{saveError || "你有未保存的更改"}</span>
                <button
                  type="button"
                  onClick={handleReset}
                  className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface/60 px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-surface"
                >
                  <RotateCcw className="h-4 w-4" />
                  放弃
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:brightness-105 active:scale-95 disabled:cursor-wait disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {saving ? "保存中…" : "保存更改"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
