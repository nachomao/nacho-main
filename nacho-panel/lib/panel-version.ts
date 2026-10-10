import desktopManifest from "../../desktop/package.json"

export const RELEASE_CHANNEL_LABELS = { stable: "Stable", beta: "Beta", alpha: "Alpha" } as const
export type ReleaseChannel = keyof typeof RELEASE_CHANNEL_LABELS

export function formatReleaseVersion(version: string, releaseType: string) {
  const label = Object.hasOwn(RELEASE_CHANNEL_LABELS, releaseType) ? RELEASE_CHANNEL_LABELS[releaseType as ReleaseChannel] : releaseType
  return `${version} ${label}`
}

/** 已安装版本及类型来自安装包构建信息，离线也可读取。 */
export const PANEL_VERSION = process.env.NEXT_PUBLIC_NACHO_PANEL_VERSION || desktopManifest.version
const channel = process.env.NEXT_PUBLIC_NACHO_PANEL_CHANNEL || desktopManifest.releaseChannel
if (channel !== "stable" && channel !== "beta" && channel !== "alpha") {
  throw new Error("面板发布频道无效")
}
export const PANEL_RELEASE_CHANNEL: ReleaseChannel = channel
export const PANEL_VERSION_LABEL = formatReleaseVersion(PANEL_VERSION, PANEL_RELEASE_CHANNEL)
