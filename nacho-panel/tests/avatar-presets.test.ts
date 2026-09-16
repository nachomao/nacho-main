import assert from "node:assert/strict"
import { readFileSync, statSync } from "node:fs"
import { test } from "node:test"
import { avatars, defaultAvatarId, getAvatar } from "../components/onboarding/avatars"
import { LOCAL_AVATAR_IDS } from "../lib/local-settings-schema"

test("头像选择只保留三款已重新命名的 NachoNeko 预设", () => {
  assert.deepEqual(avatars.map(({ id }) => id), ["heart", "lounge", "hood"])
  assert.deepEqual(avatars.map(({ label }) => label), ["抱心猫娘", "趴趴猫娘", "猫帽猫娘"])
  assert.equal(new Set(avatars.map(({ id }) => id)).size, 3)
  for (const avatar of avatars) {
    assert.ok(LOCAL_AVATAR_IDS.some((id) => id === avatar.id))
    assert.equal(getAvatar(avatar.id), avatar)
    assert.equal(avatar.color, "oklch(0.78 0 0)")
  }
})

test("三款预设使用用户提供的本地透明 PNG 图片", () => {
  for (const { src } of avatars) {
    assert.match(src, /^\/avatars\/nachoneko-(?:heart|lounge|hood)\.png$/)
    const file = new URL(`../public${src}`, import.meta.url)
    const data = readFileSync(file)
    assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    assert.ok(statSync(file).size < 350_000)
  }
})

test("已删除与未知头像标识安全回退，自定义上传分支保持可用", () => {
  assert.equal(defaultAvatarId, "heart")
  for (const id of ["cat", "ghost", "bird", "rabbit", "fish", "bot", "custom", "unknown", "", null, undefined]) {
    assert.equal(getAvatar(id), avatars[0])
  }
  assert.deepEqual(LOCAL_AVATAR_IDS, ["heart", "lounge", "hood", "custom"])
})

const source = readFileSync(new URL("../components/onboarding/name-register.tsx", import.meta.url), "utf8")
const topbarSource = readFileSync(new URL("../components/topbar.tsx", import.meta.url), "utf8")

test("预设头像缩小并完整显示，自定义头像仍填充圆形容器", () => {
  assert.equal(source.match(/size-\[82%\] object-contain/g)?.length, 2)
  assert.match(topbarSource, /size-\[82%\] object-contain/)
  assert.equal(source.match(/h-full w-full object-cover/g)?.length, 2)
  assert.match(topbarSource, /h-full w-full object-cover/)
})

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
