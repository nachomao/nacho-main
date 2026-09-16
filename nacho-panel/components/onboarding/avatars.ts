/** NachoNeko 头像预设，供引导选择与全局展示复用。 */
export interface AvatarPreset {
  id: string
  label: string
  /** 用户提供的头像图片路径（public 下）。 */
  src: string
  /** 中性点缀色，不随面板主题改变。 */
  color: string
}

export const avatars: AvatarPreset[] = [
  { id: "heart", label: "抱心猫娘", src: "/avatars/nachoneko-heart.png", color: "oklch(0.78 0 0)" },
  { id: "lounge", label: "趴趴猫娘", src: "/avatars/nachoneko-lounge.png", color: "oklch(0.78 0 0)" },
  { id: "hood", label: "猫帽猫娘", src: "/avatars/nachoneko-hood.png", color: "oklch(0.78 0 0)" },
]

export const defaultAvatarId = avatars[0].id

export function getAvatar(id: string | null | undefined): AvatarPreset {
  // 旧设置可能仍保留已移除的预设标识，展示时回退而不改写用户资料。
  return avatars.find((avatar) => avatar.id === id) ?? avatars[0]
}
