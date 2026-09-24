import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const menus = [
  { file: "server-register", label: "服务方式", detailId: "server-source-detail", collapseAttribute: "data-source-collapse" },
  { file: "auth-register", label: "登录方式", detailId: "auth-method-detail", collapseAttribute: "data-auth-collapse" },
]

test("云端部署与对接切换时卡片平滑变高，并保留未选表单状态", () => {
  const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
  for (const file of ["onboarding/server-register", "settings/connection-panel"]) {
    const source = readFileSync(new URL(`../components/${file}.tsx`, import.meta.url), "utf8")
    assert.match(source, /className="cloud-mode-panel" data-active=\{cloudChoice === "deploy"\} aria-hidden=\{cloudChoice !== "deploy"\} inert=\{cloudChoice !== "deploy"\}/)
    assert.match(source, /className="cloud-mode-panel" data-active=\{cloudChoice === "connect"\} aria-hidden=\{cloudChoice !== "connect"\} inert=\{cloudChoice !== "connect"\}/)
    assert.doesNotMatch(source, /cloudChoice === "(?:deploy|connect)" \? "(?:block|hidden)/)
  }
  assert.match(styles, /\.cloud-mode-panel \{[\s\S]*?grid-template-rows: 0fr;[\s\S]*?transition: grid-template-rows 720ms/)
  assert.match(styles, /\.cloud-mode-panel\[data-active='true'\] \{\s*grid-template-rows: 1fr;/)
  assert.match(styles, /\.cloud-mode-content \{\s*padding: 0\.25rem;[\s\S]*?filter: blur\(14px\);[\s\S]*?transform: translateY\(8px\) scale\(0\.975\);/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{\s*\.cloud-mode-panel,\s*\.cloud-mode-content \{\s*transition: none !important;/)
})

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
