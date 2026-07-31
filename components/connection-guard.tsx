"use client"

import Link from "next/link"
import { RefreshCw, ServerOff, Settings2 } from "lucide-react"
import { useServerData } from "@/components/server-data-context"

export function ConnectionGuard() {
  const { overview, error, refreshing, refresh } = useServerData()

  // 首次连接失败由 StartupSplash 处理；这里只提示运行期间掉线。
  if (!overview || !error) return null

  const lastSync = new Date(overview.updatedAt).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

  return (
    <aside
      role="alert"
      aria-label="服务端连接已断开"
      className="pointer-events-none fixed inset-x-4 top-4 z-[90] flex justify-center sm:left-auto sm:right-6 sm:top-6"
    >
      <div className="pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-2xl border border-negative/30 bg-card/95 p-4 shadow-2xl backdrop-blur-md sm:w-auto sm:min-w-[34rem]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-negative/12 text-negative">
          <ServerOff className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">服务端连接已断开</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{error}</p>
          <p className="mt-1 text-xs text-muted-foreground/75">
            当前显示 {lastSync} 的缓存数据，页面浏览和连接设置仍可使用。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition-colors hover:brightness-105 disabled:pointer-events-none disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "正在连接" : "重新连接"}
            </button>
            <Link
              href="/settings?tab=connection"
              className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface/70 px-3.5 text-xs font-medium text-foreground transition-colors hover:bg-surface"
            >
              <Settings2 className="h-3.5 w-3.5" />
              连接设置
            </Link>
            <span className="text-[11px] text-muted-foreground/60">每 10 秒自动检测</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
