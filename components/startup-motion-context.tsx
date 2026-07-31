"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

type StartupMotionContextValue = {
  covered: boolean
  release: () => void
}

const StartupMotionContext = createContext<StartupMotionContextValue | null>(null)

export function StartupMotionProvider({ children }: { children: ReactNode }) {
  const [covered, setCovered] = useState(true)
  const release = useCallback(() => setCovered(false), [])
  const value = useMemo(() => ({ covered, release }), [covered, release])

  return <StartupMotionContext.Provider value={value}>{children}</StartupMotionContext.Provider>
}

export function useStartupMotion() {
  const context = useContext(StartupMotionContext)
  if (!context) throw new Error("useStartupMotion 必须在 StartupMotionProvider 内使用")
  return context
}
