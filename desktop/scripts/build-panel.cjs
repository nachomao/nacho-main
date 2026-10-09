const { spawnSync } = require("node:child_process")
const path = require("node:path")
const manifest = require("../package.json")
if (!["stable", "beta", "alpha"].includes(manifest.releaseChannel)) throw new Error("面板发布频道无效")
const panel = path.resolve(__dirname, "..", "..", "nacho-panel")
const result = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["build"], {
  cwd: panel,
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_NACHO_PANEL_VERSION: manifest.version,
    NEXT_PUBLIC_NACHO_PANEL_CHANNEL: manifest.releaseChannel },
  shell: process.platform === "win32",
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
