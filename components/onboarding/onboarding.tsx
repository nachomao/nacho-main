"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useOnboarding } from "./onboarding-context"
import { IntroLogo } from "./intro-logo"
import { NameRegister } from "./name-register"
import { ServerRegister } from "./server-register"
import { LocalDeploy } from "./local-deploy"
import { AuthRegister } from "./auth-register"
import { LockScreen } from "./lock-screen"

const EASE = "cubic-bezier(0.32, 0.72, 0.24, 1)"

/**
 * 首次进入引导覆盖层，串联四段流程：
 * 品牌开场（N 描边 + Nacho Panel 组排）→ 用户名注册 → 服务端注册 → 登录方式注册，
 * 完成后以模糊渐隐的方式原地离场，露出下方主页。
 * 若处于退出登录状态（locked），则跳过完整流程，直接显示锁屏。
 */
export function Onboarding() {
  const { phase, startUnlock, serverSource } = useOnboarding()
  const [step, setStep] = useState<"logo" | "name" | "server" | "deploy" | "auth">("logo")
  // 进入 locked 后固定走锁屏分支，unlocking 期间也保持渲染锁屏直至卸载
  const [lockFlow, setLockFlow] = useState(false)

  // 用 ref 读取最新的服务端来源，避免 ServerRegister 内部延时回调捕获旧闭包
  const serverSourceRef = useRef(serverSource)
  useEffect(() => {
    serverSourceRef.current = serverSource
  }, [serverSource])

  useEffect(() => {
    if (phase === "locked") setLockFlow(true)
  }, [phase])

  const toName = useCallback(() => setStep("name"), [])
  const toServer = useCallback(() => setStep("server"), [])
  const toAuth = useCallback(() => setStep("auth"), [])
  // 服务端来源确认后：本地部署 → 先走部署模拟页；云端对接 → 直接进入登录方式注册
  const afterServer = useCallback(() => {
    setStep(serverSourceRef.current?.mode === "local" ? "deploy" : "auth")
  }, [])

  if (phase === "done") return null

  const unlocking = phase === "unlocking"

  return (
    <div
      aria-label={lockFlow ? "NachoPanel 锁屏" : "NachoPanel 初始化引导"}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] bg-background"
      style={{
        // 离场：原地模糊渐隐（不做上滑位移），下方主页的浮现动效保持不变
        opacity: unlocking ? 0 : 1,
        filter: unlocking ? "blur(8px)" : "blur(0px)",
        transition: `opacity 1000ms ${EASE}, filter 1000ms ${EASE}`,
        pointerEvents: unlocking ? "none" : "auto",
        overflow: "hidden",
      }}
    >
      {lockFlow ? (
        <LockScreen />
      ) : (
        <>
          {step === "logo" && <IntroLogo onDone={toName} />}
          {step === "name" && <NameRegister onDone={toServer} />}
          {step === "server" && <ServerRegister onDone={afterServer} />}
          {step === "deploy" && <LocalDeploy onDone={toAuth} />}
          {step === "auth" && <AuthRegister onDone={startUnlock} />}
        </>
      )}
    </div>
  )
}
