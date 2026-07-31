import { HealthView } from "@/components/health/health-view"

export default function HealthPage() {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">系统健康中心</h1>
          <p className="mt-1 text-sm text-muted-foreground">异常日志包、分析命中项和未读告警集中处理</p>
        </div>
      </div>

      <HealthView />
    </>
  )
}
