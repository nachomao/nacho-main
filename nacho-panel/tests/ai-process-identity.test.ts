import assert from "node:assert/strict"
import test from "node:test"
import { imageNameMatches, parseTasklistCsv, runtimeImageName } from "../lib/ai/process-identity"

test("parses tasklist CSV rows and ignores info or malformed lines", () => {
  const output = [
    '"opencode.exe","1234","Console","1","10,000 K"',
    '"other.exe","99","Services","0","1,000 K"',
    'INFO: No tasks are running which match the specified criteria.',
    "not csv",
  ].join("\r\n")
  assert.deepEqual(parseTasklistCsv(output), [
    { imageName: "opencode.exe", pid: 1234 },
    { imageName: "other.exe", pid: 99 },
  ])
  assert.deepEqual(parseTasklistCsv(""), [])
  assert.deepEqual(parseTasklistCsv("INFO: nothing"), [])
})

test("image names match case-insensitively and runtime image falls back to binary basename", () => {
  assert.equal(imageNameMatches("OpenCode.exe", "opencode.exe"), true)
  assert.equal(imageNameMatches("other.exe", "opencode.exe"), false)
  assert.equal(imageNameMatches(null, "opencode.exe"), false)
  assert.equal(runtimeImageName({ binaryName: "custom.exe" }, "C:\\bin\\opencode.exe"), "custom.exe")
  assert.equal(runtimeImageName({}, "C:\\bin\\opencode.exe"), "opencode.exe")
  assert.equal(runtimeImageName({}, null), "")
})
