import { TasksView } from "@/components/tasks/tasks-view"

export default function TasksPage() {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">批量计划任务</h1>
          <p className="mt-1 text-sm text-muted-foreground">在多台 Windows 客户端上创建和管理计划任务</p>
        </div>
      </div>

      <TasksView />
    </>
  )
}
