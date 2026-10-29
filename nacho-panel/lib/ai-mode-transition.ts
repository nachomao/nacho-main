export type AIModePhase = "closed" | "dimming" | "intro" | "entering" | "active" | "exiting"

export type AIIntroStage = "surge" | "helix" | "lock" | "portal"

export type AIOriginPoint = {
  /** 触发点视口 X 坐标（px） */
  x: number
  /** 触发点视口 Y 坐标（px） */
  y: number
  /** 视口宽度（px） */
  vw: number
  /** 视口高度（px） */
  vh: number
}

/**
 * AI Mode 切入与退场时序（毫秒）：
 * - 点击后立即进入 intro（0ms 零黑屏等待），底层景深后退、暗房压暗与中心光学陀螺仪同步启动
 * - 1380ms 切入 portal 阶段并交接给 entering，光学取景框直接外扩为三栏工作台边界
 * - 1900ms 完全卸载开场叠层
 */
export const AI_MODE_TIMING = {
  /** Stage 1 -> Stage 2：起点光学脉冲抵达中心，双轴干涉环与游标刻度点亮 */
  HELIX_START_MS: 120,
  /** Stage 2 -> Stage 3：四角光学取景锚点（KERNEL/SKILL/MCP/PLUGIN）与宽银幕光束锁定 */
  LOCK_START_MS: 420,
  /** Stage 3 -> Stage 4：光学卡片模拟加载完成（100% READY），卡片不消失而是直接开始向四周扩展至中间卡片大小 */
  PORTAL_HANDOFF_MS: 1120,
  /** 动画卡片向四周扩展至中间卡片大小的持续时长（ms） */
  CARD_EXPAND_MS: 680,
  /** 卡片扩展、原内容模糊渐隐与外框交接的重叠时长（ms，待中卡完全展开后再隐退叠层边框） */
  PORTAL_OVERLAP_MS: 880,
  /** 左侧卡片（会话/能力）从左侧切入的起始延迟（ms） */
  LEFT_CARD_DELAY_MS: 420,
  /** 右侧卡片（执行遥测）紧随左卡之后从右侧切入的起始延迟（ms） */
  RIGHT_CARD_DELAY_MS: 580,
  /** 工作台三栏（中卡扩展 + 新内容模糊渐显 + 左右卡逐一切入）完全展开就位耗时 */
  WORKSPACE_ENTER_MS: 1240,
  /** 退出收拢耗时 */
  WORKSPACE_EXIT_MS: 420,
} as const

/**
 * 初始模拟加载动画卡片的基准几何尺寸（px）
 */
export const OPTICAL_CARD_INITIAL_SIZE = {
  width: 368,
  height: 256,
  borderRadius: 16,
} as const

export interface BoundingBoxLike {
  left: number
  top: number
  width: number
  height: number
}

export interface CenterCardMorphTarget {
  /** 中间卡片的目标宽度（px） */
  width: number
  /** 中间卡片的目标高度（px） */
  height: number
  /** 中间卡片中心点相对视口中心 (vw/2, vh/2) 的水平偏移（px） */
  offsetX: number
  /** 中间卡片中心点相对视口中心 (vw/2, vh/2) 的垂直偏移（px） */
  offsetY: number
  /** 初始加载卡片相对中间卡片左右边缘的内缩裁剪量（px） */
  insetX: number
  /** 初始加载卡片相对中间卡片上下边缘的内缩裁剪量（px） */
  insetY: number
  /** 目标圆角（px） */
  borderRadius: number
}

/**
 * 计算点击触发点与屏幕中心的几何关系，支持无 DOM 矩形时的右上角默认锚点回退。
 */
export function resolveAIOriginPoint(
  rect?: BoundingBoxLike | null,
  viewport?: { width: number; height: number } | null,
): AIOriginPoint {
  const vw = Math.max(320, Math.round(viewport?.width ?? 1440))
  const vh = Math.max(320, Math.round(viewport?.height ?? 900))

  if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) {
    return {
      x: Math.max(48, vw - 148),
      y: 38,
      vw,
      vh,
    }
  }

  const x = Math.min(vw - 16, Math.max(16, Math.round(rect.left + rect.width / 2)))
  const y = Math.min(vh - 16, Math.max(16, Math.round(rect.top + rect.height / 2)))
  return { x, y, vw, vh }
}

