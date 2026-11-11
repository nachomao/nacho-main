import type { ClientStatus } from "@/components/clients/client-data"

export type HomeFilters = {
  /** 空数组 = 不按状态过滤 */
  statuses: ClientStatus[]
  /** null = 全部分组 */
  group: string | null
  range: "24h" | "7d" | "30d"
}

export const defaultFilters: HomeFilters = { statuses: [], group: null, range: "24h" }

/** 统计已激活的筛选条件数（时间范围非默认值也算一项） */
export function countActiveFilters(f: HomeFilters): number {
  return f.statuses.length + (f.group ? 1 : 0) + (f.range !== "24h" ? 1 : 0)
}
