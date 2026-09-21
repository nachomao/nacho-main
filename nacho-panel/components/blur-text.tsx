"use client"

import { motion, useReducedMotion } from "motion/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"

type BlurTextProps = {
  text: string
  className?: string
  delay?: number
  direction?: "top" | "bottom"
  threshold?: number
  rootMargin?: string
}

const STEP_DURATION_SECONDS = 0.35

export function BlurText({
  text,
  className,
  delay = 45,
  direction = "top",
  threshold = 0.1,
  rootMargin = "0px",
}: BlurTextProps) {
  const segments = useMemo(() => text.split(""), [text])
  const [inView, setInView] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setInView(true)
        observer.unobserve(element)
      },
      { threshold, rootMargin },
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [rootMargin, threshold])

  const offset = direction === "top" ? -50 : 50
  const settleOffset = direction === "top" ? 5 : -5
  const initialState = { filter: "blur(10px)", opacity: 0, y: offset }

  return (
    <span ref={ref} className={cn("inline-flex", className)}>
      <span className="sr-only">{text}</span>
      {segments.map((segment, index) => (
        <motion.span
          key={`${segment}-${index}`}
          aria-hidden="true"
          initial={reduceMotion ? false : initialState}
          animate={
            reduceMotion || inView
              ? {
                  filter: ["blur(10px)", "blur(5px)", "blur(0px)"],
                  opacity: [0, 0.5, 1],
                  y: [offset, settleOffset, 0],
                }
              : initialState
          }
          transition={
            reduceMotion
              ? { duration: 0 }
              : {
                  duration: STEP_DURATION_SECONDS * 2,
                  times: [0, 0.5, 1],
                  delay: (index * delay) / 1000,
                  ease: "linear",
                }
          }
          style={{ display: "inline-block", willChange: "transform, filter, opacity" }}
        >
          {segment === " " ? "\u00A0" : segment}
        </motion.span>
      ))}
    </span>
  )
}
