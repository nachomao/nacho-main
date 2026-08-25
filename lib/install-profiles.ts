import { normalizeServerBaseUrl } from "./server-connection"

export type InstallRunMode = "menu" | "silent"

export type InstallProfileValues = {
  name: string
  runMode: InstallRunMode
  agentServerUrl: string | null
  heartbeatSeconds: number
  pollSeconds: number
  clientName: string | null
  group: string
  tags: string[]
  overwriteExisting: boolean
  reEnrollOnServerChange: boolean
}

export type InstallProfile = InstallProfileValues & {
  id: string
  isDefault: boolean
  revision: number
  activeRevision: number
  createdAt: number
  updatedAt: number
}

export type InstallProfileRevision = {
  profileId: string
  revision: number
  snapshot: InstallProfileValues
  note: string
  createdAt: number
}

export const defaultInstallProfileValues: InstallProfileValues = {
  name: "新安装档案",
  runMode: "menu",
  agentServerUrl: null,
  heartbeatSeconds: 20,
  pollSeconds: 15,
  clientName: null,
  group: "默认分组",
  tags: [],
  overwriteExisting: false,
  reEnrollOnServerChange: false,
}

export function installScriptUrl(serverBaseUrl: string, profileId?: string): string {
  const base = normalizeServerBaseUrl(serverBaseUrl)
  return profileId ? `${base}/install.ps1?profile=${encodeURIComponent(profileId)}` : `${base}/install.ps1`
}

export function installCommands(serverBaseUrl: string, profileId?: string) {
  const url = installScriptUrl(serverBaseUrl, profileId)
  return {
    standard: `irm "${url}" | iex`,
    menu: `& { $env:NACHO_INSTALL_MODE='menu'; irm "${url}" | iex }`,
    silent: `& { $env:NACHO_INSTALL_MODE='silent'; irm "${url}" | iex }`,
    download: `iwr "${url}" -OutFile install.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File .\\install.ps1`,
    boot: `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm '${url}' | iex"`,
  }
}
