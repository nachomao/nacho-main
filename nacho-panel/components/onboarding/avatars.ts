/** 头像预设：像素风插画图片 + 专属底色（用于描边/光晕等点缀），供引导选择与全局展示复用 */
export interface AvatarPreset {
  id: string
  label: string
  /** 像素风头像图片路径（public 下） */
  src: string
  /** 头像主题色（内容色板，独立于主题），用于选中态等点缀 */
  color: string
}

export const avatars: AvatarPreset[] = [
  { id: "cat", label: "猫咪", src: "/avatars/cat.png", color: "oklch(0.72 0.15 250)" },
  { id: "ghost", label: "幽灵", src: "/avatars/ghost.png", color: "oklch(0.72 0.14 300)" },
  { id: "bird", label: "小鸟", src: "/avatars/bird.png", color: "oklch(0.75 0.15 200)" },
  { id: "rabbit", label: "兔子", src: "/avatars/rabbit.png", color: "oklch(0.74 0.14 20)" },
  { id: "fish", label: "小鱼", src: "/avatars/fish.png", color: "oklch(0.75 0.14 160)" },
  { id: "bot", label: "机器人", src: "/avatars/bot.png", color: "oklch(0.76 0.15 70)" },
]

export const defaultAvatarId = avatars[0].id

export function getAvatar(id: string | null | undefined): AvatarPreset {
  return avatars.find((a) => a.id === id) ?? avatars[0]
}
