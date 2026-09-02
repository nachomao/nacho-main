import test from "node:test"
import assert from "node:assert/strict"
import { formatLogDateTime } from "../lib/formatters"

test("formats dashboard and system log timestamps as yyyy-MM-dd HH:mm", () => {
  const value = formatLogDateTime(Date.UTC(2026, 0, 2, 3, 4, 5))
  assert.match(value, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.doesNotMatch(value, /:\d{2}\.\d{3}$/)
})
