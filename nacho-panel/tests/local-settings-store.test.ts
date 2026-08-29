import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { after, before, test } from "node:test"
import { MAX_CUSTOM_AVATAR_LENGTH, defaultLocalSettings } from "../lib/local-settings-schema"
import {
  LocalSettingsValidationError,
  getLocalSettingsPath,
  patchLocalSettings,
  readLocalSettings,
  resetLocalSettings,
} from "../lib/local-settings-store"

let temporaryDirectory = ""

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "nacho-local-settings-"))
  process.env.NACHO_PANEL_SETTINGS_PATH = path.join(temporaryDirectory, "panel-settings.json")
})

after(async () => {
  delete process.env.NACHO_PANEL_SETTINGS_PATH
  await rm(temporaryDirectory, { recursive: true, force: true })
})

test("missing settings return defaults without claiming a persisted file", async () => {
  const snapshot = await readLocalSettings()
  assert.deepEqual(snapshot, { settings: defaultLocalSettings(), exists: false, recovered: false })
})

test("patches are validated, merged, and persisted", async () => {
  const saved = await patchLocalSettings({
    profile: { userName: "  Alice  ", avatarId: "ghost" },
    theme: "green",
    onboardingCompleted: true,
  })
  assert.equal(saved.profile.userName, "Alice")
  assert.equal(saved.profile.avatarId, "ghost")
  assert.equal(saved.theme, "green")
  assert.equal(saved.onboardingCompleted, true)

  const disk = JSON.parse(await readFile(getLocalSettingsPath(), "utf8"))
  assert.deepEqual(disk, saved)

  const second = await patchLocalSettings({ profile: { avatarId: "cat" } })
  assert.equal(second.profile.userName, "Alice")
  assert.equal(second.theme, "green")
})

test("unknown fields and invalid custom avatars are rejected", async () => {
  await assert.rejects(
    () => patchLocalSettings({ unexpected: true }),
    LocalSettingsValidationError,
  )
  await assert.rejects(
    () => patchLocalSettings({ profile: { avatarId: "custom", customAvatar: null } }),
    LocalSettingsValidationError,
  )
  await assert.rejects(
    () => patchLocalSettings({ profile: { customAvatar: `data:image/png;base64,${"A".repeat(MAX_CUSTOM_AVATAR_LENGTH)}` } }),
    LocalSettingsValidationError,
  )
})

test("corrupt files are backed up and replaced with defaults", async () => {
  await writeFile(getLocalSettingsPath(), "{broken", "utf8")
  const snapshot = await readLocalSettings()
  assert.deepEqual(snapshot, { settings: defaultLocalSettings(), exists: true, recovered: true })

  const names = await readdir(temporaryDirectory)
  assert.ok(names.some((name) => name.startsWith("panel-settings.json.corrupt-")))
  assert.deepEqual(JSON.parse(await readFile(getLocalSettingsPath(), "utf8")), defaultLocalSettings())
})

test("reset persists defaults and prevents legacy remigration", async () => {
  await patchLocalSettings({ theme: "rose", onboardingCompleted: true })
  const reset = await resetLocalSettings()
  const resetDefaults = { ...defaultLocalSettings(), legacyMigrationVersion: 1 }
  assert.deepEqual(reset, resetDefaults)

  const snapshot = await readLocalSettings()
  assert.deepEqual(snapshot, { settings: resetDefaults, exists: true, recovered: false })
})
