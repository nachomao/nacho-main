"use client"

import { createContext, useCallback, useContext, useRef, useState } from "react"

/** 由日志视图注册的实际操作实现（导出 / 清空） */
type LogsHandlers = {
  exportLogs: () => void
  clearLogs: () => void
}

type LogsCtx = {
  /** 是否实时跟随（暂停 / 继续）——顶栏按钮与视图共享同一状态 */
  live: boolean
  toggleLive: () => void
  /** 视图挂载时注册导出/清空的具体实现 */
  registerHandlers: (h: LogsHandlers) => void
  exportLogs: () => void
  clearLogs: () => void
}

const Ctx = createContext<LogsCtx | null>(null)

export function LogsProvider({ children }: { children: React.ReactNode }) {
  const [live, setLive] = useState(true)
  const handlersRef = useRef<LogsHandlers | null>(null)

  const registerHandlers = useCallback((h: LogsHandlers) => {
    handlersRef.current = h
  }, [])

  return (
    <Ctx.Provider
      value={{
        live,
        toggleLive: () => setLive((v) => !v),
        registerHandlers,
        exportLogs: () => handlersRef.current?.exportLogs(),
        clearLogs: () => handlersRef.current?.clearLogs(),
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useLogs() {
  return useContext(Ctx)
}
