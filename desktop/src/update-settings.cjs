"use strict"

const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const { CHANNELS, OFFICIAL_PROFILE, validateProfile, fingerprint } = require("./release-manifest.cjs")
const { deviceIdForAuthKey, generateDeviceIdentity } = require("./envelope-crypto.cjs")

const SETTINGS_NAME = "github-update-settings-v5.json"
const DEVICE_IDENTITY_NAME = "device-identity-v6.dpapi"
const MAX_SETTINGS_BYTES = 32 * 1024

function loadSettings(directory) {
  try {
    const file = path.join(directory, SETTINGS_NAME)
    if (fs.statSync(file).size > MAX_SETTINGS_BYTES) throw new Error("更新来源配置过大")
    const { profileId, channel, profiles } = JSON.parse(fs.readFileSync(file, "utf8"))
    if (!CHANNELS.includes(channel) || !Array.isArray(profiles) || profiles.length > 8) throw new Error("更新来源配置无效")
    const entries = profiles.map(({ profile: raw, signerFingerprint }) => {
      const profile = validateProfile(raw)
      if (profile.id === "official" || fingerprint(profile.publicKey) !== signerFingerprint) throw new Error("第三方更新指纹不匹配")
      return { profile, signerFingerprint }
    })
    const ids = new Set(["official", ...entries.map(({ profile }) => profile.id)])
    if (!ids.has(profileId) || ids.size !== entries.length + 1) throw new Error("更新来源配置不一致")
    return { profileId, channel, profiles: entries }
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("已保存的 GitHub 更新来源配置无效")
    return { profileId: "official", channel: "stable", profiles: [] }
  }
}

function selectedProfile(directory) {
  const saved = loadSettings(directory)
  return {
    channel: saved.channel,
    profile: saved.profileId === "official" ? OFFICIAL_PROFILE : saved.profiles.find(({ profile }) => profile.id === saved.profileId).profile,
  }
}

function writePrivate(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, data, { flag: "wx", mode: 0o600 })
    fs.renameSync(temporary, file)
  } finally { fs.rmSync(temporary, { force: true }) }
}

/**
 * 更新设置与机器层设备身份管理（零手工密钥导入）：
 * - 设备身份（Ed25519 认证密钥 + X25519 信封加密密钥）自动生成并写入系统 DPAPI（safeStorage）。
 * - 用户全程不接触、不输入、不导出任何私钥或测试密钥。
 */
function createUpdateSettings({ directory, safeStorage }) {
  const identityFile = path.join(directory, DEVICE_IDENTITY_NAME)
  const settingsFile = path.join(directory, SETTINGS_NAME)
  const official = { profile: OFFICIAL_PROFILE, signerFingerprint: fingerprint(OFFICIAL_PROFILE.publicKey) }

  function canEncrypt() {
    return Boolean(safeStorage?.isEncryptionAvailable?.() && safeStorage.getSelectedStorageBackend?.() !== "basic_text")
  }

  function loadDeviceIdentity() {
    if (!fs.existsSync(identityFile) || !canEncrypt()) return null
    try {
      if (fs.statSync(identityFile).size > 16 * 1024) return null
      const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(identityFile)))
      if (!parsed?.auth?.publicKey || !parsed?.auth?.privateKey || !parsed?.encryption?.publicKey || !parsed?.encryption?.privateKey) {
        return null
      }
      const derived = deviceIdForAuthKey(parsed.auth.publicKey)
      if (parsed.deviceId !== derived) return null
      return parsed
    } catch {
      return null
    }
  }

  function getOrCreateDeviceIdentity() {
    const existing = loadDeviceIdentity()
    if (existing) return existing
    if (!canEncrypt()) throw new Error("系统加密存储不可用，无法创建本机设备身份")
    const identity = generateDeviceIdentity()
    const protectedData = safeStorage.encryptString(JSON.stringify(identity))
    writePrivate(identityFile, protectedData)
    return identity
  }

  function read() {
    const { profileId, channel, profiles } = loadSettings(directory)
    const identity = loadDeviceIdentity()
    return {
      profileId,
      channel,
      deviceId: identity?.deviceId ?? null,
      profiles: [official, ...profiles].map(({ profile, signerFingerprint }) => ({
        id: profile.id, label: profile.label || (profile.id === "official" ? "官方" : profile.id),
        official: profile.id === "official", repositories: profile.repositories, signerFingerprint,
      })),
    }
  }

  function save(settings) {
    writePrivate(settingsFile, JSON.stringify(settings))
    return read()
  }

  function select(profileId, channel) {
    const settings = loadSettings(directory)
    if (!CHANNELS.includes(channel) || (profileId !== "official" && !settings.profiles.some(({ profile }) => profile.id === profileId))) {
      throw new Error("请选择已信任的来源与频道")
    }
    return save({ ...settings, profileId, channel })
  }

  function trustProfile(raw, fingerprintInput) {
    const profile = validateProfile(raw)
    const settings = loadSettings(directory)
    if (profile.id === "official") throw new Error("官方更新来源不得覆盖")
    if (settings.profiles.some((entry) => entry.profile.id === profile.id)) throw new Error("更新来源配置名已存在；请先移除旧配置")
    if (settings.profiles.length >= 8) throw new Error("第三方更新来源数量已达上限")
    const signerFingerprint = fingerprint(profile.publicKey)
    if (typeof fingerprintInput !== "string" || fingerprintInput.length > 200 ||
        fingerprintInput.trim().toLowerCase().replaceAll(":", "") !== signerFingerprint) {
      throw new Error("必须输入从独立渠道确认的匹配 Ed25519 SHA-256 指纹")
    }
    return save({ ...settings, profiles: [...settings.profiles, { profile, signerFingerprint }] })
  }

  function removeProfile(id) {
    const settings = loadSettings(directory)
    if (id === "official" || !settings.profiles.some(({ profile }) => profile.id === id)) throw new Error("第三方更新来源不存在")
    const selection = settings.profileId === id ? { profileId: "official", channel: "stable" } : {}
    return save({ ...settings, ...selection, profiles: settings.profiles.filter(({ profile }) => profile.id !== id) })
  }

  return {
    read,
    select,
    trustProfile,
    removeProfile,
    selection: () => selectedProfile(directory),
    getOrCreateDeviceIdentity,
    getDeviceIdentity: loadDeviceIdentity,
  }
}

module.exports = { createUpdateSettings, selectedProfile }