/**
 * 生成从触发按钮射向视口中心的二次贝塞尔能量弧 SVG 路径。
 */
export function buildEnergyArcPath(origin: AIOriginPoint): {
  path: string
  centerX: number
  centerY: number
  distance: number
} {
  const centerX = Math.round(origin.vw / 2)
  const centerY = Math.round(origin.vh / 2)
  const dx = centerX - origin.x
  const dy = centerY - origin.y
  const distance = Math.max(1, Math.round(Math.hypot(dx, dy)))

  // 控制点向内上方弯曲并限制在视口内，营造轻盈且不裁切的空间弧线轨迹
  const ctrlX = Math.round(origin.x + dx * 0.38)
  const ctrlY = Math.max(16, Math.round(origin.y + dy * 0.24 - Math.min(64, Math.abs(dy) * 0.14)))

  return {
    path: `M ${origin.x} ${origin.y} Q ${ctrlX} ${ctrlY} ${centerX} ${centerY}`,
    centerX,
    centerY,
    distance,
  }
}

/**
 * 计算三栏工作台中间那张主卡片（<section>）的目标几何尺寸与相对视口中心的偏移。
 * 对应布局：外层 `p-4 sm:p-5 gap-4`，左卡 `hidden w-64 md:block`，右卡 `hidden w-64 lg:block`。
 */
export function computeCenterCardMorphTarget(
  viewport?: { width: number; height: number } | null,
  measuredRect?: BoundingBoxLike | null,
): CenterCardMorphTarget {
  const vw = Math.max(320, Math.round(viewport?.width ?? 1440))
  const vh = Math.max(320, Math.round(viewport?.height ?? 900))

  if (measuredRect && measuredRect.width > 0 && measuredRect.height > 0) {
    const width = Math.round(measuredRect.width)
    const height = Math.round(measuredRect.height)
    const centerX = measuredRect.left + measuredRect.width / 2
    const centerY = measuredRect.top + measuredRect.height / 2
    return {
      width,
      height,
      offsetX: Math.round(centerX - vw / 2),
      offsetY: Math.round(centerY - vh / 2),
      insetX: Math.max(0, Math.round((width - OPTICAL_CARD_INITIAL_SIZE.width) / 2)),
      insetY: Math.max(0, Math.round((height - OPTICAL_CARD_INITIAL_SIZE.height) / 2)),
      borderRadius: 16,
    }
  }

  const pad = vw >= 640 ? 20 : 16
  const gap = 16
  const sideWidth = 256
  const hasLeft = vw >= 768
  const hasRight = vw >= 1024

  const leftOccupied = hasLeft ? sideWidth + gap : 0
  const rightOccupied = hasRight ? sideWidth + gap : 0
  const width = Math.max(280, vw - pad * 2 - leftOccupied - rightOccupied)
  const height = Math.max(320, vh - pad * 2)
  const offsetX = Math.round((leftOccupied - rightOccupied) / 2)
  const offsetY = 0

  return {
    width,
    height,
    offsetX,
    offsetY,
    insetX: Math.max(0, Math.round((width - OPTICAL_CARD_INITIAL_SIZE.width) / 2)),
    insetY: Math.max(0, Math.round((height - OPTICAL_CARD_INITIAL_SIZE.height) / 2)),
    borderRadius: 16,
  }
}

/**
 * 计算加载动画卡片内部原内容在卡片向四周扩展时的「逐渐模糊渐隐」过渡样式。
 */
