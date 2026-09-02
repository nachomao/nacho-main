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
  return profileId ? `${base}/nacho.ps1?profile=${encodeURIComponent(profileId)}` : `${base}/nacho.ps1`
}

function psSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function installCommands(serverBaseUrl: string, profileId?: string, enrollmentKey?: string) {
  const url = installScriptUrl(serverBaseUrl, profileId)
  const key = enrollmentKey?.trim() || ""
  const prefix = key ? `$env:NACHO_ENROLLMENT_KEY=${psSingleQuoted(key)}; ` : ""
  return {
    standard: `${prefix}irm "${url}" | iex`,
    menu: `& { ${prefix}$env:NACHO_INSTALL_MODE='menu'; irm "${url}" | iex }`,
    silent: `& { ${prefix}$env:NACHO_INSTALL_MODE='silent'; irm "${url}" | iex }`,
    download: `iwr "${url}" -OutFile nacho.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File .\\nacho.ps1${key ? ` -EnrollmentKey ${psSingleQuoted(key)}` : ""}`,
    boot: `powershell -NoProfile -ExecutionPolicy Bypass -Command "${prefix.replaceAll('"', '`"')}irm '${url}' | iex"`,
  }
}
