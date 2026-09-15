import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const drawerSource = readFileSync(new URL("../components/topbar/notifications-drawer.tsx", import.meta.url), "utf8")
const cssSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")

test("通知详情和子卡片保持挂载，以支持展开、收起和中途反向", () => {
  assert.match(drawerSource, /className="notification-expansion"/)
  assert.match(drawerSource, /min-h-0 overflow-hidden/)
  assert.match(drawerSource, /isStacked && n\.items &&/)
  assert.doesNotMatch(drawerSource, /\{isExpanded &&|isStacked && isExpanded|isStacked && !isExpanded/)
  assert.match(cssSource, /\.notification-expansion \{[^}]*grid-template-rows: 0fr;[^}]*transition: grid-template-rows 480ms/)
  assert.match(cssSource, /\[data-expanded="true"\] > \.notification-expansion \{\s*grid-template-rows: 1fr;/)
})

test("折叠通知内容退出键盘导航和无障碍树", () => {
  assert.match(drawerSource, /aria-expanded=\{isExpanded\}/)
  assert.match(drawerSource, /aria-controls=\{contentId\}/)
  assert.match(drawerSource, /id=\{contentId\}[^>]*aria-hidden=\{!isExpanded\} inert=\{!isExpanded\}/)
})

test("子卡片错峰作用于实际过渡节点，收起时没有延迟", () => {
  assert.match(drawerSource, /<li key=\{item\.id\} className="notification-reveal" style=\{\{ "--notification-delay"/)
  assert.match(drawerSource, /Math\.min\(idx, 5\) \* 45/)
  assert.doesNotMatch(drawerSource, /animationDelay|animate-stack-expand/)
  assert.match(cssSource, /\.notification-reveal \{[^}]*opacity: 0;[^}]*transform:[^}]*filter:[^}]*transition-delay: 0ms;/)
  assert.match(cssSource, /\[data-expanded="true"\] \.notification-reveal \{[^}]*opacity: 1;[^}]*transition-delay: var\(--notification-delay, 0ms\);/)
})

test("堆叠底卡保留渐变过渡，同时遵循减少动态效果偏好", () => {
  assert.match(cssSource, /\.notification-stack-layer \{[^}]*transition:[^}]*opacity 300ms[^}]*transform 480ms/)
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\) \{\s*\.notification-expansion,[^}]*transition-duration: 0s;[^}]*transition-delay: 0s;/)
})

test("通知详情和操作按钮可在窄屏换行", () => {
  assert.match(drawerSource, /notification-reveal mt-1 flex flex-wrap/)
  assert.match(drawerSource, /w-full min-w-0 whitespace-pre-wrap break-words/)
  assert.doesNotMatch(drawerSource, /max-w-\[55%\]/)
})
