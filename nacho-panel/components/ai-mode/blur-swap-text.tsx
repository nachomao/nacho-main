"use client"

/* 文字切换：旧文字模糊渐隐、新文字模糊渐显。
 * popLayout 让旧文字退场时脱离文档流，容器立即按新文字定宽，胶囊宽度由外层弹簧平滑跟随。 */

import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/lib/utils"
import { useMotionPreference } from "@/lib/motion-preference"

const HIDDEN = { opacity: 0, filter: "blur(6px)" }
const SHOWN = { opacity: 1, filter: "blur(0px)" }

export function BlurSwapText({ text, className }: { text: string; className?: string }) {
  const { reduceMotion } = useMotionPreference()
  const transition = reduceMotion ? { duration: 0.12 } : { duration: 0.32, ease: [0.32, 0.72, 0, 1] as const }

  return (
    <span className={cn("relative flex min-w-0", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={text}
          className="block min-w-0 truncate whitespace-nowrap"
          initial={reduceMotion ? { opacity: 0 } : HIDDEN}
          animate={SHOWN}
          exit={reduceMotion ? { opacity: 0 } : HIDDEN}
          transition={transition}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
