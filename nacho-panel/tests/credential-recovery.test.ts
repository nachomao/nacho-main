import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

test("恢复失败进入专用屏、主界面不可交互，重新初始化必须逐字确认", () => {
  const context = readFileSync(new URL("../components/onboarding/onboarding-context.tsx", import.meta.url), "utf8")
  const recovery = readFileSync(new URL("../components/onboarding/credential-recovery.tsx", import.meta.url), "utf8")
  const shell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8")
  assert.match(context, /setPhase\("recovery"\)/)
  assert.doesNotMatch(context, /console\.error\("连接配置恢复失败"/)
  assert.match(recovery, /requireValue: "重新初始化"/)
  assert.match(context, /reinitialize\("RESET_LOCAL_CREDENTIALS"\)/)
  assert.match(shell, /phase === "recovery"/)
  assert.match(shell, /inert=\{covered \|\| shellRecessed\}/)
})
