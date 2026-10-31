import assert from "node:assert/strict"
import test from "node:test"
import { looksLikePlanningText, splitLeadingPlanning } from "../lib/ai/answer-separation"

test("English planning before a Chinese answer is split into reasoning", () => {
  const split = splitLeadingPlanning(
    "I need to find the Nacho server version.\n\nI will check the overview tool first.\n\n没有找到 Nacho 服务端版本。nacho_overview 没有返回版本字段。",
  )
  assert.ok(split)
  assert.equal(split.reasoning, "I need to find the Nacho server version.\n\nI will check the overview tool first.")
  assert.equal(split.answer, "没有找到 Nacho 服务端版本。nacho_overview 没有返回版本字段。")
})

test("Chinese-only answers and English-only answers are left untouched", () => {
  assert.equal(splitLeadingPlanning("没有找到版本。\n\n建议检查运行中的服务。"), null)
  assert.equal(splitLeadingPlanning("I could not find the version.\n\nThe service does not expose it."), null)
})

test("leading code blocks are never moved", () => {
  assert.equal(splitLeadingPlanning("```bash\nnacho status\n```\n\n没有找到版本。"), null)
})

test("Chinese in the first paragraph prevents a split", () => {
  assert.equal(splitLeadingPlanning("先检查一下。\n\nI will inspect the directory.\n\n没有找到版本。"), null)
})

test("English-leading text is recognized as live planning", () => {
  assert.equal(looksLikePlanningText("I need to find the Nacho server version."), true)
  assert.equal(looksLikePlanningText("Since neither query returned a version, I should check locally."), true)
  assert.equal(looksLikePlanningText("没有找到 Nacho 服务端版本。"), false)
  assert.equal(looksLikePlanningText("先确认目标客户端，再检查版本。"), false)
  assert.equal(looksLikePlanningText("OK"), false)
  assert.equal(looksLikePlanningText(""), false)
})