export function computeIntroCardContentBlurMotion(expanding: boolean): {
  opacity: number
  filter: string
  transform: string
  transition: string
} {
  const easeBlurOut = "cubic-bezier(0.25, 0.85, 0.35, 1)"
  const easeMorph = "cubic-bezier(0.22, 1, 0.36, 1)"
  if (expanding) {
    return {
      opacity: 0,
      filter: "blur(20px)",
      transform: "scale(1.08)",
      transition: `opacity 380ms ${easeBlurOut}, filter 420ms ${easeBlurOut}, transform 480ms ${easeMorph}`,
    }
  }
  return {
    opacity: 1,
    filter: "none",
    transform: "scale(1)",
    transition: "opacity 240ms ease-out, filter 240ms ease-out, transform 320ms ease-out",
  }
}

/**
 * 计算中间卡片内部新内容在卡片扩展过程中的「模糊渐显」过渡样式：
 * - 初始收拢在扩展卡片中心区域（scale 0.86 + 24px 光学高斯模糊 + 全透明）
 * - 待原加载内容模糊退场、卡片向四周推开时（140ms 延迟），以 720ms 柔和光学对焦曲线从模糊渐显至清晰
 */
export function computeCenterContentBlurMotion(
  shown: boolean,
  exiting: boolean,
  settled = false,
): {
  opacity: number
  filter: string
  transform: string
  transition: string
} {
  const easeFocus = "cubic-bezier(0.25, 0.85, 0.35, 1)"
  const easeMorph = "cubic-bezier(0.22, 1, 0.36, 1)"
  const easeIn = "cubic-bezier(0.4, 0, 0.8, 1)"

  if (exiting) {
    return {
      opacity: 0,
      filter: "blur(16px)",
      transform: "scale(0.95) translate3d(0, 8px, 0)",
      transition: `opacity 260ms ${easeIn}, filter 280ms ${easeIn}, transform 320ms ${easeIn}`,
    }
  }

  if (!shown) {
    return {
      opacity: 0,
      filter: "blur(24px)",
      transform: "scale(0.86) translate3d(0, 10px, 0)",
      transition: "none",
    }
  }

  if (settled) {
    return {
      opacity: 1,
      filter: "none",
      transform: "none",
      transition: `opacity 320ms ${easeFocus}, filter 320ms ${easeFocus}`,
    }
  }

  return {
    opacity: 1,
    filter: "blur(0px)",
    transform: "scale(1) translate3d(0, 0, 0)",
    transition: `opacity 640ms ${easeFocus} 140ms, filter 720ms ${easeFocus} 140ms, transform 700ms ${easeMorph} 120ms`,
  }
}

/**
 * 计算中间卡片内三大功能区（顶栏 header / 中央对话或空态 body / 底部输入框 footer）
 * 随卡片向四周扩展同步向两端舒展并模糊渐显的错峰过渡样式。
 */
export function computeCenterZoneBlurMotion(
  zone: "header" | "body" | "footer",
  shown: boolean,
  exiting: boolean,
  settled = false,
): {
  opacity: number
  filter: string
  transform: string
  transition: string
} {
  const easeFocus = "cubic-bezier(0.25, 0.85, 0.35, 1)"
  const easeMorph = "cubic-bezier(0.22, 1, 0.36, 1)"
  const easeIn = "cubic-bezier(0.4, 0, 0.8, 1)"

  if (exiting) {
    const exitY = zone === "header" ? 20 : zone === "footer" ? -20 : 6
    return {
      opacity: 0,
      filter: "blur(12px)",
      transform: `translate3d(0, ${exitY}px, 0) scale(0.96)`,
      transition: `opacity 240ms ${easeIn}, filter 260ms ${easeIn}, transform 280ms ${easeIn}`,
    }
  }

  if (!shown) {
    const startY = zone === "header" ? 56 : zone === "footer" ? -56 : 12
    const startScale = zone === "body" ? 0.9 : 0.94
    const startBlur = zone === "body" ? 18 : 14
    return {
      opacity: 0,
      filter: `blur(${startBlur}px)`,
      transform: `translate3d(0, ${startY}px, 0) scale(${startScale})`,
      transition: "none",
    }
  }

  if (settled) {
    return {
      opacity: 1,
      filter: "none",
      transform: "none",
      transition: `opacity 280ms ${easeFocus}, filter 280ms ${easeFocus}`,
    }
  }

  const delay = zone === "body" ? 150 : zone === "header" ? 190 : 230
  return {
    opacity: 1,
    filter: "blur(0px)",
    transform: "translate3d(0, 0, 0) scale(1)",
    transition: `opacity 600ms ${easeFocus} ${delay}ms, filter 680ms ${easeFocus} ${delay}ms, transform 660ms ${easeMorph} ${delay}ms`,
  }
}

