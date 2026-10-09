import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AboutPanel } from "../components/settings/about-panel"
import { PANEL_VERSION_LABEL, formatReleaseVersion } from "../lib/panel-version"

test("发布版本采用英文频道标识", () => {
  assert.equal(formatReleaseVersion("1.2.3", "stable"), "1.2.3 Stable")
  assert.equal(formatReleaseVersion("1.2.3", "beta"), "1.2.3 Beta")
  assert.equal(formatReleaseVersion("1.2.3", "alpha"), "1.2.3 Alpha")
})

test("关于页无需更新检查即可显示安装版本，并提供真实资源链接", () => {
  const html = renderToStaticMarkup(createElement(AboutPanel, { onOpenUpdates() {} }))
  assert.ok(html.includes(PANEL_VERSION_LABEL))
  assert.ok(html.includes("面板版本"))
  assert.ok(!html.includes("面板版本请在"))
  assert.ok(!html.includes('href="#"'))
  for (const href of [
    "https://github.com/nachomao/nacho-main",
    "https://github.com/nachomao/nacho-main/blob/main/nacho-panel/README.md",
    "https://github.com/nachomao/nacho-main/releases",
  ]) {
    assert.ok(html.includes(`href="${href}" target="_blank" rel="noopener noreferrer"`))
  }
})
