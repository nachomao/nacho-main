"use client"

/* iOS 锁屏风格的逐位滚动文字。
 *
 * - 只有数字位参与滚动；冒号、空格等静态字符始终保持静止。
 * - 完整时间（如 14:51）按字符差分：外层以 index 作 key，内部动画节点以字符作 key，
 *   搭配 AnimatePresence(mode="popLayout")，未变化的位不会重新挂载，因此 14:50 → 14:51
 *   只有最后一位会滚动。
 * - 整段中文状态（如「未排期」「事件触发」）不拆字滚动，改为整体模糊淡入淡出。
 * - 数字容器开启 tabular-nums，单字符槽位固定行高并裁剪溢出，避免滚动时仪表盘宽度抖动。 */

import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/lib/utils"
import { useMotionPreference } from "@/lib/motion-preference"

const ROLL_INITIAL = { y: "75%", opacity: 0, filter: "blur(6px)" }
const ROLL_ANIMATE = { y: "0%", opacity: 1, filter: "blur(0px)" }
const ROLL_EXIT = { y: "-75%", opacity: 0, filter: "blur(6px)" }

/* y 轴使用欠阻尼弹簧：向上冲过头后自然回弹；透明度与模糊单独用 0.2s easeOut 收尾，
   避免回弹阶段出现闪烁。 */
const ROLL_TRANSITION = {
  y: { type: "spring", stiffness: 380, damping: 22, mass: 0.8 },
  opacity: { duration: 0.2, ease: "easeOut" },
  filter: { duration: 0.2, ease: "easeOut" },
} as const

const FADE_INITIAL = { opacity: 0, filter: "blur(6px)" }
const FADE_ANIMATE = { opacity: 1, filter: "blur(0px)" }
const FADE_EXIT = { opacity: 0, filter: "blur(6px)" }
const FADE_TRANSITION = { duration: 0.24, ease: "easeOut" } as const

const DIGIT = /^\d$/

type AnimatedRollingTextProps = {
  /** 要展示的文本；含数字时按位滚动，纯中文状态时整段淡入淡出。 */
  text: string
  className?: string
}

export function AnimatedRollingText({ text, className }: AnimatedRollingTextProps) {
  const { reduceMotion } = useMotionPreference()
  const chars = Array.from(text)
  // 只要出现数字就走逐位模式。倒计时里的中文是静态上下文，只有数字位需要滚动；
  // 纯中文状态（未排期 / 事件触发 / 已停用等）没有数字，走整段淡入淡出。
  const hasDigit = chars.some((char) => DIGIT.test(char))

  const fadeTransition = reduceMotion ? { duration: 0.12, ease: "easeOut" as const } : FADE_TRANSITION
  const digitInitial = reduceMotion ? { opacity: 0 } : ROLL_INITIAL
  const digitAnimate = reduceMotion ? { opacity: 1 } : ROLL_ANIMATE
  const digitExit = reduceMotion ? { opacity: 0 } : ROLL_EXIT
  const digitTransition = reduceMotion ? { duration: 0.12, ease: "easeOut" as const } : ROLL_TRANSITION

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center whitespace-nowrap align-baseline tabular-nums",
        className,
      )}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      <span className="sr-only">{text}</span>
      <span className="inline-flex items-center" aria-hidden="true">
        {/* 滚动态与中文状态之间整体交叉淡化；同一分支内的数字变化不会触发这一层。
            popLayout 让旧文案脱离文档流，新文案可以在同一位置淡入，避免等待式切换时中心短暂空白。 */}
        <AnimatePresence mode="popLayout" initial={false}>
          {hasDigit ? (
            <motion.span
              key="rolling"
              className="inline-flex items-center"
              initial={reduceMotion ? { opacity: 0 } : FADE_INITIAL}
              animate={FADE_ANIMATE}
              exit={reduceMotion ? { opacity: 0 } : FADE_EXIT}
              transition={fadeTransition}
            >
              {chars.map((char, index) => {
                if (!DIGIT.test(char)) {
                  // 冒号、空格与中文保持静止，不参与滚动。
                  return (
                    <span key={index} className="inline-block whitespace-pre">
                      {char === " " ? "\u00A0" : char}
                    </span>
                  )
                }

                return (
                  <span
                    key={index}
                    className="relative inline-flex h-[1em] items-center justify-center overflow-hidden leading-none"
                  >
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={char}
                        className="block leading-none will-change-transform"
                        initial={digitInitial}
                        animate={digitAnimate}
                        exit={digitExit}
                        transition={digitTransition}
                      >
                        {char}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                )
              })}
            </motion.span>
          ) : (
            <motion.span
              key={`status-${text}`}
              className="inline-block whitespace-pre"
              initial={reduceMotion ? { opacity: 0 } : FADE_INITIAL}
              animate={FADE_ANIMATE}
              exit={reduceMotion ? { opacity: 0 } : FADE_EXIT}
              transition={fadeTransition}
            >
              {text}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </span>
  )
}
