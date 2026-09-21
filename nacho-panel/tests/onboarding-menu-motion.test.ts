import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const menus = [
  { file: "server-register", label: "服务方式", detailId: "server-source-detail", collapseAttribute: "data-source-collapse" },
  { file: "auth-register", label: "登录方式", detailId: "auth-method-detail", collapseAttribute: "data-auth-collapse" },
]

for (const { file, label, detailId, collapseAttribute } of menus) {
  const source = readFileSync(new URL(`../components/onboarding/${file}.tsx`, import.meta.url), "utf8")
  const toggleMode = source.match(/const toggleMode = \(mode: Mode\) => \{([\s\S]*?)\n  \}/)?.[1]

  if (file === "auth-register") {
    test("未展开的登录方式卡片在桌面端保持等高", () => {
      assert.match(source, /!displaced && "sm:min-h-80"/)
      assert.match(source, /displaced && "sm:min-h-52 sm:p-4"/)
    })
  }

  test(`${label}展开与收起保留焦点交接，但不滚动尚在动画中的裁剪容器`, () => {
    assert.ok(toggleMode, "应保留菜单切换处理器")
    assert.match(toggleMode, /window\.requestAnimationFrame\(/)
    assert.ok(toggleMode.includes("cardButtons.current[mode]?.focus({ preventScroll: true })"))
    assert.ok(toggleMode.includes(
      `document.querySelector<HTMLElement>(\`#${detailId}-\${mode} [${collapseAttribute}]\`)?.focus({ preventScroll: true })`,
    ))
    assert.doesNotMatch(toggleMode, /\.focus\(\)/)
    assert.doesNotMatch(toggleMode, /scrollTo\(|scrollIntoView\(|scrollTop\s*=/)
  })

  test(`${label}保留卡片扩张、模糊缩放渐显与标题错峰动画`, () => {
    assert.match(source, /grid-template-rows 560ms \$\{EASE\}/)
    assert.match(source, /grid-template-rows 720ms \$\{EASE\}/)
    assert.match(source, /opacity 440ms ease/)
    assert.match(source, /filter 520ms ease/)
    assert.match(source, /transform 620ms \$\{EASE\}/)
    assert.match(source, /translateY\(8px\) scale\(0\.975\)/)
    assert.match(source, /animate-text-push-up/)
    assert.match(source, /animate-text-push-down/)
  })
}
