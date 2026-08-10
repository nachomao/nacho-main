import assert from "node:assert/strict"
import test from "node:test"
import {
  isDeleteConfirmationValid,
  isValidLocalGroupName,
  isValidLocalUserName,
  latestLocalUserList,
  localUserConfirmation,
  localUserPayload,
  parseLocalUserResult,
  type LocalUserCommand,
} from "@/lib/local-user-management"

test("用户与组名称边界以及严格 payload", () => {
  assert.equal(isValidLocalUserName("FixtureUser"), true)
  assert.equal(isValidLocalUserName("x".repeat(20)), true)
  assert.equal(isValidLocalUserName("x".repeat(21)), false)
  assert.equal(isValidLocalUserName("domain\\user"), false)
  assert.equal(isValidLocalGroupName("Remote Desktop Users"), true)
  assert.equal(isValidLocalGroupName("bad/group"), false)
  assert.deepEqual(localUserPayload("list"), { action: "list", userName: null, groupName: null })
  assert.deepEqual(localUserPayload("disable", "FixtureUser"), { action: "disable", userName: "FixtureUser", groupName: null })
  assert.deepEqual(localUserPayload("add-to-group", "FixtureUser", "FixtureGroup"), { action: "add-to-group", userName: "FixtureUser", groupName: "FixtureGroup" })
  assert.throws(() => localUserPayload("enable", "domain\\user"), /账户名/)
})

test("严格解析真实列表和逐账户写结果", () => {
  const list = parseLocalUserResult(JSON.stringify({
    action: "list", changed: false,
    accounts: [{ userName: "FixtureUser", sid: "S-1-5-21-1-2-3-1001", enabled: true, builtIn: false, groups: ["Users"] }],
    error: null,
  }))
  assert.equal(list?.action, "list")
  assert.equal(list?.action === "list" && list.accounts[0].userName, "FixtureUser")
  const write = parseLocalUserResult(JSON.stringify({ action: "disable", changed: true, target: { userName: "FixtureUser", sid: "S-1-5-21-1-2-3-1001", enabled: false, builtIn: false, groups: [] }, error: null }))
  assert.equal(write?.action, "disable")
  assert.equal(write?.changed, true)
  assert.equal(parseLocalUserResult('{"action":"list","accounts":[]}'), null)
  assert.equal(parseLocalUserResult(JSON.stringify({ action: "list", changed: false, accounts: [], error: null, extra: true })), null)
})

test("刷新恢复选择最新终态 list，且删除确认必须完整匹配", () => {
  const command = (id: string, action: "list" | "disable", status: LocalUserCommand["status"], createdAt: number): LocalUserCommand => ({
    id, clientId: "client-1", type: "manage-local-user", payload: { action, userName: action === "list" ? null : "FixtureUser", groupName: null },
    status, result: null, exitCode: null, createdAt, updatedAt: createdAt,
  })
  assert.equal(latestLocalUserList([command("old", "list", "success", 1), command("write", "disable", "success", 3), command("new", "list", "success", 2)])?.id, "new")
  assert.equal(latestLocalUserList([command("running", "list", "running", 4)]), null)
  assert.equal(isDeleteConfirmationValid("FixtureUser", "FixtureUser"), true)
  assert.equal(isDeleteConfirmationValid("FixtureUser", "fixtureuser"), false)
  assert.match(localUserConfirmation("add-to-group", "Client A", "FixtureUser", "FixtureGroup"), /Client A[\s\S]*FixtureUser[\s\S]*FixtureGroup/)
})
