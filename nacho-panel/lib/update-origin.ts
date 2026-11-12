export const UPDATE_ORIGIN_PATTERN = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i
export const DEFAULT_UPDATE_ORIGIN = "https://maojiu.cc"
const UPDATE_ORIGIN_PLACEHOLDER = "https://updates.example.invalid"

export function normalizeUpdateOriginInput(value: string): string {
  return value.trim().replace(/\/+$/, "")
}

export function isValidUpdateOrigin(value: string): boolean {
  const origin = normalizeUpdateOriginInput(value)
  return origin.length > 0 && origin.toLowerCase() !== UPDATE_ORIGIN_PLACEHOLDER && UPDATE_ORIGIN_PATTERN.test(origin)
}

export type UpdateOriginRuntime = {
  capabilities?: { updateSourceManagement?: boolean }
} | null | undefined

export type SaveUpdateOriginOptions = {
  origin: string
  previousLocalOrigin: string
  runtime: UpdateOriginRuntime
  setLocal(origin: string): Promise<void>
  saveServer(origin: string): Promise<void>
  verify(): Promise<void>
}

export type SaveUpdateOriginResult = {
  origin: string
  serverSynced: boolean
  verified: boolean
  warning?: string
}

/**
 * 面板统一保存：先写面板本地，再在服务端支持时写入服务端设置并验证索引。
 * 服务端写入失败会恢复面板本地；验证失败保留已保存的值并返回警告。
 */
export async function saveUpdateOrigin(options: SaveUpdateOriginOptions): Promise<SaveUpdateOriginResult> {
  const origin = normalizeUpdateOriginInput(options.origin)
  if (!isValidUpdateOrigin(origin)) {
    throw new Error("更新服务器必须为有效的 HTTPS 地址 (如 https://maojiu.cc)")
  }
  await options.setLocal(origin)

  if (!options.runtime) {
    return {
      origin, serverSynced: false, verified: false,
      warning: "尚未连接控制服务，仅保存了面板本地更新源；连接后可再次保存同步到服务端。",
    }
  }
  if (options.runtime.capabilities?.updateSourceManagement !== true) {
    return {
      origin, serverSynced: false, verified: false,
      warning: "当前服务端不支持面板管理更新源（需 1.2.1 及以上；1.1.24 需先按部署文档一次性迁移），仅保存了面板本地更新源。",
    }
  }

  try {
    await options.saveServer(origin)
  } catch (error) {
    let rollbackFailed = false
    try {
      await options.setLocal(options.previousLocalOrigin)
    } catch {
      rollbackFailed = true
    }
    const reason = error instanceof Error && error.message ? error.message : "服务端更新源保存失败"
    throw new Error(rollbackFailed
      ? `${reason}；面板本地更新源恢复失败，请手动改回 ${options.previousLocalOrigin}`
      : `${reason}；已恢复面板本地更新源`)
  }

  try {
    await options.verify()
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : "使用新更新源检查发布索引失败"
    return { origin, serverSynced: true, verified: false, warning: `服务端已保存新更新源，但检查发布索引失败：${reason}` }
  }
  return { origin, serverSynced: true, verified: true }
}
