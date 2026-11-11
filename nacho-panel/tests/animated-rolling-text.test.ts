import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("../components/animated-rolling-text.tsx", import.meta.url), "utf8")

test("逐位滚动以 index 作外层 key、字符作内层 key，并使用 popLayout 就地退场", () => {
  assert.match(source, /chars\.map\(\(char, index\)/)
  assert.match(source, /<span\s+key=\{index\}/)
  assert.match(source, /key=\{char\}/)
  assert.match(source, /<AnimatePresence mode="popLayout" initial=\{false\}>/)
})

test("数字进出场使用 iOS 数值过渡的位移、模糊与弹簧参数", () => {
  assert.match(source, /y: "75%", opacity: 0, filter: "blur\(6px\)"/)
  assert.match(source, /y: "0%", opacity: 1, filter: "blur\(0px\)"/)
  assert.match(source, /y: "-75%", opacity: 0, filter: "blur\(6px\)"/)
  assert.match(source, /type: "spring", stiffness: 380, damping: 22, mass: 0\.8/)
  assert.match(source, /opacity: \{ duration: 0\.2, ease: "easeOut" \}/)
  assert.match(source, /filter: \{ duration: 0\.2, ease: "easeOut" \}/)
})

test("等宽数字、固定行高与溢出裁剪避免仪表盘内部宽度抖动", () => {
  assert.match(source, /tabular-nums/)
  assert.match(source, /fontVariantNumeric: "tabular-nums"/)
  assert.match(source, /overflow-hidden/)
  assert.match(source, /h-\[1em\]/)
  assert.match(source, /leading-none/)
})

test("中文状态整体淡入淡出，冒号等静态字符不进入滚动节点", () => {
  assert.match(source, /const hasDigit = chars\.some/)
  assert.match(source, /key=\{`status-\$\{text\}`\}/)
  assert.match(source, /if \(!DIGIT\.test\(char\)\)/)
  assert.match(source, /sr-only/)
})
