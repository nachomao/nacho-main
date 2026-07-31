"use client"

import { useRef, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import type { LucideIcon } from "lucide-react"
import {
  Home,
  MonitorSmartphone,
  FileCode,
  Puzzle,
  CalendarClock,
  HeartPulse,
  ScrollText,
  Settings,
  LogOut,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useOnboarding } from "@/components/onboarding/onboarding-context"
import { BrandLogo } from "@/components/brand-logo"

const topItems = [
  { id: "home", icon: Home, label: "首页", href: "/" },
  { id: "clients", icon: MonitorSmartphone, label: "客户端", href: "/clients" },
  { id: "scripts", icon: FileCode, label: "脚本安装", href: "/scripts" },
  { id: "plugins", icon: Puzzle, label: "插件管理", href: "/plugins" },
  { id: "tasks", icon: CalendarClock, label: "计划任务", href: "/tasks" },
  { id: "health", icon: HeartPulse, label: "健康中心", href: "/health" },
  { id: "logs", icon: ScrollText, label: "系统日志", href: "/logs" },
]

type NavItemData = { id: string; icon: LucideIcon; label: string; href: string }

function NavItem({
  item,
  isActive,
  onSelect,
  onPrefetch,
}: {
  item: NavItemData
  isActive: boolean
  onSelect: (item: NavItemData) => void
  onPrefetch?: (item: NavItemData) => void
}) {
  const [hovered, setHovered] = useState(false)
  // 点击时的脉冲缩放：图标先变小再弹回
  const [pulsing, setPulsing] = useState(false)
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClick = () => {
    // 文字缩回（下面图标靠回去），随后图标做点击脉冲
    setHovered(false)
    setPulsing(true)
    if (pulseTimer.current) clearTimeout(pulseTimer.current)
    pulseTimer.current = setTimeout(() => setPulsing(false), 180)
    onSelect(item)
  }

  const chars = Array.from(item.label)

  return (
    <div
      className="flex flex-col items-center"
      onMouseEnter={() => {
        setHovered(true)
        // 悬浮即预取目标路由，点击时 bundle 已就绪，减少切换延迟
        onPrefetch?.(item)
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        aria-label={item.label}
        aria-current={isActive ? "page" : undefined}
        onClick={handleClick}
        className={cn(
          "group relative flex h-12 w-12 items-center justify-center rounded-full transition-all duration-300 ease-out",
          isActive
            ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
            : "text-muted-foreground hover:bg-surface hover:text-foreground",
          // 点击脉冲优先级最高：先缩到 90%，结束后回到正常/悬浮尺寸
          pulsing ? "scale-90" : "hover:scale-110",
        )}
      >
        {/* 左侧高亮小长条（沿用原有动画） */}
        <span
          className={cn(
            "absolute -left-3 h-7 w-1 rounded-full bg-primary transition-all duration-300 ease-out",
            isActive ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0",
          )}
        />
        <item.icon
          className={cn(
            "h-5 w-5 transition-transform duration-300",
            pulsing ? "scale-90" : isActive ? "scale-110" : "group-hover:scale-110",
          )}
        />
      </button>

      {/* 悬浮展开的功能名称：下方图标让出空间，文字逐字由浅到深显现并消除模糊 */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-300 ease-out",
          hovered ? "mt-1.5 max-h-7 opacity-100" : "mt-0 max-h-0 opacity-0",
        )}
      >
        <span className="flex whitespace-nowrap text-xs font-medium leading-none text-foreground">
          {chars.map((ch, i) => (
            <span
              key={i}
              className="inline-block transition-all duration-200 ease-out"
              style={{
                opacity: hovered ? 1 : 0,
                filter: hovered ? "blur(0px)" : "blur(3px)",
                transform: hovered ? "translateY(0)" : "translateY(2px)",
                transitionDelay: hovered ? `${120 + i * 55}ms` : "0ms",
              }}
            >
              {ch}
            </span>
          ))}
        </span>
      </div>
    </div>
  )
}

export function Sidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const { lock } = useOnboarding()

  // 仅这些路由已实际存在，避免预取/跳转到尚未创建的页面
  const liveRoutes = new Set(["/", "/clients", "/scripts", "/plugins", "/tasks", "/health", "/logs", "/settings"])

  const goSettings = () => {
    if (pathname !== "/settings") router.push("/settings")
  }

  const handleSelect = (item: NavItemData) => {
    if (item.href !== pathname && liveRoutes.has(item.href)) router.push(item.href)
  }

  const handlePrefetch = (item: NavItemData) => {
    if (item.href !== pathname && liveRoutes.has(item.href)) router.prefetch(item.href)
  }

  // 高亮跟随当前路径：精确匹配首页，其余按前缀匹配
  const isItemActive = (item: NavItemData) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)

  return (
    <aside className="flex w-20 shrink-0 flex-col items-center justify-between py-6">
      <div className="flex flex-col items-center gap-8">
        {/* Logo - NachoNeko（全局品牌 Logo 组件） */}
        <div className="group flex h-11 w-11 cursor-pointer items-center justify-center transition-transform duration-300 hover:scale-110">
          <BrandLogo className="h-11 w-11" />
        </div>

        {/* Nav items */}
        <nav className="relative flex flex-col items-center gap-3">
          {topItems.map((item) => (
            <NavItem
              key={item.id}
              item={item}
              isActive={isItemActive(item)}
              onSelect={handleSelect}
              onPrefetch={handlePrefetch}
            />
          ))}
        </nav>
      </div>

      <div className="flex flex-col items-center gap-3">
        <button
          aria-label="设置"
          aria-current={pathname.startsWith("/settings") ? "page" : undefined}
          onClick={goSettings}
          onMouseEnter={() => pathname !== "/settings" && router.prefetch("/settings")}
          className={cn(
            "group flex h-12 w-12 items-center justify-center rounded-full transition-all duration-300 hover:scale-110 active:scale-90",
            pathname.startsWith("/settings")
              ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
              : "text-muted-foreground hover:bg-surface hover:text-foreground",
          )}
        >
          <Settings className="h-5 w-5 transition-transform duration-500 group-hover:rotate-90" />
        </button>
        <button
          aria-label="退出登录"
          onClick={lock}
          className="group flex h-12 w-12 items-center justify-center rounded-full text-muted-foreground transition-all duration-300 hover:scale-110 hover:bg-surface hover:text-foreground active:scale-90"
        >
          <LogOut className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-0.5" />
        </button>
      </div>
    </aside>
  )
}
