"use client"

import { type CSSProperties, useEffect, useRef, useState } from "react"
import { useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"
import styles from "./split-flap-text.module.css"

type SplitFlapTextProps = {
  text: string
  className?: string
  flipDuration?: number
  stagger?: number
  flipsPerChar?: number
  charset?: string
}

type FlapTile = {
  current: string
  next: string
  flipping: boolean
  tick: number
}

type FlipPlan = {
  index: number
  from: string
  target: string
  sequence: string[]
  start: number
  step: number
  done: boolean
}

type TileUpdate = {
  index: number
  current: string
  next: string
  done: boolean
}

const DEFAULT_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const ANIMATED_CHAR = /[A-Z0-9]/

function sampleChar(charset: string) {
  return charset.charAt(Math.floor(Math.random() * charset.length)) || " "
}

function createSettledTiles(text: string): FlapTile[] {
  return text.split("").map((character) => ({
    current: character,
    next: character,
    flipping: false,
    tick: 0,
  }))
}

function createInitialTiles(text: string, charset: string): FlapTile[] {
  return text.split("").map((character) => {
    const initialCharacter = ANIMATED_CHAR.test(character) ? sampleChar(charset) : character

    return {
      current: initialCharacter,
      next: initialCharacter,
      flipping: false,
      tick: 0,
    }
  })
}

function createBlankTiles(text: string): FlapTile[] {
  return text.split("").map((character) => {
    const initialCharacter = ANIMATED_CHAR.test(character) ? " " : character

    return {
      current: initialCharacter,
      next: initialCharacter,
      flipping: false,
      tick: 0,
    }
  })
}

function buildSequence(target: string, flips: number, charset: string) {
  return [...Array.from({ length: flips }, () => sampleChar(charset)), target]
}

export function SplitFlapText({
  text,
  className,
  flipDuration = 0.1,
  stagger = 0.028,
  flipsPerChar = 5,
  charset = DEFAULT_CHARSET,
}: SplitFlapTextProps) {
  const reduceMotion = useReducedMotion()
  const animationFrameRef = useRef<number | null>(null)
  const [tiles, setTiles] = useState<FlapTile[]>(() => createBlankTiles(text))

  useEffect(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (reduceMotion) {
      setTiles(createSettledTiles(text))
      return
    }

    const activeCharset = charset.length > 0 ? charset : DEFAULT_CHARSET
    const initialTiles = createInitialTiles(text, activeCharset)
    const safeFlipDuration = Math.max(0.04, flipDuration) * 1000
    const safeStagger = Math.max(0, stagger) * 1000
    const safeFlips = Math.max(0, Math.floor(flipsPerChar))
    const plans = text
      .split("")
      .map<FlipPlan | null>((target, index) => {
        if (!ANIMATED_CHAR.test(target)) return null

        return {
          index,
          from: initialTiles[index].current,
          target,
          sequence: buildSequence(target, safeFlips, activeCharset),
          start: index * safeStagger,
          step: -1,
          done: false,
        }
      })
      .filter((plan): plan is FlipPlan => plan !== null)

    setTiles(initialTiles)

    if (plans.length === 0) return

    let cancelled = false
    const startedAt = performance.now()

    const updateTiles = (updates: TileUpdate[]) => {
      setTiles((previousTiles) => {
        const nextTiles = [...previousTiles]

        for (const update of updates) {
          const tile = nextTiles[update.index]
          if (!tile) continue

          nextTiles[update.index] = {
            current: update.current,
            next: update.next,
            flipping: !update.done,
            tick: tile.tick + 1,
          }
        }

        return nextTiles
      })
    }

    const tick = (now: number) => {
      if (cancelled) return

      const elapsed = now - startedAt
      const updates: TileUpdate[] = []
      let shouldContinue = false

      for (const plan of plans) {
        const localElapsed = elapsed - plan.start

        if (localElapsed < 0) {
          shouldContinue = true
          continue
        }

        const step = Math.floor(localElapsed / safeFlipDuration)

        if (step < plan.sequence.length) {
          shouldContinue = true

          if (step !== plan.step) {
            plan.step = step
            updates.push({
              index: plan.index,
              current: step === 0 ? plan.from : plan.sequence[step - 1],
              next: plan.sequence[step],
              done: false,
            })
          }
        } else if (!plan.done) {
          plan.done = true
          updates.push({
            index: plan.index,
            current: plan.target,
            next: plan.target,
            done: true,
          })
        }
      }

      if (updates.length > 0) updateTiles(updates)

      if (shouldContinue) {
        animationFrameRef.current = requestAnimationFrame(tick)
      } else {
        animationFrameRef.current = null
      }
    }

    animationFrameRef.current = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [charset, flipDuration, flipsPerChar, reduceMotion, stagger, text])

  const animationStyle = {
    "--split-flap-duration": `${Math.max(0.04, flipDuration)}s`,
  } as CSSProperties

  return (
    <span className={cn(styles.root, className)}>
      <span className="sr-only">{text}</span>
      <span className={styles.visual} style={animationStyle} aria-hidden="true">
        {tiles.map((tile, index) => (
          <span className={styles.tile} key={`${index}-${tiles.length}`}>
            <span className={cn(styles.half, styles.top)}>
              <span className={styles.character}>{tile.current === " " ? "\u00A0" : tile.current}</span>
            </span>
            <span className={cn(styles.half, styles.bottom)}>
              <span className={styles.character}>{tile.flipping ? tile.next : tile.current}</span>
            </span>

            {tile.flipping ? (
              <>
                <span className={cn(styles.flap, styles.front)} key={`front-${index}-${tile.tick}`}>
                  <span className={styles.character}>{tile.current === " " ? "\u00A0" : tile.current}</span>
                </span>
                <span className={cn(styles.flap, styles.back)} key={`back-${index}-${tile.tick}`}>
                  <span className={styles.character}>{tile.next === " " ? "\u00A0" : tile.next}</span>
                </span>
              </>
            ) : null}
          </span>
        ))}
      </span>
    </span>
  )
}
