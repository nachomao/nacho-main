import { spawnSync } from "node:child_process"

export type CredentialProtector = {
  protect: (plaintext: string) => Buffer
  unprotect: (ciphertext: Buffer) => string
}

export class AIDesktopUnavailableError extends Error {
  constructor(message = "AI Mode 仅支持 Windows 桌面版") {
    super(message)
    this.name = "AIDesktopUnavailableError"
  }
}

function run(executable: string, action: "protect" | "unprotect", input: Buffer) {
  const result = spawnSync(executable, [action], {
    input,
    timeout: 15_000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  })
  if (result.error || result.status !== 0 || !result.stdout?.length) {
    throw new Error("Windows 用户凭据保护操作失败")
  }
  return result.stdout
}

export function createCredentialProtector(executable = process.env.NACHO_CREDENTIAL_PROTECTOR): CredentialProtector {
  if (!executable) throw new AIDesktopUnavailableError("缺少 Windows 凭据保护组件")
  return {
    protect: (plaintext) => run(executable, "protect", Buffer.from(plaintext, "utf8")),
    unprotect: (ciphertext) => run(executable, "unprotect", ciphertext).toString("utf8"),
  }
}
