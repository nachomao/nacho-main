"use client"

import { BellRing, WifiOff, CircleX, Cpu, MemoryStick, HardDrive, MoonStar, Download } from "lucide-react"
import { cn } from "@/lib/utils"
import { SettingCard, SettingRow, Toggle, NumberStepper, ThresholdSlider } from "./primitives"
import { EmailNotificationSettings, type EmailNotificationSettingsProps } from "./email-notification-settings"
import type { NotifyConditions } from "./settings-data"
import type { NotificationCenterSettings } from "@/lib/local-settings-schema"
import { useServerData } from "@/components/server-data-context"

/* 通知条件项：图标 + 标题 + 开关，展开可含阈值滑块 */
function ConditionRow({
  icon,
  tone,
  label,
  hint,
  enabled,
  onToggle,
  children,
}: {
  icon: React.ReactNode
  tone: "primary" | "warning" | "negative"
  label: string
  hint: string
  enabled: boolean
  onToggle: (v: boolean) => void
  children?: React.ReactNode
}) {
  const toneCls = {
    primary: "text-primary bg-primary/12",
    warning: "text-warning bg-warning/15",
    negative: "text-negative bg-negative/15",
  }[tone]
  return (
    <div className="flex flex-col gap-3 border-t border-border py-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", toneCls)}>{icon}</span>
          <div className="leading-tight">
            <p className="text-sm font-medium">{label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
          </div>
        </div>
        <Toggle checked={enabled} onChange={onToggle} label={label} />
      </div>
      {enabled && children && <div className="pl-12">{children}</div>}
    </div>
  )
}

function ConditionsBlock({
  value,
  onChange,
}: {
  value: NotifyConditions
  onChange: (patch: Partial<NotifyConditions>) => void
}) {
  return (
    <SettingCard
      title="通知条件"
      desc="选择在哪些事件发生时触发通知，并为资源类告警设置阈值"
      icon={<BellRing className="h-5 w-5" />}
    >
      <ConditionRow
        icon={<WifiOff className="h-5 w-5" />}
        tone="negative"
        label="客户端离线"
        hint="任一客户端心跳超时被标记为离线时通知。"
        enabled={value.clientOffline}
        onToggle={(v) => onChange({ clientOffline: v })}
      />
      <ConditionRow
        icon={<CircleX className="h-5 w-5" />}
        tone="negative"
        label="任务失败"
        hint="计划任务或命令执行失败（含重试耗尽）时通知。"
        enabled={value.taskFailed}
        onToggle={(v) => onChange({ taskFailed: v })}
      />
      <ConditionRow
        icon={<Cpu className="h-5 w-5" />}
        tone="warning"
        label="CPU 告警"
        hint="客户端 CPU 使用率持续超过阈值时通知。"
        enabled={value.cpuAlert}
        onToggle={(v) => onChange({ cpuAlert: v })}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">CPU 告警阈值</span>
          <ThresholdSlider
            value={value.cpuThreshold}
            onChange={(v) => onChange({ cpuThreshold: v })}
            tone="warning"
          />
        </div>
      </ConditionRow>
      <ConditionRow
        icon={<MemoryStick className="h-5 w-5" />}
        tone="warning"
        label="内存告警"
        hint="客户端内存占用超过阈值时通知。"
        enabled={value.memAlert}
        onToggle={(v) => onChange({ memAlert: v })}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">内存告警阈值</span>
          <ThresholdSlider
            value={value.memThreshold}
            onChange={(v) => onChange({ memThreshold: v })}
            tone="warning"
          />
        </div>
      </ConditionRow>
      <ConditionRow
        icon={<HardDrive className="h-5 w-5" />}
        tone="warning"
        label="磁盘告警"
        hint="任一磁盘分区占用超过阈值时通知。"
        enabled={value.diskAlert}
        onToggle={(v) => onChange({ diskAlert: v })}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">磁盘告警阈值</span>
          <ThresholdSlider
            value={value.diskThreshold}
            onChange={(v) => onChange({ diskThreshold: v })}
            tone="negative"
          />
        </div>
      </ConditionRow>
      <ConditionRow
        icon={<MoonStar className="h-5 w-5" />}
        tone="primary"
        label="免打扰时段"
        hint="每日 23:00 – 07:00 仅记录不推送（严重告警除外）。"
        enabled={value.quietHours}
        onToggle={(v) => onChange({ quietHours: v })}
      />
    </SettingCard>
  )
}

