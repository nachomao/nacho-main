/**
 * 插件下载服务器地址属于面板本地偏好：与更新源一样存在面板本地，
 * 不写服务端设置、不进入命令契约；读取/写入失败时只退回内存值。
 */
export const PLUGIN_DOWNLOAD_SERVER_STORAGE_KEY = "nacho_plugin_download_server"

type StorageLike = Pick<Storage, "getItem" | "setItem">

/** 面板本地存储；SSR、隐私模式或写入被拒时返回 null，由调用方退回内存状态。 */
export function panelStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null
    return window.localStorage
  } catch {
    return null
  }
}

export function normalizePluginDownloadServer(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function readPluginDownloadServer(storage: StorageLike | null | undefined): string {
  if (!storage) return ""
  try {
    return normalizePluginDownloadServer(storage.getItem(PLUGIN_DOWNLOAD_SERVER_STORAGE_KEY))
  } catch {
    return ""
  }
}

/** 写入并返回规范化后的值，调用方可直接用返回值更新 state。 */
export function writePluginDownloadServer(storage: StorageLike | null | undefined, value: string): string {
  const normalized = normalizePluginDownloadServer(value)
  if (!storage) return normalized
  try {
    storage.setItem(PLUGIN_DOWNLOAD_SERVER_STORAGE_KEY, normalized)
  } catch {
    /* 隐私模式或配额不足时保持内存值，不阻断输入 */
  }
  return normalized
}
