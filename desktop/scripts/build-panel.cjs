const { spawnSync } = require("node:child_process")
const path = require("node:path")
const manifest = require("../package.json")
const panel = path.resolve(__dirname, "..", "..", "nacho-panel")
const result = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["build"], {
  cwd: panel,
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_NACHO_PANEL_VERSION: manifest.version },
  shell: process.platform === "win32",
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
