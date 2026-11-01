"use client"

/* 会话行插入动画（参考 iOS 列表插入）：行高从 0 弹开，把下方会话平滑推下；
 * 卡片本身从略小、模糊、透明的状态带一点回弹落位。只对新建的行生效，历史恢复与首次渲染不播放。 */

import type { ReactNode } from "react"
import { motion } from "motion/react"
import { useMotionPreference } from "@/lib/motion-preference"

const HEIGHT_SPRING = { type: "spring", visualDuration: 0.42, bounce: 0 } as const
const CARD_SPRING = { type: "spring", visualDuration: 0.5, bounce: 0.28 } as const
const FADE = { duration: 0.32, ease: [0.4, 0, 0.2, 1] } as const

export function SessionRowEnter({
  entering,
  onEntered,
  children,
}: {
  entering: boolean
  onEntered?: () => void
  children: ReactNode
}) {
  const { reduceMotion } = useMotionPreference()

  if (reduceMotion) {
    return (
      <motion.li initial={entering ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.16 }}>
        {children}
      </motion.li>
    )
  }

  return (
    <motion.li
      initial={entering ? { height: 0 } : false}
      animate={{ height: "auto" }}
      transition={HEIGHT_SPRING}
      // 只裁纵向：行高未展开时藏住卡片，横向留给缩放回弹的轻微越界
      style={{ overflowY: entering ? "clip" : undefined }}
      onAnimationComplete={entering ? onEntered : undefined}
    >
      <motion.div
        initial={entering ? { opacity: 0, scale: 0.9, y: -10, filter: "blur(6px)" } : false}
        animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
        transition={{ scale: CARD_SPRING, y: CARD_SPRING, opacity: FADE, filter: FADE }}
        style={{ transformOrigin: "50% 0%" }}
      >
        {children}
      </motion.div>
    </motion.li>
  )
}
