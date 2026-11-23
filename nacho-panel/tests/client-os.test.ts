import assert from "node:assert/strict"
import { test } from "node:test"
import { countUnknownClientOS, matchesClientOS, resolveClientOS } from "../lib/client-os"

test("按真实上报字段识别 Windows / Linux / macOS", () => {
  assert.equal(resolveClientOS({ os: "Windows" }), "windows")
  assert.equal(resolveClientOS({ os: "Windows", osName: "Windows 11 专业版" }), "windows")
  assert.equal(resolveClientOS({ osName: "ubuntu" }), "linux")
  assert.equal(resolveClientOS({ system: "Debian GNU/Linux 12" }), "linux")
  assert.equal(resolveClientOS({ platform: "darwin" }), "macos")
})

test("没有系统字段时返回 null，不按 id 猜测分配", () => {
  assert.equal(resolveClientOS({}), null)
  assert.equal(resolveClientOS(null), null)
  assert.equal(resolveClientOS(undefined), null)
  assert.equal(resolveClientOS({ os: "" }), null)
  assert.equal(resolveClientOS({ os: "   " }), null)
})

test("不同 id 的未知系统客户端都判定为未知，不再一半分到 Windows 一半分到 Linux", () => {
  const clients = [
    { id: "a" },
    { id: "b" },
    { id: "ab" },
    { id: "0f31aaf" },
  ]
  for (const client of clients) {
    assert.equal(matchesClientOS(client, "windows"), false, client.id)
    assert.equal(matchesClientOS(client, "linux"), false, client.id)
  }
  assert.equal(countUnknownClientOS(clients), 4)
})

test("匹配只看真实系统：未知系统不参与任何系统分组", () => {
  assert.equal(matchesClientOS({ os: "Windows" }, "windows"), true)
  assert.equal(matchesClientOS({ os: "Windows" }, "linux"), false)
  assert.equal(matchesClientOS({ os: "Linux" }, "linux"), true)
  assert.equal(matchesClientOS({ os: "macOS" }, "windows"), false)
  assert.equal(matchesClientOS({ os: "macOS" }, "linux"), false)
  assert.equal(countUnknownClientOS([{ os: "Windows" }, { os: "Linux" }, { os: "macOS" }, { id: "x" }]), 1)
})
