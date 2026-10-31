import assert from "node:assert/strict"
import test from "node:test"
import { defaultStoredSettings } from "../lib/ai/settings-schema"
import { buildSystemPrompt } from "../lib/ai/system-prompt"

test("system prompt keeps the Nacho identity and hides the runtime engine", () => {
  for (const mode of ["agent", "chat"] as const) {
    const prompt = buildSystemPrompt(defaultStoredSettings(), mode)
    assert.equal(prompt.includes("Nacho AI"), true)
    assert.equal(prompt.includes("不要提及"), true)
    assert.equal(prompt.toLowerCase().includes("opencode"), false)
  }
})
