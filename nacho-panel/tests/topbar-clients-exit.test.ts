import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const source = readFileSync(new URL("../components/topbar.tsx", import.meta.url), "utf8")

function slice(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, `应存在代码段：${startMarker}`)
  return source.slice(start, end)
}

const home = () => slice("function HomeActions(", "function TopbarTab(")

test("离开客户端页的离场回放保留真实选中标签，不闪现归位到首项", () => {
  const code = home()
  assert.match(code, /useClientTabs\(\)/)
  assert.match(code, /const isActive = i === activeTab/)
  assert.doesNotMatch(code, /isFirst/)
  assert.match(code, /\{isActive && \(/)
})

test("离场首帧在绘制前量取并锁定胶囊与标签的展开宽度", () => {
  const code = home()
  // 必须在 useLayoutEffect（绘制前）测量，而不是 ref 回调里事后写 ref
  assert.match(code, /useLayoutEffect\(/)
  assert.match(code, /exitPillRef/)
  assert.match(code, /exitLabelRef/)
  assert.match(code, /getBoundingClientRect\(\)\.width/)
  assert.match(code, /setExitWidths\(/)
  // 宽度必须进入 state，保证合并帧有可插值的上一帧显式宽度
  assert.match(code, /useState<\{ pill: number; label: number \} \| null>\(null\)/)
})

test("未量取完成前保持自然展开态，不得把标签宽度直接写成 0", () => {
  const code = home()
  // 首帧（exitWidths 尚为 null）用 auto 保持胶囊/标签自然展开，避免闪现圆形或空标签
  assert.match(code, /width: isActive \? \(merging \? "3rem" : exitPillWidth\) : "auto"/)
  assert.match(code, /width: merging \? "0px" : exitLabelWidth/)
  assert.doesNotMatch(code, /width: isActive && !merging \?/)
})

test("合并离场必须等宽度锁定且至少绘制一帧后才开始，功能键在合并结束后揭示", () => {
  const code = home()
  // 客户端离场需等待测量结果；日志离场无需测量
  assert.match(code, /if \(!fromLogs && !exitWidths\) return/)
  // 双 requestAnimationFrame：确保展开态先真实绘制，再触发 width 过渡
  assert.match(code, /requestAnimationFrame\(\(\) => \{[\s\S]*?requestAnimationFrame\(\(\) => setStage\(1\)\)/)
  // 470ms 揭示计时从合并开始（stage === 1）起算，而不是挂载即计时
  assert.match(code, /if \(stage !== 1\) return/)
  assert.match(code, /setTimeout\(\(\) => setStage\(2\), 470\)/)
})

test("胶囊收回先于淡出完成：宽度用减速曲线，淡出与合并用原离场曲线", () => {
  const code = home()
  // 宽度必须在大部分不透明时已经收回，避免「看不见过程就闪成圆」
  assert.match(code, /width 300ms cubic-bezier\(0\.22,1,0\.36,1\)/)
  assert.match(code, /transform 440ms cubic-bezier\(0\.4,0,1,1\)/)
  assert.match(code, /opacity 440ms ease-in/)
  // 标签文字与胶囊宽度同曲线收回
  assert.match(code, /width 300ms cubic-bezier\(0\.22,1,0\.36,1\), margin-left 300ms cubic-bezier\(0\.22,1,0\.36,1\)/)
})

test("离场途中切到首页/脚本安装时立即结束回放，不残留客户端标签", () => {
  const code = home()
  assert.match(code, /if \(!reverse && stage < 2\) setStage\(2\)/)
})

test("非选中标签保持自然圆形宽度，不被强制压成 48px", () => {
  const code = home()
  assert.match(code, /width: isActive \? \(merging \? "3rem" : exitPillWidth\) : "auto"/)
})
