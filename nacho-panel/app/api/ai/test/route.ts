import type { NextRequest } from "next/server"
import { aiError, aiJson, requireDesktop, requireSameOrigin } from "@/lib/ai/http"
import { probeMcpServer } from "@/lib/ai/mcp-probe"
import { testProvider } from "@/lib/ai/provider-test"
import { getAISettingsStore } from "@/lib/ai/settings-store"
import { redactSettings } from "@/lib/ai/settings-schema"
import { AIDesktopUnavailableError } from "@/lib/ai/credential-protector"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const invalid = requireSameOrigin(request) ?? requireDesktop()
  if (invalid) return invalid
  try {
    const current = (await getAISettingsStore().read()).config
    const enabledMcp = current.mcpServers.filter((server) => server.status === "connected")
    const [provider, mcp] = await Promise.all([
      testProvider(current),
      Promise.all(enabledMcp.map((server) => probeMcpServer(
        { id: server.id, url: server.url, token: server.token || undefined },
        5_000,
      ))),
    ])
    const checkedAt = Date.now()
    const snapshot = await getAISettingsStore().update((latest) => ({
      ...latest,
      mcpServers: latest.mcpServers.map((server) => {
        const result = mcp.find((item) => item.id === server.id)
        return result
          ? { ...server, tools: result.tools, lastCheckedAt: checkedAt }
          : server
      }),
    }))
    return aiJson({
      ok: true,
      data: {
        provider,
        mcp,
        settings: redactSettings(snapshot.config),
      },
    })
  } catch (error) {
    if (error instanceof AIDesktopUnavailableError) return aiError(error.message, 501, "desktop-only")
    return aiError("测试连接失败", 500, "test-failed")
  }
}
