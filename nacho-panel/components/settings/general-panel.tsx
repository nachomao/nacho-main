"use client"

import { Gauge, Timer, TerminalSquare, Archive, Database } from "lucide-react"
import { SettingCard, SettingRow, NumberStepper, Toggle } from "./primitives"
import { AppearanceCard } from "./appearance-card"
import type { GeneralSettings } from "./settings-data"

export function GeneralPanel({
  value,
  onChange,
}: {
  value: GeneralSettings
  onChange: (patch: Partial<GeneralSettings>) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* 外观主题 */}
      <AppearanceCard />

      {/* 并发与超时 */}
      <SettingCard
        title="并发与超时"
        desc="控制服务端下发任务的并发规模与各类超时阈值"
        icon={<Gauge className="h-5 w-5" />}
      >
        <SettingRow
          label="客户端并发任务数"
          hint="单个客户端同时执行的最大任务数量，超出的任务将进入队列排队等待。"
          htmlFor="concurrency"
        >
          <NumberStepper
            id="concurrency"
            value={value.concurrency}
            onChange={(v) => onChange({ concurrency: v })}
            min={1}
            max={64}
            unit="个"
          />
        </SettingRow>

        <SettingRow
          label="主通道超时时间"
          hint="客户端与服务端主控制通道的心跳超时，超过该时长未响应则判定通道断开。"
          htmlFor="channel-timeout"
        >
          <NumberStepper
            id="channel-timeout"
            value={value.channelTimeout}
            onChange={(v) => onChange({ channelTimeout: v })}
            min={5}
            max={600}
            step={5}
            unit="秒"
          />
        </SettingRow>

        <SettingRow
          label="默认命令超时时间"
          hint="未单独指定超时的命令 / 脚本任务的默认执行超时，超时后将被强制终止。"
          htmlFor="cmd-timeout"
        >
          <NumberStepper
            id="cmd-timeout"
            value={value.commandTimeout}
            onChange={(v) => onChange({ commandTimeout: v })}
            min={10}
            max={3600}
            step={10}
            unit="秒"
          />
        </SettingRow>

        <SettingRow
          label="任务失败自动重试"
          hint="任务因超时或异常失败后，按下述次数自动重试。"
        >
          <NumberStepper
            value={value.retryCount}
            onChange={(v) => onChange({ retryCount: v })}
            min={0}
            max={10}
            unit="次"
          />
        </SettingRow>
      </SettingCard>

      {/* 日志留存 */}
      <SettingCard
        title="日志留存策略"
        desc="服务端运行日志的保留时长与容量上限，超限后按时间从旧到新自动清理"
        icon={<Archive className="h-5 w-5" />}
      >
        <SettingRow
          label="日志保留时间"
          hint="超过该天数的日志将被自动清理，设为 0 表示不按时间清理。"
          htmlFor="log-retention-days"
        >
          <NumberStepper
            id="log-retention-days"
            value={value.logRetentionDays}
            onChange={(v) => onChange({ logRetentionDays: v })}
            min={0}
            max={365}
            unit="天"
          />
        </SettingRow>

        <SettingRow
          label="日志保留最大条目"
          hint="日志表的最大条目数，达到上限后写入新日志会淘汰最旧记录。"
          htmlFor="log-retention-max"
        >
          <NumberStepper
            id="log-retention-max"
            value={value.logRetentionMax}
            onChange={(v) => onChange({ logRetentionMax: v })}
            min={1000}
            max={1000000}
            step={1000}
            unit="条"
          />
        </SettingRow>

        <SettingRow
          label="压缩归档过期日志"
          hint="清理前先将过期日志打包为 zip 归档保存到服务端磁盘，便于事后审计。"
        >
          <Toggle checked={value.compressArchive} onChange={(v) => onChange({ compressArchive: v })} />
        </SettingRow>
      </SettingCard>

      {/* 运行行为 */}
      <SettingCard
        title="运行行为"
        desc="服务端的时区与客户端离线判定等基础行为"
        icon={<Timer className="h-5 w-5" />}
      >
        <SettingRow
          label="客户端离线判定时长"
          hint="客户端连续未上报心跳超过该时长即标记为「离线」。"
        >
          <NumberStepper
            value={value.offlineThreshold}
            onChange={(v) => onChange({ offlineThreshold: v })}
            min={10}
            max={600}
            step={5}
            unit="秒"
          />
        </SettingRow>

        <SettingRow
          label="服务端时区"
          hint="日志时间戳与计划任务调度所使用的基准时区。"
        >
          <div className="flex h-10 items-center gap-2 rounded-xl border border-border bg-surface/60 px-3.5 text-sm text-foreground">
            <Database className="h-4 w-4 text-muted-foreground" />
            <select
              value={value.timezone}
              onChange={(e) => onChange({ timezone: e.target.value })}
              className="bg-transparent pr-2 outline-none"
              aria-label="服务端时区"
            >
              <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
              <option value="UTC">UTC (UTC+0)</option>
              <option value="America/New_York">America/New_York (UTC-5)</option>
              <option value="Europe/London">Europe/London (UTC+0)</option>
            </select>
          </div>
        </SettingRow>

        <SettingRow
          label="自动清理已完成任务"
          hint="定期清理执行结束且无异常的历史任务记录，减轻数据库压力。"
        >
          <Toggle checked={value.autoCleanTasks} onChange={(v) => onChange({ autoCleanTasks: v })} />
        </SettingRow>
      </SettingCard>
    </div>
  )
}
