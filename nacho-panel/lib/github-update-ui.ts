import type { PanelInstallState } from "./panel-install-progress"

export type ReleaseChannel = "stable" | "beta" | "alpha"
export type ReleaseTarget = { profileId: string; channel: ReleaseChannel; component: "panel" | "server"; version: string; digest: string }
export type DesktopRelease = {
  target: ReleaseTarget
  repository: string
  sourceRepository: string
  title: string
  notes: string
  official: boolean
  signerFingerprint: string
  publishedAt: string | null
  access: "public" | "key"
  compatibility: { minPanelVersion: string; minServerVersion: string; minAgentVersion: string }
  sizeBytesByAsset: Partial<Record<"installer" | "source" | "agent", number>>
}
export type ReleasePart = { status: "available" | "not-found" | "locked" | "stale" | "error"; release: DesktopRelease | null; message?: string }
export type GithubCheck = { channel: ReleaseChannel; profileId: string; currentVersion: string; checkedAt?: string; components: { panel: ReleasePart; server: ReleasePart } }
export type UpdateSettings = {
  channel: ReleaseChannel; profileId: string; deviceId?: string | null
  profiles: Array<{ id: string; label: string; official: boolean; signerFingerprint: string; repositories: Record<ReleaseChannel, { panel: string; server: string }> }>
}
export type UpdateBridge = {
  version?: string
  check(force?: boolean): Promise<GithubCheck>
  installPanel(target: ReleaseTarget): Promise<unknown>
  installLocalServer(target: ReleaseTarget): Promise<unknown>
  transferRelease(kind: "server" | "agent", target: ReleaseTarget): Promise<unknown>
  readSettings(): Promise<UpdateSettings>
  select(profile: string, channel: ReleaseChannel): Promise<UpdateSettings>
  trustProfile(profileJson: string, fingerprint: string): Promise<UpdateSettings>
  removeProfile(id: string): Promise<UpdateSettings>
  onAvailable?(callback: (check: GithubCheck) => void): (() => void) | undefined
  getPanelInstallState?(): Promise<PanelInstallState>
  onPanelInstallProgress?(callback: (state: PanelInstallState) => void): (() => void) | undefined
  onTransferProgress?(callback: (percent: number) => void): (() => void) | undefined
}

declare global { interface Window { nachoUpdates?: UpdateBridge } }

export function versionOrder(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(a) ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(b)) return null
  const x = a.split(".").map(Number)
  const y = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

export function canOfferInstall(part: ReleasePart | undefined, installed: string | null, allowMissing = false) {
  return Boolean(part?.status === "available" && part.release &&
    ((installed === null && allowMissing) || versionOrder(installed, part.release.target.version) === -1))
}

export function installationSourceNotice(release: DesktopRelease) {
  return release.official ? null : "非官方来源 · 签名已验证：" + release.repository + " · " + release.signerFingerprint
}
