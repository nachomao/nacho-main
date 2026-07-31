import { LogsView } from "@/components/logs/logs-view"

export default function LogsPage() {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">系统日志</h1>
          <p className="mt-1 text-sm text-muted-foreground">实时查看各客户端与服务端的运行日志，支持级别筛选、来源过滤与实时跟随</p>
        </div>
      </div>

      <LogsView />
    </>
  )
}