export function NotificationsPanel({
  email,
  conditions,
  onConditionsChange,
  notificationCenter,
  onNotificationCenterChange,
}: {
  email: EmailNotificationSettingsProps
  conditions: NotifyConditions
  onConditionsChange: (patch: Partial<NotifyConditions>) => void
  notificationCenter: NotificationCenterSettings
  onNotificationCenterChange: (patch: Partial<NotificationCenterSettings>) => void
}) {
  const { downloadRequest, apiRequest } = useServerData()
  return (
    <div className="flex flex-col gap-4">
      <SettingCard title="通知中心" desc="告警保留、稍后提醒和导出设置保存在当前面板" icon={<BellRing className="h-5 w-5" />}>
        <SettingRow label="最大保存条目" hint="优先清理最旧的已读通知" htmlFor="notification-max-items"><NumberStepper id="notification-max-items" value={notificationCenter.maxItems} onChange={(v) => onNotificationCenterChange({ maxItems: v })} min={100} max={1000} step={50} unit="条" /></SettingRow>
        <SettingRow label="保存时长" htmlFor="notification-retention-days"><NumberStepper id="notification-retention-days" value={notificationCenter.retentionDays} onChange={(v) => onNotificationCenterChange({ retentionDays: v })} min={1} max={90} unit="天" /></SettingRow>
        <SettingRow label="自动清理已读/过期通知"><Toggle checked={notificationCenter.autoPurge} onChange={(v) => onNotificationCenterChange({ autoPurge: v })} label="自动清理" /></SettingRow>
        <SettingRow label="默认稍后提醒" htmlFor="notification-snooze"><NumberStepper id="notification-snooze" value={notificationCenter.defaultSnoozeMinutes} onChange={(v) => onNotificationCenterChange({ defaultSnoozeMinutes: v })} min={1} max={1440} unit="分钟" /></SettingRow>
        <SettingRow label="导出格式"><div className="flex gap-1 rounded-full border border-border p-1">{(["json", "csv"] as const).map((format) => <button key={format} type="button" onClick={() => onNotificationCenterChange({ exportFormat: format })} className={cn("rounded-full px-3 py-1.5 text-xs", notificationCenter.exportFormat === format ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{format.toUpperCase()}</button>)}</div></SettingRow>
        <SettingRow label="严重错误同时弹出"><Toggle checked={notificationCenter.showCriticalAsToast} onChange={(v) => onNotificationCenterChange({ showCriticalAsToast: v })} label="严重错误弹窗" /></SettingRow>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4"><button type="button" onClick={() => void downloadRequest(`/notifications?export=true&format=${notificationCenter.exportFormat}&retentionDays=${notificationCenter.retentionDays}&maxItems=${notificationCenter.maxItems}&autoPurge=${notificationCenter.autoPurge}`, `notifications.${notificationCenter.exportFormat}`)} className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground"><Download className="h-4 w-4" />立即导出</button><button type="button" onClick={() => void apiRequest("/notifications/purge", { method: "POST", body: JSON.stringify({ retentionDays: notificationCenter.retentionDays }) })} className="h-9 rounded-xl border border-border px-3 text-xs">清理已读/过期通知</button></div>
      </SettingCard>
      <EmailNotificationSettings {...email} />
      <ConditionsBlock value={conditions} onChange={onConditionsChange} />
    </div>
  )
}
