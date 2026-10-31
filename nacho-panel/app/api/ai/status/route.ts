import type { NextRequest } from "next/server"
import { aiJson, requireSameOrigin } from "@/lib/ai/http"
import { getAISettingsStore } from "@/lib/ai/settings-store"
import { getRuntimeStatus } from "@/lib/ai/runtime"
import { hasOpencodeBinary, isDesktopEnvironment } from "@/lib/ai/runtime-paths"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const invalid = requireSameOrigin(request)
  if (invalid) return invalid

  if (!isDesktopEnvironment()) {
    return aiJson({
      ok: true,
      data: {
        desktop: false,
        available: false,
        runtime: { state: "stopped" },
        settings: { configured: false, hasKey: false },
      },
    })
  }

  let configured = false
  let hasKey = false
  try {
    const snapshot = await getAISettingsStore().read()
    configured = Boolean(snapshot.config.baseUrl && snapshot.config.apiKey && snapshot.config.enabled)
    hasKey = Boolean(snapshot.config.apiKey)
  } catch {
    // 状态接口保持可用；读取失败时由设置页显示未配置。
  }

  return aiJson({
    ok: true,
    data: {
      desktop: true,
      available: hasOpencodeBinary(),
      runtime: getRuntimeStatus(),
      settings: { configured, hasKey },
    },
  })
}
