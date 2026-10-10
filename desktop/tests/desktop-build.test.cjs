const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const desktopDir = path.resolve(__dirname, "..")
const appDir = path.join(desktopDir, "app")

test("staged desktop runtime contains only the panel runtime", () => {
  assert.ok(fs.existsSync(path.join(appDir, "main.cjs")))
  assert.ok(fs.existsSync(path.join(appDir, "preload.cjs")))
  assert.ok(fs.existsSync(path.join(appDir, "connection-store.cjs")))
  assert.ok(fs.existsSync(path.join(appDir, "connection-context.cjs")))
  assert.ok(fs.existsSync(path.join(appDir, "credential-protector.cjs")))
  assert.ok(fs.existsSync(path.join(appDir, "nacho-credential-protector.exe")))
  assert.ok(fs.existsSync(path.join(appDir, "updates.cjs")))
  assert.ok(fs.existsSync(path.join(appDir, "github-download.cjs")))
  assert.ok(fs.existsSync(path.join(appDir, "panel", "panel-runner.cjs")))
  assert.ok(fs.existsSync(path.join(appDir, "panel", "server.js")))
  assert.ok(fs.existsSync(path.join(appDir, "panel-deps", "next", "package.json")))
  assert.equal(fs.existsSync(path.join(appDir, "server")), false)
  assert.equal(fs.existsSync(path.join(appDir, "client")), false)
  const source = path.join(appDir, "update-source.json")
  if (process.env.NACHO_UPDATE_ORIGIN) {
    assert.deepEqual(JSON.parse(fs.readFileSync(source, "utf8")), { origin: process.env.NACHO_UPDATE_ORIGIN })
  } else {
    assert.equal(fs.existsSync(source), false)
  }
})

test("desktop packaging creates a per-user NSIS installer and keeps the external server contract", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"))
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.doesNotMatch(manifest.scripts.build, /bump-version/)
  assert.match(manifest.scripts["build:panel"], /build-panel\.cjs/)
  assert.equal(manifest.build.productName, "NachoPanel")
  assert.equal(manifest.build.npmRebuild, false)
  assert.equal(manifest.build.win.target[0].target, "nsis")
  assert.equal(manifest.build.win.artifactName, "NachoPanel-Setup-${version}.exe")
  assert.equal(manifest.build.nsis.oneClick, false)
  assert.equal(manifest.build.nsis.perMachine, false)
  assert.equal(manifest.build.nsis.allowToChangeInstallationDirectory, true)
  assert.deepEqual(manifest.build.extraResources.map((item) => item.to), ["panel", "panel-deps"])
  assert.match(fs.readFileSync(path.join(desktopDir, "scripts", "stage-app.cjs"), "utf8"), /connection-store\.cjs/)

  const readme = fs.readFileSync(path.join(desktopDir, "README.md"), "utf8")
  assert.match(readme, /NACHO_LOCAL_SERVER_DIR/)
  assert.match(readme, /不包含 `server\/`/)
})

test("staged runtime uses the desktop package version", () => {
  const desktopManifest = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"))
  const runtimeManifest = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"))
  assert.equal(runtimeManifest.version, desktopManifest.version)
  assert.equal(runtimeManifest.releaseChannel, desktopManifest.releaseChannel)
})
