import assert from "node:assert/strict"
import test from "node:test"
import { contentRange, PROBE_TIMEOUT_MS, isGitHubFile } from "../../desktop/src/github-download.cjs"

test("panel imports the desktop transport with GitHub-only acceleration", () => {
  assert.equal(PROBE_TIMEOUT_MS, 5000)
  assert.equal(isGitHubFile("https://gh-proxy.com/https://github.com/nachomao/nacho-server.git"), true)
  assert.equal(isGitHubFile("https://nodejs.org/dist/index.json"), false)
  assert.deepEqual(contentRange("bytes 0-0/8"), { start: 0, end: 0, total: 8 })
})
