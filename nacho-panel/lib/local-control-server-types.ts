export const LOCAL_CONTROL_UNINSTALL_CONFIRMATION = "彻底卸载本地服务"

export type LocalControlAccessMode = "loopback" | "lan"
export type LocalControlRuntimeStatus =
  | "unsupported"
  | "not-installed"
  | "stopped"
  | "starting"
  | "running"
  | "unhealthy"

export type LocalControlServerStatus = {
  platformSupported: boolean
  runtimeStatus: LocalControlRuntimeStatus
  installed: boolean
  running: boolean
  healthy: boolean
  needsRepair: boolean
  pid: number | null
  startedAt: string | null
  autoStartEnabled: boolean
  accessMode: LocalControlAccessMode
  host: string
  port: number
  firewallEnabled: boolean
  firewallNeedsCleanup: boolean
  serverDir: string
  databasePath: string
  localAddresses: string[]
  connection: { api: string; agentApi: string; key: string } | null
  prerequisites: {
    node: boolean
    nodeVersion: string
    npm: boolean
    source: boolean
  }
  issues: string[]
}

export type LocalControlInstallOptions = {
  accessMode: LocalControlAccessMode
  autoStart: boolean
  port?: number
}

export type LocalControlAction = "install" | "start" | "stop" | "restart" | "repair"
