"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { SlidersHorizontal, Bell, ShieldCheck, Info, Save, RotateCcw, Check, Sparkles, Network, RefreshCw } from "lucide-react"
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control"
import { GeneralPanel } from "./general-panel"
import { NotificationsPanel } from "./notifications-panel"
import { SecurityPanel } from "./security-panel"
import { AboutPanel } from "./about-panel"
import { AIPanel } from "./ai-panel"
import { ConnectionPanel } from "./connection-panel"
import { UpdatesPanel } from "./updates-panel"
import { defaultSettings, type SettingsState } from "./settings-data"
import { applyRemoteSettings, buildSettingsUpdate, isEmailSettingsDirty, syncSavedEmail } from "./settings-remote"
import { isTrustedEmailService, readEmailStatus, type EmailStatus } from "./email-settings"
import { cn } from "@/lib/utils"
import { useLocalSettings } from "@/components/local-settings-provider"
import { useServerData } from "@/components/server-data-context"

type TabId = "general" | "connection" | "notifications" | "security" | "ai" | "updates" | "about"

const tabs: readonly SegmentedOption<TabId>[] = [
  { id: "general", label: "常规", icon: SlidersHorizontal },
  { id: "connection", label: "连接", icon: Network },
  { id: "updates", label: "更新", icon: RefreshCw },
  { id: "notifications", label: "通知", icon: Bell },
  { id: "security", label: "安全", icon: ShieldCheck },
  { id: "ai", label: "AI Mode", icon: Sparkles },
  { id: "about", label: "关于", icon: Info },
]

