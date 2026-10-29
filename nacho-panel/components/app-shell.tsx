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
import { Orb } from "@/components/orb"

/**
 * 主页载入：引导覆盖层上滑离场时，下方主页以 iOS 解锁的姿态浮现——
 * 从轻微放大 + 模糊状态平滑还原为清晰原尺寸。
 * 进入 AI Mode 时，整个应用界面向后退场（缩小 + 模糊），AI 工作台浮现。
 */
function ShellContent({ children }: { children: ReactNode }) {
  const { phase } = useOnboarding()
  const { shellRecessed } = useAIMode()
  const { covered: startupCovered } = useStartupMotion()
  const covered = startupCovered || phase === "intro" || phase === "locked" || phase === "recovery"

  return (
    <div
      className="electron-drag-region h-full w-full overflow-hidden bg-[oklch(0.14_0.02_150)] p-3 sm:p-5"
      style={{
        // AI Mode 向深景深退场（纯合成器 3D 缩退 + 压暗，避免全屏 DOM 逐帧高斯模糊重栅格化卡顿）
        transform: covered
          ? "scale(1.08)"
          : shellRecessed
            ? "perspective(1600px) scale(0.92) translateY(10px) rotateX(1.8deg)"
            : "perspective(1600px) scale(1) translateY(0px) rotateX(0deg)",
        filter: covered ? "blur(18px)" : "blur(0px)",
        opacity: covered ? 0.6 : shellRecessed ? 0.22 : 1,
        // 进入与退出 AI Mode 使用高响应空间阻尼曲线，退场与还原节奏紧致丝滑
        transition:
          "transform 760ms cubic-bezier(0.16, 1, 0.3, 1), filter 760ms cubic-bezier(0.16, 1, 0.3, 1), opacity 540ms ease-out",
      }}
      aria-hidden={covered || shellRecessed}
      inert={covered || shellRecessed}
    >
      <div className="electron-no-drag relative isolate flex h-full min-w-0 gap-2 overflow-hidden rounded-[2rem] bg-background/92 p-3 sm:p-4">
        <Orb
          className="pointer-events-none absolute inset-0 z-0 rounded-[2rem] opacity-[0.35]"
          hoverIntensity={0}
          rotateOnHover
          hue={0}
          forceHoverState={false}
          backgroundColor="#000000"
        />
        <div className="relative z-10 flex min-h-0 min-w-0 flex-1 gap-2">
          <Sidebar />

          <ClientTabsProvider>
            <PluginsProvider>
              <TasksProvider>
                <LogsProvider>
                  <TopbarActionsProvider>
                    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden pr-1 pt-2">
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
      <div className="electron-window-drag-edge electron-window-drag-edge-top" aria-hidden="true" />
      <div className="electron-window-drag-edge electron-window-drag-edge-right" aria-hidden="true" />
      <div className="electron-window-drag-edge electron-window-drag-edge-bottom" aria-hidden="true" />
      <div className="electron-window-drag-edge electron-window-drag-edge-left" aria-hidden="true" />
    </OnboardingProvider>
  )
}
