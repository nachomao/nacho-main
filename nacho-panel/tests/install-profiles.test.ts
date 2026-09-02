import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { installCommands, installScriptUrl } from "../lib/install-profiles"

test("安装档案命令正确编码 profile 并提供菜单与静默覆盖", () => {
  const id = "profile/with space"
  const url = installScriptUrl("http://localhost:8443/", id)
  assert.equal(url, "http://localhost:8443/nacho.ps1?profile=profile%2Fwith%20space")
  const commands = installCommands("http://localhost:8443/", id)
  assert.match(commands.standard, /irm "http:\/\/localhost:8443\/nacho\.ps1\?profile=/)
  assert.match(commands.menu, /NACHO_INSTALL_MODE='menu'/)
  assert.match(commands.silent, /NACHO_INSTALL_MODE='silent'/)
  assert.match(commands.download, /-OutFile nacho\.ps1/)
})

test("裸安装地址保持兼容", () => {
  assert.equal(installScriptUrl("http://localhost:8443"), "http://localhost:8443/nacho.ps1")
  assert.equal(installCommands("http://localhost:8443").standard, 'irm "http://localhost:8443/nacho.ps1" | iex')
})

test("RunMode 可选参数不在 PowerShell 参数绑定阶段拒绝空值", () => {
  const script = fs.readFileSync(path.join(process.cwd(), "..", "server", "deploy", "windows", "nacho.ps1"), "utf8")
  assert.match(script, /^\uFEFF?param\(\s*\[string\]\$RunMode\s*,/)
  assert.doesNotMatch(script, /\[ValidateSet\([^\]]+\)\]\s*\[string\]\$RunMode/)
  assert.match(script, /IsNullOrWhiteSpace\(\$RunMode\)[\s\S]*\$RunMode -notin @\('menu', 'silent'\)/)
})
