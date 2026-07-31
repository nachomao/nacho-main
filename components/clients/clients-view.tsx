"use client"

import { useEffect, useRef } from "react"
import { clientTabs, useClientTabs } from "./clients-context"

export function ClientsView() {
  const ctx = useClientTabs()
  // 首次渲染（即从其他路由进入 /clients 时本组件刚挂载）标记：
  // 此时不播放面板的整屏上滑动画，交给路由级 PageTransition 统一做模糊淡入，
  // 避免「整屏 translateY(100%) 上滑」与「路由模糊淡入」两套方向不同的动画叠加打架。
  const firstRender = useRef(true)
  useEffect(() => {
    firstRender.current = false
  }, [])

  if (!ctx) return null

  const { active, exiting, direction } = ctx
  const ActivePanel = clientTabs[active].Panel
  const ExitingPanel = exiting != null ? clientTabs[exiting].Panel : null
  // 根据切换方向选择动画：往后切（direction=1）卡片上移、下面贴上来；
  // 往前切（direction=-1）卡片下移、上面贴下来。
  // 仅在页面内部切换标签时才播放进场动画；路由首次进入时不加，交给 PageTransition。
  const enterClass = firstRender.current ? "" : direction === 1 ? "animate-panel-enter" : "animate-panel-enter-down"
  const exitClass = direction === 1 ? "animate-panel-exit" : "animate-panel-exit-down"

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* 卡片切换区：overflow-hidden 让卡片在边界内做平移传送动画 */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {ExitingPanel && (
          <div key={`exit-${exiting}`} className={`${exitClass} absolute inset-0`}>
            <ExitingPanel />
          </div>
        )}
        <div key={`active-${active}`} className={`${enterClass} absolute inset-0`}>
          <ActivePanel />
        </div>
      </div>
    </div>
  )
}
