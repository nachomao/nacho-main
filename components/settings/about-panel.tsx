"use client"

import { Info, Cpu, ScrollText, Sparkles, GitBranch, ExternalLink, HeartPulse } from "lucide-react"
import { SettingCard, InfoRow } from "./primitives"
import { aboutInfo } from "./settings-data"
import { BrandLogo } from "@/components/brand-logo"

export function AboutPanel() {
  return (
    <div className="flex flex-col gap-4">
      {/* 品牌头 */}
      <section className="card-glow flex flex-col items-center gap-4 rounded-3xl bg-card p-8 text-center sm:flex-row sm:text-left">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center">
          <BrandLogo className="h-12 w-12" />
        </div>
        <div className="flex-1 leading-tight">
          <h2 className="text-xl font-bold">{aboutInfo.panelName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            轻量、跨平台的分布式客户端与任务集中管理面板
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <span className="flex items-center gap-1 rounded-full bg-primary/12 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              {aboutInfo.serverVersion}
            </span>
            <span className="flex items-center gap-1 rounded-full bg-surface px-3 py-1 text-xs font-medium text-muted-foreground">
              <HeartPulse className="h-3.5 w-3.5" />
              运行正常
            </span>
          </div>
        </div>
      </section>

      {/* 版本信息 */}
      <SettingCard title="版本信息" desc="当前面板的版本与构建详情" icon={<Info className="h-5 w-5" />}>
        <InfoRow label="面板名称" value={aboutInfo.panelName} />
        <InfoRow
          label="服务端版本"
          value={aboutInfo.serverVersion}
          mono
          badge={
            <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary">最新</span>
          }
        />
        <InfoRow label="构建日期" value={aboutInfo.buildDate} mono />
        <InfoRow label="Git Commit" value={aboutInfo.commit} mono />
        <InfoRow
          label="许可证"
          value={aboutInfo.license}
          badge={
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground transition-colors hover:text-primary"
              aria-label="查看许可证"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          }
        />
      </SettingCard>

      {/* 技术栈 */}
      <SettingCard title="技术栈" desc="面板所依赖的运行环境与框架" icon={<Cpu className="h-5 w-5" />}>
        <InfoRow label="框架" value={aboutInfo.framework} />
        <InfoRow label="UI 组件库" value={aboutInfo.uiLibrary} />
        <InfoRow label="运行环境" value={aboutInfo.runtime} mono />
      </SettingCard>

      {/* 资源链接 */}
      <SettingCard title="资源与支持" desc="文档、源码与开源许可" icon={<ScrollText className="h-5 w-5" />}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { icon: <GitBranch className="h-5 w-5" />, label: "源码仓库", sub: "GitHub" },
            { icon: <ScrollText className="h-5 w-5" />, label: "使用文档", sub: "Docs" },
            { icon: <Info className="h-5 w-5" />, label: "更新日志", sub: "Changelog" },
          ].map((l) => (
            <a
              key={l.label}
              href="#"
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface/60 px-4 py-3.5 transition-colors hover:bg-surface"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
                {l.icon}
              </span>
              <div className="leading-tight">
                <p className="text-sm font-medium">{l.label}</p>
                <p className="text-xs text-muted-foreground">{l.sub}</p>
              </div>
            </a>
          ))}
        </div>
      </SettingCard>

      <p className="pb-2 text-center text-xs text-muted-foreground">
        © 2026 NachoNeko · 遵循 {aboutInfo.license} 开源协议发布
      </p>
    </div>
  )
}
