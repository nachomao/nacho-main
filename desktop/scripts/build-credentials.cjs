const path = require("node:path")
const { spawnSync } = require("node:child_process")
const root = path.resolve(__dirname, "..")
const result = spawnSync("dotnet", [
  "publish", path.join(root, "native/Nacho.CredentialProtector/Nacho.CredentialProtector.csproj"),
  "-c", "Release", "-r", "win-x64", "--self-contained", "true",
  "-o", path.join(root, "build/credential-protector"), "--nologo",
], { stdio: "inherit", windowsHide: true })
if (result.error) throw result.error
process.exit(result.status ?? 1)
