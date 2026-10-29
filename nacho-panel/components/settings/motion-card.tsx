"use client"

import { Activity } from "lucide-react"
import { SettingCard, Toggle } from "./primitives"
import { useMotionPreference } from "@/lib/motion-preference"
import { cn } from "@/lib/utils"

/**
 * 削弱动画效果设置项（系统设置 → 常规）：
 * - 标题：削弱动画效果
 * - 说明：减少界面过渡动效、卡片形变与背景光效，降低视觉干扰
 * - 默认状态：关闭（默认始终开启完整的流畅动效与 AI 卡片变形，不再受 Windows 系统开关的被动干扰）
 * - 开启后：全局削弱大面积运动与复杂动效（方便偏好静止界面或低性能消耗的用户）
 * - 实时生效：切换开关时立刻生效，无需重启面板
 */
export function MotionCard() {
  const { reduceMotion, setReduceMotion } = useMotionPreference()

  return (
    <SettingCard
      title="削弱动画效果"
      desc="减少界面过渡动效、卡片形变与背景光效，降低视觉干扰"
      icon={<Activity className="h-5 w-5" />}
      action={
        <Toggle
          id="reduce-motion-toggle"
          checked={reduceMotion}
          onChange={(val) => void setReduceMotion(val)}
          label="削弱动画效果"
        />
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          {reduceMotion
            ? "已全局削弱界面过渡动效、卡片形变与背景光效，降低视觉干扰"
            : "默认开启完整的流畅动效与 AI 卡片变形，不再受 Windows 系统开关的被动干扰"}
        </span>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 font-medium transition-colors",
            reduceMotion
              ? "bg-primary/10 text-primary"
              : "bg-surface/80 text-muted-foreground",
          )}
        >
          {reduceMotion ? "已启用削弱" : "完整动效"}
        </span>
      </div>
    </SettingCard>
  )
}