/**
 * 计算三栏工作台各区域在切入/激活/退出态下的空间变换样式：
 * - center：中栏主对话台直接由中央加载卡片向四周扩展生成（clip-path inset -> 0，与加载卡片使用完全一致的 680ms 曲线）
 * - left：左栏会话与能力面板在中间卡片扩展展开后，率先从左侧切入（translate3d(-88px -> 0)）
 * - right：右栏执行遥测面板紧随左栏之后，从右侧逐一切入（translate3d(88px -> 0)）
 */
export function computeWorkspaceColumnMotion(
  vector: "left" | "center" | "right",
  shown: boolean,
  exiting: boolean,
  centerMorph?: Pick<CenterCardMorphTarget, "insetX" | "insetY">,
): {
  opacity: number
  transform: string
  filter: string
  clipPath?: string
  transition: string
} {
  const EASE_MORPH = "cubic-bezier(0.22, 1, 0.36, 1)"
  const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)"
  const EASE_IN = "cubic-bezier(0.4, 0, 0.8, 1)"
  const insetX = centerMorph?.insetX ?? 244
  const insetY = centerMorph?.insetY ?? 302

  if (vector === "center") {
    if (exiting) {
      return {
        opacity: 0,
        transform: "translate3d(0, 10px, 0) scale(0.95)",
        filter: "blur(12px)",
        clipPath: "inset(0px 0px round 16px)",
        transition: `opacity 320ms ${EASE_IN}, transform 380ms ${EASE_IN}, filter 320ms ${EASE_IN}`,
      }
    }
    if (shown) {
      return {
        opacity: 1,
        transform: "translate3d(0, 0, 0) scale(1)",
        filter: "blur(0px)",
        clipPath: "inset(0px 0px round 16px)",
        transition: `clip-path ${AI_MODE_TIMING.CARD_EXPAND_MS}ms ${EASE_MORPH}, transform ${AI_MODE_TIMING.CARD_EXPAND_MS}ms ${EASE_MORPH}, opacity 200ms ease-out`,
      }
    }
    return {
      opacity: 1,
      transform: "translate3d(0, 0, 0) scale(1)",
      filter: "blur(0px)",
      clipPath: `inset(${insetY}px ${insetX}px round 16px)`,
      transition: "none",
    }
  }

  // 左右两侧卡片：从左、右侧外部逐一切入
  const delayIn = vector === "left" ? AI_MODE_TIMING.LEFT_CARD_DELAY_MS : AI_MODE_TIMING.RIGHT_CARD_DELAY_MS
  const delayOut = vector === "right" ? 0 : 45
  const enterOffsetX = vector === "left" ? -88 : 88
  const exitOffsetX = vector === "left" ? -56 : 56

  if (exiting) {
    return {
      opacity: 0,
      transform: `translate3d(${exitOffsetX}px, 0, 0) scale(0.96)`,
      filter: "blur(8px)",
      transition: `opacity 300ms ${EASE_IN} ${delayOut}ms, transform 360ms ${EASE_IN} ${delayOut}ms, filter 300ms ${EASE_IN} ${delayOut}ms`,
    }
  }

  if (shown) {
    return {
      opacity: 1,
      transform: "translate3d(0, 0, 0) scale(1)",
      filter: "blur(0px)",
      transition: `opacity 520ms ${EASE_OUT} ${delayIn}ms, transform 620ms ${EASE_MORPH} ${delayIn}ms, filter 540ms ${EASE_OUT} ${delayIn}ms`,
    }
  }

  return {
    opacity: 0,
    transform: `translate3d(${enterOffsetX}px, 0, 0) scale(0.97)`,
    filter: "blur(12px)",
    transition: "none",
  }
}
