import assert from "node:assert/strict"
import test from "node:test"
import { toThoughtSteps } from "../lib/ai/thought-steps"

test("深度思考文本按行拆成步骤并忽略空行", () => {
  assert.deepEqual(
    toThoughtSteps("先确认时间窗口与日志来源。\n\n接着按错误类型聚类。\r\n   \n如果只是瞬时超时，就不需要生成处置任务。"),
    ["先确认时间窗口与日志来源。", "接着按错误类型聚类。", "如果只是瞬时超时，就不需要生成处置任务。"],
  )
})

test("步骤去掉标题、列表符号与 Markdown 强调", () => {
  assert.deepEqual(
    toThoughtSteps("**Planning the version check**\n- 读取 `release-index`\n2. 对比服务端版本\n## 结论\n> 无需升级"),
    ["Planning the version check", "读取 release-index", "对比服务端版本", "结论", "无需升级"],
  )
})

test("空文本没有步骤", () => {
  assert.deepEqual(toThoughtSteps(""), [])
  assert.deepEqual(toThoughtSteps("\n  \n"), [])
})
