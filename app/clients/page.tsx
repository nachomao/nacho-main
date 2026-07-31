import { ClientsView } from "@/components/clients/clients-view"

export default function ClientsPage() {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">客户端管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">管理多个客户端、分组与版本更新</p>
        </div>
      </div>

      <ClientsView />
    </>
  )
}
