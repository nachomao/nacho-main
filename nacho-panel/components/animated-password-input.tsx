"use client"

import * as React from "react"
import { LockKeyhole } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import styles from "./animated-password-input.module.css"

type AnimatedPasswordInputProps = Omit<React.ComponentProps<typeof Input>, "type" | "value"> & {
  value: string
}

export function AnimatedPasswordInput({ className, value, ...props }: AnimatedPasswordInputProps) {
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
      {value.length > 0 ? (
        <span className={styles.mask} aria-hidden="true">
          {Array.from({ length: value.length }, (_, index) => (
            <span key={index} className={styles.dotSlot}>
              <span className={styles.dot} />
            </span>
          ))}
        </span>
      ) : null}
    </span>
  )
}
