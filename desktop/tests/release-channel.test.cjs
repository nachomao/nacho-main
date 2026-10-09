const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const { createUpdater } = require("../src/updates.cjs")

test("新安装沿用构建频道，升级保留用户已选择的更新频道", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-release-channel-"))
  try {
    fs.writeFileSync(path.join(temporary, "package.json"), JSON.stringify({ releaseChannel: "beta" }))
    const app = { getAppPath: () => temporary, getPath: () => temporary }
    assert.equal(createUpdater(app).getChannel(), "beta")
    fs.writeFileSync(path.join(temporary, "update-channel.json"), JSON.stringify({ channel: "alpha" }))
    assert.equal(createUpdater(app).getChannel(), "alpha")
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})
