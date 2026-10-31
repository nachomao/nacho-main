import type { NextRequest } from "next/server"
import { AIHttpError, aiError, aiJson, readJsonBody, requireDesktop, requireJsonRequest, requireSameOrigin } from "@/lib/ai/http"
import { markRuntimeStale } from "@/lib/ai/runtime"
import { getAISettingsStore } from "@/lib/ai/settings-store"
import {
  AISettingsValidationError,
  mergeSettings,
  redactSettings,
  settingsRequireRuntimeRestart,
  validateSettingsPatch,
} from "@/lib/ai/settings-schema"
import { MAX_AI_REQUEST_LENGTH } from "@/lib/ai/config-shared"
import { AIDesktopUnavailableError } from "@/lib/ai/credential-protector"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const invalid = requireSameOrigin(request) ?? requireDesktop()
  if (invalid) return invalid
  try {
    return aiJson({ ok: true, data: await getAISettingsStore().getRedacted() })
  } catch (error) {
    if (error instanceof AIDesktopUnavailableError) return aiError(error.message, 501, "desktop-only")
    return aiError("读取 AI 设置失败", 500, "read-failed")
  }
}

export async function PUT(request: NextRequest) {
  const invalid = requireSameOrigin(request) ?? requireDesktop() ?? requireJsonRequest(request, MAX_AI_REQUEST_LENGTH)
  if (invalid) return invalid
  try {
    const body = await readJsonBody(request, MAX_AI_REQUEST_LENGTH)
    const patch = validateSettingsPatch(body)
    let restart = false
    const snapshot = await getAISettingsStore().update((current) => {
      const next = mergeSettings(current, patch)
      restart = settingsRequireRuntimeRestart(current, next)
      return next
    })
    if (restart) markRuntimeStale()
    return aiJson({ ok: true, data: redactSettings(snapshot.config) })
  } catch (error) {
    if (error instanceof AIHttpError) return aiError(error.message, error.status, error.code)
    if (error instanceof AISettingsValidationError) return aiError(error.message, 400, "invalid-settings")
    if (error instanceof AIDesktopUnavailableError) return aiError(error.message, 501, "desktop-only")
    return aiError("保存 AI 设置失败", 500, "write-failed")
  }
}
