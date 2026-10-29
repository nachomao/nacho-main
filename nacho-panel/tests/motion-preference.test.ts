import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { defaultLocalSettings } from "../lib/local-settings-schema"
import { validateSettingsPatch, validateStoredSettings } from "../lib/local-settings-store"
import { isReducedMotion } from "../lib/motion-preference"

test("削弱动画效果设置项默认关闭（始终开启完整流畅动效，不受系统开关被动干扰）", () => {
  const defaults = defaultLocalSettings()
  assert.equal(defaults.reduceMotion, false, "默认状态必须为关闭")

  const storedWithDefault = validateStoredSettings({
    version: 1,
    legacyMigrationVersion: 0,
    profile: defaults.profile,
    theme: defaults.theme,
    onboardingCompleted: false,
    notificationCenter: defaults.notificationCenter,
  })
  assert.equal(storedWithDefault.reduceMotion, false, "向后兼容旧设置对象默认为 false")
})

test("削弱动画设置支持独立布尔校验与更新合并", () => {
  const patch = validateSettingsPatch({ reduceMotion: true })
  assert.equal(patch.reduceMotion, true)

  const invalid = () => validateSettingsPatch({ reduceMotion: "yes" as unknown as boolean })
  assert.throws(invalid, /reduceMotion 必须是布尔值/)

  const stored = validateStoredSettings({
    version: 1,
    legacyMigrationVersion: 0,
    profile: defaultLocalSettings().profile,
    theme: defaultLocalSettings().theme,
    reduceMotion: true,
    onboardingCompleted: true,
    notificationCenter: defaultLocalSettings().notificationCenter,
  })
  assert.equal(stored.reduceMotion, true)
})

test("系统设置常规面板包含标题与文案严格一致的削弱动画效果开关", () => {
  const generalPanelSource = readFileSync(new URL("../components/settings/general-panel.tsx", import.meta.url), "utf8")
  const motionCardSource = readFileSync(new URL("../components/settings/motion-card.tsx", import.meta.url), "utf8")

  // 常规面板包含 MotionCard
  assert.match(generalPanelSource, /<MotionCard \/>/)
  assert.match(generalPanelSource, /import \{ MotionCard \} from "\.\/motion-card"/)

  // 标题与说明文案严格一致
  assert.match(motionCardSource, /title="削弱动画效果"/)
  assert.match(motionCardSource, /desc="减少界面过渡动效、卡片形变与背景光效，降低视觉干扰"/)
  assert.match(motionCardSource, /<Toggle[\s\S]*?checked=\{reduceMotion\}[\s\S]*?label="削弱动画效果"/)
})

test("全局样式包含针对 Windows 系统开关被动干扰的覆盖规则与主动削弱规则", () => {
  const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")

  // 1. 默认状态覆盖 Windows 系统的 prefers-reduced-motion 被动干扰
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?html:not\(\[data-reduce-motion='true'\]\) \.cloud-mode-panel/)
  assert.match(styles, /html:not\(\[data-reduce-motion='true'\]\) \.cloud-deploy-step/)
  assert.match(styles, /html:not\(\[data-reduce-motion='true'\]\) \.meter-fill/)
  assert.match(styles, /html:not\(\[data-reduce-motion='true'\]\) \.motion-reduce\\:transition-none/)

  // 2. 主动开启削弱动画效果时全局削弱大面积运动与背景光效
  assert.match(styles, /html\[data-reduce-motion='true'\] \.cloud-mode-panel/)
  assert.match(styles, /html\[data-reduce-motion='true'\] \.orb-container \{\s*display: none !important;\s*\}/)
  assert.match(styles, /html\[data-reduce-motion='true'\] \.card-glow/)
  assert.match(styles, /html\[data-reduce-motion='true'\] \.animate-aurora/)
})

test("路由过渡、通知抽屉与 AI Mode 均接入统一动效偏好控制", () => {
  const pageTransitionSource = readFileSync(new URL("../components/page-transition.tsx", import.meta.url), "utf8")
  const drawerSource = readFileSync(new URL("../components/topbar/notifications-drawer.tsx", import.meta.url), "utf8")
  const aiIntroSource = readFileSync(new URL("../components/ai-mode/ai-intro.tsx", import.meta.url), "utf8")
  const aiWorkspaceSource = readFileSync(new URL("../components/ai-mode/ai-workspace.tsx", import.meta.url), "utf8")
  const orbSource = readFileSync(new URL("../components/orb.tsx", import.meta.url), "utf8")

  // PageTransition 使用 isReducedMotion() 消除对 window.matchMedia 的依赖
  assert.match(pageTransitionSource, /const reduce = isReducedMotion\(\)/)
  assert.doesNotMatch(pageTransitionSource, /window\.matchMedia\(REDUCED_MOTION\)/)

  // 通知抽屉使用 isReducedMotion()
  assert.match(drawerSource, /const reducedMotion = isReducedMotion\(\)/)

  // AIIntro 在 isReducedMotion() 时快速直达
  assert.match(aiIntroSource, /if \(isReducedMotion\(\)\) \{/)

  // AIWorkspace 在 isReducedMotion() 时采用无位移轻量淡入
  assert.match(aiWorkspaceSource, /const reduced = isReducedMotion\(\)/)
  assert.match(aiWorkspaceSource, /transform: "none"/)
  assert.match(aiWorkspaceSource, /clipPath: "none"/)

  // Orb 在 isReducedMotion() 时停止出帧渲染
  assert.match(orbSource, /if \(isReducedMotion\(\)\) return/)
})
