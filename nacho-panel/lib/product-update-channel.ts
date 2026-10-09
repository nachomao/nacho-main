import type { ReleaseChannel } from "./panel-version"

/** 面板独立校验并保存频道；控制服务的同步失败不能回滚面板的更新选择。 */
export async function switchProductUpdateChannel<T extends { channel: ReleaseChannel }>(
  channel: ReleaseChannel,
  actions: {
    switchPanel(channel: ReleaseChannel): Promise<T>
    switchServer?(channel: ReleaseChannel): Promise<unknown>
  },
) {
  const panel = await actions.switchPanel(channel)
  if (panel.channel !== channel) throw new Error("面板更新频道与选择不一致")
  let serverError: string | null = null
  try {
    await actions.switchServer?.(channel)
  } catch (error) {
    serverError = error instanceof Error ? error.message : "服务端频道同步失败"
  }
  return { panel, serverError }
}

export function serverChannelWarning(channel: ReleaseChannel, message: string) {
  const label = { stable: "Stable", beta: "Beta", alpha: "Alpha" }[channel]
  const detail = message.includes("NACHO_UPDATE_ORIGIN") ? "控制服务尚未配置更新地址" : message
  return `面板已切换到 ${label}，可以检查和安装面板更新。服务端频道未同步：${detail}。`
}
