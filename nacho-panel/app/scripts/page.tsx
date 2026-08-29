import { ScriptsView } from "@/components/scripts/scripts-view"

export default function ScriptsPage() {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">脚本安装</h1>
          <p className="mt-1 text-sm text-muted-foreground">维护真实安装档案、部署模式、客户端参数与版本历史</p>
        </div>
      </div>

      <ScriptsView />
    </>
  )
}
