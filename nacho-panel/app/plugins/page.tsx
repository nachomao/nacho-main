import { PluginsView } from "@/components/plugins/plugins-view"

export default function PluginsPage() {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">插件管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">导入、下载、编辑、删除与批量安装客户端插件</p>
        </div>
      </div>

      <PluginsView />
    </>
  )
}
