"use client"

import * as React from "react"
import { LockKeyhole } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import styles from "./animated-password-input.module.css"

type AnimatedPasswordInputProps = Omit<React.ComponentProps<typeof Input>, "type" | "value"> & {
  value: string
}

export function AnimatedPasswordInput({ className, value, ...props }: AnimatedPasswordInputProps) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <span className={styles.root} data-has-value={value.length > 0 ? "true" : "false"}>
      <LockKeyhole className={styles.icon} aria-hidden="true" />
      <Input
        {...props}
        type="password"
        value={value}
        className={cn(
          "h-11 rounded-xl border-border/55 bg-background/30 pl-10 shadow-none backdrop-blur-sm",
          styles.input,
          className,
        )}
      />
      <span className={styles.mask} aria-hidden="true">
        <AnimatePresence initial={false}>
          {Array.from({ length: value.length }, (_, index) => (
            <motion.span
              key={index}
              className={styles.dotSlot}
              initial={false}
              animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0, filter: "blur(0px)" }}
              exit={
                shouldReduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: 5, scale: 0.35, rotateX: 72, filter: "blur(4px)" }
              }
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { duration: 0.28, ease: [0.4, 0, 0.2, 1] }
              }
            >
              <span className={styles.dot} />
            </motion.span>
          ))}
        </AnimatePresence>
      </span>
    </span>
  )
}
