import fs from "node:fs"
import os from "node:os"
import path from "node:path"

function isProduction() {
  return process.env.NODE_ENV === "production"
}

export function isDesktopEnvironment() {
  return process.env.NACHO_PANEL_DESKTOP === "1"
}

export function getAIDataDirectory() {
  if (process.env.NACHO_AI_DATA_DIR) return path.resolve(/*turbopackIgnore: true*/ process.env.NACHO_AI_DATA_DIR)
  const localAppData = process.env.LOCALAPPDATA
    || path.join(/*turbopackIgnore: true*/ os.homedir(), "AppData", "Local")
  return path.join(localAppData, isProduction() ? "NachoPanel" : "NachoPanel-dev")
}

export function getAISettingsPath() {
  return path.join(getAIDataDirectory(), "ai-settings.json")
}

export function getAIChatHistoryPath() {
  return path.join(getAIDataDirectory(), "ai-chat-history.json")
}

export function getAIChatSessionMapPath() {
  return path.join(getAIDataDirectory(), "ai-chat-session-map.json")
}

export function getAIRuntimePath() {
  return path.join(getAIDataDirectory(), "ai-runtime.json")
}

export function getAIOpencodeLogPath() {
  return path.join(getAIDataDirectory(), "ai-opencode.log")
}

export function getAIWorkspacePath() {
  return path.join(getAIDataDirectory(), "ai-workspace")
}

export function getOpencodeRoot() {
  return path.join(getAIDataDirectory(), "opencode")
}

export function getOpencodeHomePath() {
  return path.join(getOpencodeRoot(), "home")
}

export function getOpencodeConfigPath() {
  return path.join(getOpencodeRoot(), "config", "opencode")
}

export function getOpencodeDataPath() {
  return path.join(getOpencodeRoot(), "data")
}

export function getOpencodeCachePath() {
  return path.join(getOpencodeRoot(), "cache")
}

export function getOpencodeStatePath() {
  return path.join(getOpencodeRoot(), "state")
}

export function getPanelLocalBaseUrl() {
  const port = process.env.PORT || "3000"
  return `http://127.0.0.1:${port}`
}

export function getOpencodeBinary() {
  return process.env.NACHO_OPENCODE_BINARY || ""
}

export function hasOpencodeBinary() {
  const binary = getOpencodeBinary()
  if (!binary) return false
  try {
    return fs.statSync(binary).isFile()
  } catch {
    return false
  }
}

export function getCredentialProtectorPath() {
  return process.env.NACHO_CREDENTIAL_PROTECTOR || ""
}

export function ensureAIDirectories() {
  const directories = [
    getAIDataDirectory(),
    getAIWorkspacePath(),
    getOpencodeHomePath(),
    getOpencodeConfigPath(),
    getOpencodeDataPath(),
    getOpencodeCachePath(),
    getOpencodeStatePath(),
    path.join(getOpencodeHomePath(), "AppData", "Roaming"),
    path.join(getOpencodeHomePath(), "AppData", "Local"),
  ]
  for (const directory of directories) fs.mkdirSync(directory, { recursive: true })
}
