import desktopManifest from "../../desktop/package.json"

export const RELEASE_CHANNEL_LABELS = { stable: "Stable", beta: "Beta", alpha: "Alpha" } as const
export type ReleaseChannel = keyof typeof RELEASE_CHANNEL_LABELS

export function formatReleaseVersion(version: string, channel: ReleaseChannel) {
  return `${version} ${RELEASE_CHANNEL_LABELS[channel]}`
}

/** 版本及标识来自安装包构建信息，与用户选择的更新频道无关，离线也可读取。 */
export const PANEL_VERSION = process.env.NEXT_PUBLIC_NACHO_PANEL_VERSION || desktopManifest.version
const channel = process.env.NEXT_PUBLIC_NACHO_PANEL_CHANNEL || desktopManifest.releaseChannel
if (channel !== "stable" && channel !== "beta" && channel !== "alpha") {
  throw new Error("面板发布频道无效")
}
export const PANEL_RELEASE_CHANNEL: ReleaseChannel = channel
export const PANEL_VERSION_LABEL = formatReleaseVersion(PANEL_VERSION, PANEL_RELEASE_CHANNEL)
