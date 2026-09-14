export type RollingDirection = "up" | "down" | "none"

/**
 * 数值增加时内容向上滚，数值减少时内容向下滚。
 * 相同数值不创建多余动画，避免轮询刷新造成视觉抖动。
 */
export function getRollingDirection(previous: number, next: number): RollingDirection {
  if (next > previous) return "up"
  if (next < previous) return "down"
  return "none"
}

/**
 * 从右侧对齐整数位，使 9 -> 10、100 -> 99 这类位数变化仍按个位对齐滚动。
 * 小数点及其后内容已经由 toFixed 保证等长，因此只需补齐整个字符串左侧。
 */
export function alignRollingText(previous: string, next: string) {
  const width = Math.max(previous.length, next.length)
  return {
    previous: previous.padStart(width, " "),
    next: next.padStart(width, " "),
  }
}
