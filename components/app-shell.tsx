"use client"

import type { ReactNode } from "react"
import { Sidebar } from "@/components/sidebar"
import { Topbar } from "@/components/topbar"
import { PageTransition } from "@/components/page-transition"
import { ClientTabsProvider } from "@/components/clients/clients-context"
import { PluginsProvider } from "@/components/plugins/plugins-context"
import { TasksProvider } from "@/components/tasks/tasks-context"
import { LogsProvider } from "@/components/logs/logs-context"
import { TopbarActionsProvider } from "@/components/topbar/topbar-actions-context"
import { OnboardingProvider, useOnboarding } from "@/components/onboarding/onboarding-context"
import { Onboarding } from "@/components/onboarding/onboarding"
import { AIModeProvider, useAIMode } from "@/components/ai-mode/ai-mode-context"
import { AIWorkspace } from "@/components/ai-mode/ai-workspace"
import { ServerDataProvider } from "@/components/server-data-context"
import { StartupSplash } from "@/components/startup-splash"
import { StartupMotionProvider, useStartupMotion } from "@/components/startup-motion-context"
import { ConnectionGuard } from "@/components/connection-guard"

/**
 * 主页载入：引导覆盖层上滑离场时，下方主页以 iOS 解锁的姿态浮现——
 * 从轻微放大 + 模糊状态平滑还原为清晰原尺寸。
 * 进入 AI Mode 时，整个应用界面向后退场（缩小 + 模糊），AI 工作台浮现。
 */
function ShellContent({ children }: { children: ReactNode }) {
  const { phase } = useOnboarding()
  const { shellRecessed } = useAIMode()
  const { covered: startupCovered } = useStartupMotion()
  const covered = startupCovered || phase === "intro" || phase === "locked" // 覆盖层完整遮挡时保持待命姿态

  return (
    <div
      className="h-full w-full overflow-hidden bg-[oklch(0.14_0.02_150)] p-3 sm:p-5"
      style={{
        // AI Mode 向后退（缩小），引导覆盖时向前贴（放大）——两种退场姿态方向相反
        transform: covered ? "scale(1.08)" : shellRecessed ? "scale(0.94)" : "scale(1)",
        filter: covered ? "blur(18px)" : shellRecessed ? "blur(14px)" : "blur(0px)",
        opacity: covered ? 0.6 : shellRecessed ? 0.45 : 1,
        // 进入与退出 AI Mode 使用同一条舒缓曲线，模糊变暗/还原的节奏保持一致
        transition:
          "transform 1200ms cubic-bezier(0.32, 0.72, 0.24, 1), filter 1200ms cubic-bezier(0.32, 0.72, 0.24, 1), opacity 950ms ease",
      }}
      aria-hidden={covered || shellRecessed}
    >
      <div className="flex h-full gap-2 rounded-[2rem] bg-background p-3 sm:p-4">
        <Sidebar />

        <ClientTabsProvider>
          <PluginsProvider>
            <TasksProvider>
              <LogsProvider>
                <TopbarActionsProvider>
                  <main className="flex flex-1 flex-col gap-4 overflow-hidden pr-1 pt-2">
                    <Topbar />
                    <PageTransition>{children}</PageTransition>
                  </main>
                </TopbarActionsProvider>
              </LogsProvider>
            </TasksProvider>
          </PluginsProvider>
        </ClientTabsProvider>
      </div>
    </div>
  )
}

/**
 * 持久化应用外壳：侧边栏、顶栏与外层容器在路由切换时保持挂载，
 * 仅替换 main 内的页面内容；首次进入时先播放引导覆盖层。
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <OnboardingProvider>
      <ServerDataProvider>
        <StartupMotionProvider>
          <AIModeProvider>
            <ShellContent>{children}</ShellContent>
            <AIWorkspace />
          </AIModeProvider>
          <ConnectionGuard />
          <StartupSplash />
        </StartupMotionProvider>
      </ServerDataProvider>
      <Onboarding />
    </OnboardingProvider>
  )
}
