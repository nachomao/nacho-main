import { SettingsView } from "@/components/settings/settings-view"

export default function SettingsPage() {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">系统设置</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            配置服务端连接、常规参数、通知策略、安全鉴权，并查看面板版本信息
          </p>
        </div>
      </div>

      <SettingsView />
    </>
  )
}