export function SettingsView() {
  const local = useLocalSettings()
  const { apiRequest, developerPreview, serverConnection } = useServerData()
  const [tab, setTab] = useState<TabId>("general")
  // 内容跟随药丸滑动方向水平平移进场
  const [enterAnim, setEnterAnim] = useState("animate-slide-in-right")
  const [{ settings, saved }, setModel] = useState({ settings: defaultSettings, saved: defaultSettings })
  const [justSaved, setJustSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [settingsResult, setSettingsResult] = useState<{ source: typeof apiRequest; ready: boolean } | null>(null)
  const [emailStatusResult, setEmailStatusResult] = useState<{ source: typeof apiRequest; status: EmailStatus | null } | null>(null)
  const statusRevision = useRef(0)
  const settingsRevision = useRef(0)
  const activeRequest = useRef<typeof apiRequest | null>(apiRequest)
  const trustedEmailConnection = !developerPreview && !!serverConnection && isTrustedEmailService(serverConnection.baseUrl)
  const emailStatus = emailStatusResult?.source === apiRequest ? emailStatusResult.status : null
  const settingsReady = settingsResult?.source === apiRequest && settingsResult.ready
  function emailUnavailableReason() {
    if (developerPreview) return "开发者预览不支持邮箱授权、保存邮件凭据或真实发信。"
    if (!serverConnection) return "连接控制服务端后即可检查邮件通知设置。"
    if (!trustedEmailConnection) return "请通过 HTTPS 或本机回环地址连接控制服务端后配置邮件。"
    if (emailStatusResult?.source === apiRequest && !emailStatus) return "暂未检测到服务端邮件功能。请确认服务端已更新并重试。"
    if (emailStatus && !emailStatus.configurable) return emailStatus.reason || "当前控制服务端未启用邮件配置。"
    if (settingsResult?.source === apiRequest && !settingsResult.ready) return "未能读取已保存的邮件设置。请重试检查。"
    return null
  }

  const refreshEmailStatus = useCallback(async () => {
    if (!trustedEmailConnection || activeRequest.current !== apiRequest) return
    const revision = ++statusRevision.current
    let status: EmailStatus | null = null
    try { status = readEmailStatus(await apiRequest<unknown>("/email/status", { redirect: "error" })) } catch { /* 显示可重试的状态 */ }
    if (revision === statusRevision.current) setEmailStatusResult({ source: apiRequest, status })
  }, [apiRequest, trustedEmailConnection])

  const updateEmailStatus = useCallback((status: EmailStatus) => {
    if (activeRequest.current !== apiRequest) return
    statusRevision.current++
    setEmailStatusResult({ source: apiRequest, status })
  }, [apiRequest])

  const refreshSettings = useCallback(async (emailOnly = false) => {
    if (activeRequest.current !== apiRequest) return
    const revision = ++settingsRevision.current
    try {
      const remote = await apiRequest<unknown>("/settings", trustedEmailConnection ? { redirect: "error" } : undefined)
      if (revision !== settingsRevision.current) return
      const effective = applyRemoteSettings(remote, defaultSettings)
      setModel((current) => emailOnly ? {
        settings: { ...current.settings, email: syncSavedEmail(current.settings.email, current.saved.email, effective.email) },
        saved: { ...current.saved, email: effective.email },
      } : { settings: effective, saved: effective })
      setSettingsResult({ source: apiRequest, ready: true })
    } catch {
      if (revision === settingsRevision.current) setSettingsResult({ source: apiRequest, ready: false })
    }
  }, [apiRequest, trustedEmailConnection])

  useEffect(() => {
    activeRequest.current = apiRequest
    setSaving(false)
    setSaveError(null)
    setJustSaved(false)
    void refreshSettings()
    void refreshEmailStatus()
    return () => {
      activeRequest.current = null
      settingsRevision.current++
      statusRevision.current++
    }
  }, [apiRequest, refreshEmailStatus, refreshSettings])

  useEffect(() => {
    if (!justSaved) return
    const timer = setTimeout(() => setJustSaved(false), 2_000)
    return () => clearTimeout(timer)
  }, [justSaved])

  const retryEmailStatus = useCallback(async () => {
    await Promise.all([refreshEmailStatus(), settingsReady ? Promise.resolve() : refreshSettings(true)])
  }, [refreshEmailStatus, refreshSettings, settingsReady])

  const refreshMailState = useCallback(async () => {
    await Promise.all([refreshEmailStatus(), refreshSettings(true)])
  }, [refreshEmailStatus, refreshSettings])

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab")
    if (tabs.some((item) => item.id === requested)) setTab(requested as TabId)
  }, [])

  const switchTab = (next: TabId) => {
    if (next === tab) return
    if (local.settings.reduceMotion) {
      setEnterAnim("")
    } else {
      const from = tabs.findIndex((t) => t.id === tab)
      const to = tabs.findIndex((t) => t.id === next)
      // 药丸右移 → 新内容从右侧滑入；左移 → 从左侧滑入，与滑块同向
      setEnterAnim(to > from ? "animate-slide-in-right" : "animate-slide-in-left")
    }
    setTab(next)
    if (next === "notifications") void refreshEmailStatus()
  }
  const emailDirty = isEmailSettingsDirty(settings.email, saved.email)
  const canWriteEmail = trustedEmailConnection && emailStatus?.configurable === true && settingsReady
  const dirty = (canWriteEmail && emailDirty) || JSON.stringify(buildSettingsUpdate(settings, saved, false)) !== JSON.stringify(buildSettingsUpdate(saved, saved, false))

  const patch = <K extends keyof SettingsState>(key: K, value: Partial<SettingsState[K]>) =>
    setModel((model) => key === "email" && (!canWriteEmail || saving) ? model : {
      ...model, settings: { ...model.settings, [key]: { ...model.settings[key], ...value } },
    })

  const handleSave = async () => {
    if (saving) return
    setSaveError(null)
    setSaving(true)
    try {
      // 仅确认服务端支持新邮件契约后，才发送有改动的邮件分组。
      const update = buildSettingsUpdate(settings, saved, canWriteEmail)
      const remote = await apiRequest<unknown>("/settings", {
        method: "PUT",
        body: JSON.stringify(update),
        ...(update.email ? { redirect: "error" } as const : {}),
      })
      if (activeRequest.current !== apiRequest) return
      settingsRevision.current++
      const effective = applyRemoteSettings(remote, { ...settings, email: { ...saved.email, ...update.email } })
      setModel((model) => ({
        settings: settingsReady && emailDirty && !update.email ? { ...effective, email: syncSavedEmail(model.settings.email, model.saved.email, effective.email) } : effective,
        saved: effective,
      }))
      setSettingsResult({ source: apiRequest, ready: true })
      setJustSaved(true)
      if (update.email) void refreshEmailStatus()
    } catch (caught) {
      if (activeRequest.current === apiRequest) setSaveError(caught instanceof Error ? caught.message : "设置保存失败")
    } finally {
      if (activeRequest.current === apiRequest) setSaving(false)
    }
  }

  const handleReset = () => setModel((model) => ({ ...model, settings: model.saved }))

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden">
      {/* 选项卡 */}
      <SegmentedControl options={tabs} value={tab} onChange={switchTab} className="min-w-0 overflow-x-auto" />

      {/* 面板内容（可滚动，切换时按药卡方向平移进场） */}
      <div key={tab} className={cn("min-h-0 flex-1 overflow-auto pb-24 pr-1", enterAnim)}>
        {tab === "general" && (
          <GeneralPanel value={settings.general} onChange={(p) => patch("general", p)} />
        )}
        {tab === "connection" && <ConnectionPanel />}
        {tab === "notifications" && (
          <NotificationsPanel
            email={{
              value: settings.email,
              saved: saved.email,
              dirty: emailDirty,
              status: canWriteEmail ? emailStatus : null,
              unavailable: emailUnavailableReason(),
              refreshStatus: trustedEmailConnection ? (settingsReady ? refreshEmailStatus : retryEmailStatus) : undefined,
              refreshMailState,
              onStatusUpdate: updateEmailStatus,
              saving,
              onChange: (p) => patch("email", p),
            }}
            conditions={settings.conditions}
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
        {tab === "updates" && <UpdatesPanel />}
        {tab === "about" && <AboutPanel onOpenUpdates={() => switchTab("updates")} />}
      </div>

      {/* 底部保存条：有改动时浮现（AI Mode 即时生效，不走保存流程） */}
      {tab !== "about" && tab !== "ai" && tab !== "connection" && tab !== "updates" && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-4"
          style={{ zIndex: 40 }}
        >
          <div
            className="pointer-events-auto flex max-w-full flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-xl backdrop-blur transition-all duration-300"
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
                {saveError ? <span role="alert" className="min-w-0 basis-full break-words text-sm text-negative">{saveError}</span> : <span className="hidden text-sm text-muted-foreground sm:block">你有未保存的更改</span>}
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
