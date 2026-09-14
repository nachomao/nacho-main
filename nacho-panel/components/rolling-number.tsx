"use client"

import { useEffect, useRef, useState } from "react"
import { alignRollingText, getRollingDirection, type RollingDirection } from "@/lib/number-animation"

interface RollingNumberProps {
  /** 目标数值 */
  value: number
  /** 小数位数 */
  decimals?: number
  /** 单个数字滚动时长（毫秒） */
  duration?: number
  prefix?: string
  suffix?: string
  className?: string
}

/**
 * iOS 风格的逐位数字滚动（里程表 / odometer 效果）。
 * 只滚动发生变化的字符：数值增加时旧数字向上离场、新数字从下方进入；
 * 数值减少时方向相反。未变化的字符保持静止，轮询到相同值时完全不动画。
 */
function RollingCharacter({
  previous,
  next,
  direction,
  delay,
  duration,
}: {
  previous: string
  next: string
  direction: Exclude<RollingDirection, "none">
  delay: number
  duration: number
}) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setActive(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const upward = direction === "up"
  const oldTranslate = active ? (upward ? "-100%" : "100%") : "0%"
  const newTranslate = active ? "0%" : upward ? "100%" : "-100%"
  const transition = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`

  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        // 使用当前行高而不是字号高度，确保数字与同一徽标内的文字严格共用基线盒。
        height: "1lh",
        lineHeight: "inherit",
        overflow: "hidden",
        verticalAlign: "bottom",
      }}
    >
      <span
        style={{
          display: "inline-block",
          visibility: "hidden",
        }}
      >
        {next === " " ? previous : next}
      </span>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateY(${oldTranslate})`,
          transition,
          willChange: "transform",
        }}
      >
        {previous === " " ? "\u00a0" : previous}
      </span>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateY(${newTranslate})`,
          transition,
          willChange: "transform",
        }}
      >
        {next === " " ? "\u00a0" : next}
      </span>
    </span>
  )
}

export function RollingNumber({
  value,
  decimals = 0,
  duration = 650,
  prefix = "",
  suffix = "",
  className,
}: RollingNumberProps) {
  const text = value.toFixed(decimals)
  const targetRef = useRef(value)
  const textRef = useRef(text)
  const transitionIdRef = useRef(0)
  const [transition, setTransition] = useState(() => ({
    id: 0,
    previous: text,
    next: text,
    direction: "none" as RollingDirection,
  }))

  useEffect(() => {
    const direction = getRollingDirection(targetRef.current, value)
    const previous = textRef.current
    targetRef.current = value
    textRef.current = text

    if (direction === "none" && previous === text) return

    transitionIdRef.current += 1
    setTransition({
      id: transitionIdRef.current,
      previous,
      next: text,
      direction,
    })
  }, [text, value])

  const aligned = alignRollingText(transition.previous, transition.next)
  const previousChars = aligned.previous.split("")
  const nextChars = aligned.next.split("")
  const changedDigitCount = nextChars.filter((character, index) => {
    return character !== previousChars[index] && /\d/.test(character)
  }).length
  let changedDigitIndex = -1

  return (
    <span
      className={className}
      aria-label={`${prefix}${text}${suffix}`}
      data-rolling-direction={transition.direction}
      data-rolling-from={transition.previous}
      data-rolling-to={transition.next}
      style={{
        display: "inline-flex",
        alignItems: "center",
        lineHeight: "inherit",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span aria-hidden="true">{prefix}</span>
      {nextChars.map((character, index) => {
        const previousCharacter = previousChars[index]
        const changed = character !== previousCharacter

        if (changed && /\d/.test(character)) changedDigitIndex += 1

        if (changed && transition.direction !== "none") {
          // 右侧变化位先动、左侧稍后，形成 iOS 风格的轻微级联。
          const delay = /\d/.test(character) ? (changedDigitCount - 1 - changedDigitIndex) * 45 : 0
          return (
            <RollingCharacter
              key={`${transition.id}-${index}`}
              previous={previousCharacter}
              next={character}
              direction={transition.direction}
              delay={delay}
              duration={duration}
            />
          )
        }

        return (
          <span key={`${transition.id}-${index}`} style={{ display: "inline-block" }}>
            {character === " " ? "\u00a0" : character}
          </span>
        )
      })}
      <span aria-hidden="true">{suffix}</span>
    </span>
  )
}
