"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useServerData } from "@/components/server-data-context"

/**
 * 面板资源加载器：统一 /api/panel/* 只读资源的加载、错误、重试与终态刷新。
 *
 * 任务、插件、日志、健康四个页面此前都是纯本地 state 演示，接入真实服务端后
 * 需要同一套加载语义，因此抽到这里，避免四份重复实现产生行为差异。
 */
export function usePanelResource<T>(path: string | null, fallback: T) {
  const { apiRequest } = useServerData()
  const [data, setData] = useState<T>(fallback)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 请求序号：丢弃过期响应，避免快速切换筛选时旧结果覆盖新结果
  const sequence = useRef(0)
  const loadedOnce = useRef(false)

  const reload = useCallback(async () => {
    if (!path) {
      setLoading(false)
      return
    }
    const current = ++sequence.current
    if (!loadedOnce.current) setLoading(true)
    try {
      const next = await apiRequest<T>(path)
      if (current !== sequence.current) return
      setData(next)
      setError(null)
      loadedOnce.current = true
    } catch (caught) {
      if (current !== sequence.current) return
      setError(caught instanceof Error ? caught.message : "加载失败")
    } finally {
      if (current === sequence.current) setLoading(false)
    }
  }, [apiRequest, path])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, setData, loading, error, reload }
}
