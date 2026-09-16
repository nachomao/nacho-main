import assert from "node:assert/strict"
import { readFileSync, statSync } from "node:fs"
import { test } from "node:test"
import { avatars, defaultAvatarId, getAvatar } from "../components/onboarding/avatars"
import { LOCAL_AVATAR_IDS } from "../lib/local-settings-schema"

test("头像选择精简为四个中性手绘预设，沿用本地设置支持的标识", () => {
  assert.deepEqual(avatars.map(({ id }) => id), ["cat", "bird", "rabbit", "fish"])
  assert.equal(new Set(avatars.map(({ id }) => id)).size, 4)
  for (const avatar of avatars) {
    assert.ok(LOCAL_AVATAR_IDS.some((id) => id === avatar.id))
    assert.equal(getAvatar(avatar.id), avatar)
    assert.equal(avatar.color, "oklch(0.78 0 0)")
    assert.ok(avatar.label)
  }
})

test("预设使用实际存在的轻量本地 WebP 图片", () => {
  for (const { src } of avatars) {
    assert.match(src, /^\/avatars\/[a-z]+-ink\.webp$/)
    const file = new URL(`../public${src}`, import.meta.url)
    const data = readFileSync(file)
    assert.equal(data.toString("ascii", 0, 4), "RIFF")
    assert.equal(data.toString("ascii", 8, 12), "WEBP")
    assert.ok(statSync(file).size < 20_000)
  }
})

test("已移除与未知头像标识安全回退，不破坏旧设置和自定义上传分支", () => {
  assert.equal(defaultAvatarId, "cat")
  for (const id of ["ghost", "bot", "custom", "unknown", "", null, undefined]) {
    assert.equal(getAvatar(id), avatars[0])
  }
  assert.ok(LOCAL_AVATAR_IDS.includes("ghost"))
  assert.ok(LOCAL_AVATAR_IDS.includes("bot"))
  assert.ok(LOCAL_AVATAR_IDS.includes("custom"))
})

const source = readFileSync(new URL("../components/onboarding/name-register.tsx", import.meta.url), "utf8")

test("头像步骤使用中性描边按钮，并保留上传、中文输入保护和切换动画", () => {
  assert.doesNotMatch(source, /bg-primary|text-primary-foreground|ring-primary/)
  assert.match(source, /variant="outline"/)
  assert.match(source, /ring-foreground\/65/)
  assert.match(source, /aria-label="上传本地头像"/)
  assert.match(source, /onChange=\{handleUpload\}/)
  assert.match(source, /setCustomAvatar\(customUrl\)/)
  assert.match(source, /animate-avatar-pop/)
  assert.match(source, /filter 700ms ease/)
  assert.match(source, /!e\.nativeEvent\.isComposing && e\.keyCode !== 229/)
  assert.match(source, /inert=\{screen !== "name"\}/)
  assert.match(source, /inert=\{screen !== "avatar"\}/)
})
