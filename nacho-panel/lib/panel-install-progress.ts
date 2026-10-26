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

/** 速率采样做指数平滑，避免约 200ms 一次的进度推送让速度与剩余时间来回跳动。 */
export function smoothTransferRate(previous: number | null, sample: number) {
  if (!Number.isFinite(sample) || sample < 0) return previous
  return previous === null ? sample : previous * 0.7 + sample * 0.3
}

export function estimateRemainingSeconds(downloadedBytes: number, totalBytes: number | null, bytesPerSecond: number | null) {
  if (!totalBytes || !bytesPerSecond || bytesPerSecond <= 0 || downloadedBytes >= totalBytes) return null
  return Math.ceil((totalBytes - downloadedBytes) / bytesPerSecond)
}

export function formatTransferRate(bytesPerSecond: number) {
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MiB/s`
  if (bytesPerSecond >= 1024) return `${Math.round(bytesPerSecond / 1024)} KiB/s`
  return `${Math.round(bytesPerSecond)} B/s`
}

export function formatRemaining(seconds: number) {
  if (seconds < 60) return `剩余 ${seconds} 秒`
  if (seconds < 3600) return `剩余约 ${Math.ceil(seconds / 60)} 分钟`
  return "剩余超过 1 小时"
}
