export type PanelInstallPhase = "idle" | "preparing" | "downloading" | "retrying" | "verifying" | "installing" | "failed"

export type PanelInstallState = {
  revision: number
  phase: PanelInstallPhase
  version: string | null
  downloadedBytes: number
  totalBytes: number | null
  error: string | null
}

export const PANEL_INSTALL_LABELS: Record<PanelInstallPhase, string> = {
  idle: "下载并安装",
  preparing: "正在准备更新",
  downloading: "正在下载安装包",
  retrying: "下载中断，正在重试",
  verifying: "正在校验安装包",
  installing: "即将退出并安装",
  failed: "下载或安装准备失败",
}

export function panelInstallActive(state: PanelInstallState | null) {
  return Boolean(state && state.phase !== "idle" && state.phase !== "failed")
}

export function panelDownloadPercent(state: PanelInstallState) {
  if (!state.totalBytes || state.phase === "preparing" || state.phase === "retrying") return null
  return Math.min(100, Math.max(0, Math.floor(state.downloadedBytes * 100 / state.totalBytes)))
}

/** 先订阅再读取快照，旧快照和延迟事件不能覆盖已经收到的新状态。 */
export function newerPanelInstallState(current: PanelInstallState | null, next: PanelInstallState) {
  return !current || next.revision > current.revision ? next : current
}
