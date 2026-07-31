import { ScriptsView } from "@/components/scripts/scripts-view"

export default function ScriptsPage() {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">脚本安装</h1>
          <p className="mt-1 text-sm text-muted-foreground">配置安装参数、生成 install.ps1 并维护脚本代码</p>
        </div>
      </div>

      <ScriptsView />
    </>
  )
}
