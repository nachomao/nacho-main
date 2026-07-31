"use client"

import { usePathname } from "next/navigation"
import { useLayoutEffect, useRef, type ReactNode } from "react"

const EXIT_MS = 820
const ENTER_MS = 820
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

/**
 * 路由级页面过渡：交叉淡入淡出（crossfade）。
 *
 * 背景：在 Next.js App Router 中，传入的 `children` 是一个「路由占位槽」，
 * 它永远渲染当前激活的路由——因此无法通过把 children 存进 state 来「冻结」旧页面，
 * 那样离场动画会错误地作用在新页面上、旧页面则瞬间消失。
 *
 * 解决：在路由切换的瞬间（useLayoutEffect，DOM 已更新为新内容但浏览器尚未绘制），
 * 用上一帧保存的「旧页面 DOM 快照」克隆出一个绝对定位的覆盖层叠在容器之上，
 * 让这个覆盖层（= 切换前的卡片）做「模糊 + 渐隐」离场；
 * 同时让容器内的真实新内容（= 切换后的卡片）做纯粹的「渐显」进场。
 * 离场结束后移除覆盖层。这样渐隐只作用于旧页面、渐显只作用于新页面。
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const ref = useRef<HTMLDivElement>(null)
  // 保存上一次提交时的路由路径与对应的 DOM 快照（innerHTML）
  const snapshot = useRef<{ path: string; html: string } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const prev = snapshot.current
    // 提交后立刻更新快照为「当前（新）内容」，供下一次切换使用
    snapshot.current = { path: pathname, html: el.innerHTML }

    // 首次挂载或同一路由（内容更新）：不做过渡
    if (!prev || prev.path === pathname) return

    const reduce = typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION).matches
    if (reduce) return

    // 用上一帧的旧内容快照构建覆盖层，叠在容器之上做离场
    const overlay = document.createElement("div")
    overlay.style.position = "absolute"
    overlay.style.inset = "0"
    overlay.style.pointerEvents = "none"
    overlay.style.zIndex = "10"
    overlay.innerHTML = prev.html
    el.appendChild(overlay)

    // 离场：旧页面「模糊 + 渐隐 + 轻微上移」
    const exit = overlay.animate(
      [
        { opacity: 1, filter: "blur(0px)", transform: "translateY(0)" },
        { opacity: 0, filter: "blur(10px)", transform: "translateY(-10px)" },
      ],
      { duration: EXIT_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
    )
    exit.onfinish = () => overlay.remove()
    exit.oncancel = () => overlay.remove()

    // 进场：新页面「模糊渐显 + 轻微上移就位」——从模糊到清晰，与离场的模糊语言呼应
    const enter = el.animate(
      [
        { opacity: 0, filter: "blur(10px)", transform: "translateY(32px)" },
        { opacity: 1, filter: "blur(0px)", transform: "translateY(0)" },
      ],
      { duration: ENTER_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" },
    )

    return () => {
      exit.cancel()
      enter.cancel()
    }
  }, [pathname])

  return (
    <div ref={ref} className="relative flex min-h-0 flex-1 flex-col gap-4">
      {children}
    </div>
  )
}
