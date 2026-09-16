/** 黑白手绘头像预设，供引导选择与全局展示复用。 */
export interface AvatarPreset {
  id: string
  label: string
  /** 手绘头像图片路径（public 下）。 */
  src: string
  /** 中性点缀色，不随面板主题改变。 */
  color: string
}

export const avatars: AvatarPreset[] = [
  { id: "cat", label: "猫咪", src: "/avatars/cat-ink.webp", color: "oklch(0.78 0 0)" },
  { id: "bird", label: "小鸟", src: "/avatars/bird-ink.webp", color: "oklch(0.78 0 0)" },
  { id: "rabbit", label: "兔子", src: "/avatars/rabbit-ink.webp", color: "oklch(0.78 0 0)" },
  { id: "fish", label: "小鱼", src: "/avatars/fish-ink.webp", color: "oklch(0.78 0 0)" },
]

export const defaultAvatarId = avatars[0].id

export function getAvatar(id: string | null | undefined): AvatarPreset {
  // 旧设置可能仍保留已移除的预设标识，展示时回退而不改写用户资料。
  return avatars.find((a) => a.id === id) ?? avatars[0]
}
