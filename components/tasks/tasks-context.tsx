"use client"

import { createContext, useContext, useState } from "react"

/** 任务所属操作系统类型 */
export type OSType = "windows" | "linux"

type TasksCtx = {
  /** 非 null 时表示「新建任务」对话框已打开，并指定要创建的系统类型 */
  createOS: OSType | null
  openCreate: (os: OSType) => void
  closeCreate: () => void
}

const Ctx = createContext<TasksCtx | null>(null)

export function TasksProvider({ children }: { children: React.ReactNode }) {
  const [createOS, setCreateOS] = useState<OSType | null>(null)

  return (
    <Ctx.Provider
      value={{
        createOS,
        openCreate: (os) => setCreateOS(os),
        closeCreate: () => setCreateOS(null),
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useTasks() {
  return useContext(Ctx)
}
