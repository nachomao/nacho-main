import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { isIP } from "node:net"
import os from "node:os"
import path from "node:path"
import { Client, type SFTPWrapper } from "ssh2"
import { create as createTar } from "tar"
import { resolveLocalServerDirectory } from "./local-control-server"

type Target = { host: string; username: string; password: string; fingerprint: string }
export type CloudDeploymentResult = { api: string; key: string }

export class CloudDeploymentError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

export function validateCloudHost(value: unknown) {
  if (typeof value !== "string" || isIP(value) !== 4) {
    throw new CloudDeploymentError("请输入目标 Linux 服务器的 IPv4 地址")
  }
  const [first, second] = value.split(".").map(Number)
  if (first === 0 || first === 127 || first >= 224 || (first === 169 && second === 254)) {
    throw new CloudDeploymentError("不支持回环、链路本地或保留地址")
  }
  return value
}

export function validateCloudDeployInput(value: unknown): Target {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CloudDeploymentError("请求体无效")
  const body = value as Record<string, unknown>
  if (Object.keys(body).some((field) => !["action", "host", "username", "password", "fingerprint"].includes(field))) {
    throw new CloudDeploymentError("请求包含不支持的字段")
  }
  const host = validateCloudHost(body.host)
  if (typeof body.username !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(body.username)) {
    throw new CloudDeploymentError("Linux 用户名无效")
  }
  if (typeof body.password !== "string" || !body.password || body.password.length > 256 || /[\r\n]/.test(body.password)) {
    throw new CloudDeploymentError("请输入 SSH 登录密码")
  }
  if (typeof body.fingerprint !== "string" || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(body.fingerprint)) {
    throw new CloudDeploymentError("请先核对 SSH 主机指纹")
  }
  return { host, username: body.username, password: body.password, fingerprint: body.fingerprint }
}

function sha256Fingerprint(key: Buffer) {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`
}

export function inspectCloudHost(host: string): Promise<string> {
  const target = validateCloudHost(host)
  return new Promise((resolve, reject) => {
    const client = new Client()
    let fingerprint: string | null = null
    client.on("error", () => {
      client.end()
      if (fingerprint) resolve(fingerprint)
      else reject(new CloudDeploymentError("无法连接目标 SSH 服务，请检查 IP 与 22 端口", 502))
    })
    client.on("ready", () => {
      client.end()
      reject(new CloudDeploymentError("无法读取目标 SSH 主机指纹", 502))
    })
    client.connect({
      host: target,
      port: 22,
      username: "nacho-host-check",
      readyTimeout: 10_000,
      hostVerifier: (key: Buffer) => {
        fingerprint = sha256Fingerprint(key)
        return false
      },
    })
  })
}

function connectCloudHost(target: Target): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let mismatch = false
    client.once("ready", () => resolve(client))
    client.once("error", () => {
      client.end()
      reject(new CloudDeploymentError(
        mismatch ? "SSH 主机指纹已变化，已中止连接；请重新核对服务器身份" : "SSH 登录失败，请检查 IP、用户名、密码及 22 端口",
        mismatch ? 409 : 502,
      ))
    })
    client.connect({
      host: target.host,
      port: 22,
      username: target.username,
      password: target.password,
      readyTimeout: 15_000,
      hostVerifier: (key: Buffer) => {
        mismatch = sha256Fingerprint(key) !== target.fingerprint
        return !mismatch
      },
    })
  })
}

function runRemote(client: Client, command: string, sudoPassword?: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, channel) => {
      if (error) return reject(new CloudDeploymentError("无法执行远程部署命令", 502))
      let output = ""
      const timeout = setTimeout(() => {
        channel.close()
        reject(new CloudDeploymentError("远程命令执行超时，请检查目标系统", 504))
      }, 15 * 60_000)
      timeout.unref()
      channel.on("data", (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-4096) })
      channel.on("error", () => {
        clearTimeout(timeout)
        reject(new CloudDeploymentError("远程命令连接中断", 502))
      })
      channel.on("close", (code: number | null) => {
        clearTimeout(timeout)
        resolve({ code: code ?? -1, output: output.trim() })
      })
      if (sudoPassword !== undefined) channel.end(`${sudoPassword}\n`)
      else channel.end()
    })
  })
}

function runAsRoot(client: Client, username: string, password: string, script: string) {
  const quoted = `'${script.replaceAll("'", "'\\''")}'`
  const command = username === "root" ? `sh -c ${quoted}` : `sudo -S -p '' sh -c ${quoted}`
  return runRemote(client, command, username === "root" ? undefined : password)
}

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) reject(new CloudDeploymentError("远程服务器未启用 SFTP 文件传输", 502))
      else resolve(sftp)
    })
  })
}

function upload(sftp: SFTPWrapper, local: string, remote: string) {
  return new Promise<void>((resolve, reject) => {
    sftp.fastPut(local, remote, (error) => {
      if (error) reject(new CloudDeploymentError("部署包传输失败，请检查远程磁盘空间和 SFTP 权限", 502))
      else resolve()
    })
  })
}

export async function createBundle(directory: string, destination: string) {
  const manifest = JSON.parse(await readFile(path.join(directory, "artifacts/windows/latest.json"), "utf8")) as {
    fileName?: string; sha256?: string
  }
  if (!manifest.fileName || !/^nacho-agent-[a-zA-Z0-9.-]+-win-x64\.exe$/.test(manifest.fileName) || !/^[a-fA-F0-9]{64}$/.test(manifest.sha256 || "")) {
    throw new CloudDeploymentError("Windows Agent 发布清单无效，请先发布制品", 500)
  }
  const artifact = path.join(directory, "artifacts/windows", manifest.fileName)
  const size = (await stat(artifact)).size
  if (size > 200 * 1024 * 1024) throw new CloudDeploymentError("Agent 发布制品过大", 500)
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(artifact)) hash.update(chunk)
  if (hash.digest("hex").toLowerCase() !== manifest.sha256?.toLowerCase()) {
    throw new CloudDeploymentError("Agent 发布制品 SHA-256 校验失败", 500)
  }
  await createTar({ cwd: directory, file: destination, gzip: true, portable: true }, [
    "package.json", "package-lock.json", "tsconfig.json", "src", "deploy/install.sh", "deploy/uninstall.sh",
    "artifacts/windows/latest.json", `artifacts/windows/${manifest.fileName}`,
  ])
}

export async function deployCloudServer(target: Target, onProgress: (step: string) => void): Promise<CloudDeploymentResult> {
  const client = await connectCloudHost(target)
  let remoteDirectory: string | null = null
  let localDirectory: string | null = null
  try {
    onProgress("检查目标系统与现有安装")
    const privilege = await runAsRoot(client, target.username, target.password, "id -u")
    if (privilege.code !== 0 || privilege.output !== "0") {
      throw new CloudDeploymentError("当前用户无法以 root 权限运行，请确认 sudo 权限及密码", 403)
    }
    const check = await runAsRoot(client, target.username, target.password,
      "test -f /etc/os-release && command -v systemctl >/dev/null",
    )
    if (check.code !== 0) throw new CloudDeploymentError("目标需为支持 systemd 的 Linux 服务器", 400)
    const existing = await runAsRoot(client, target.username, target.password,
      "test -e /opt/control-server || test -e /var/lib/control-server || test -e /etc/systemd/system/control-server.service",
    )
    if (existing.code === 0) throw new CloudDeploymentError("检测到已有部署，已停止以避免覆盖数据；请改用云端对接", 409)
    if (existing.code !== 1) throw new CloudDeploymentError("无法确认目标服务状态，已中止部署", 502)

    onProgress("核对并打包服务端与 Agent 制品")
    const serverDirectory = await resolveLocalServerDirectory()
    localDirectory = await mkdtemp(path.join(os.tmpdir(), "nacho-cloud-"))
    const bundle = path.join(localDirectory, "bundle.tar.gz")
    await createBundle(serverDirectory, bundle)

    const temporary = await runRemote(client, "mktemp -d /tmp/nacho-deploy.XXXXXXXXXX")
    if (temporary.code !== 0 || !/^\/tmp\/nacho-deploy\.[A-Za-z0-9]+$/.test(temporary.output)) {
      throw new CloudDeploymentError("无法在目标服务器创建临时部署目录", 502)
    }
    remoteDirectory = temporary.output

    onProgress("加密传输部署包")
    await upload(await openSftp(client), bundle, `${remoteDirectory}/bundle.tar.gz`)

    onProgress("安装 Node.js、构建服务并配置 systemd")
    const install = await runAsRoot(client, target.username, target.password,
      `set -e; test ! -e /opt/control-server && test ! -e /var/lib/control-server && test ! -e /etc/systemd/system/control-server.service || exit 42; tar -xzf ${remoteDirectory}/bundle.tar.gz -C ${remoteDirectory}; bash ${remoteDirectory}/deploy/install.sh >/dev/null 2>&1`,
    )
    const rollback = async () => {
      onProgress("安装未完成，正在清理本次部署")
      const cleanup = await runAsRoot(client, target.username, target.password,
        `set -e; bash ${remoteDirectory}/deploy/uninstall.sh >/dev/null 2>&1; rm -rf /var/lib/control-server`,
      ).catch(() => null)
      return cleanup?.code === 0
    }
    if (install.code !== 0) {
      if (install.code === 42) throw new CloudDeploymentError("检测到已有部署，已停止以避免覆盖数据；请改用云端对接", 409)
      const cleaned = await rollback()
      throw new CloudDeploymentError(cleaned
        ? "远程安装失败，本次服务与数据已清理；请检查目标系统权限、网络与磁盘空间"
        : "远程安装失败，自动清理未完成；请检查目标服务器后再试", 502)
    }

    onProgress("验证服务状态并读取面板密钥")
    const health = await runRemote(client, "node -e 'fetch(\"http://127.0.0.1:8443/health\").then(r=>r.json()).then(v=>process.exit(v.ok && v.service===\"nacho-server\"?0:1)).catch(()=>process.exit(1))'")
    if (health.code !== 0) {
      const cleaned = await rollback()
      throw new CloudDeploymentError(cleaned ? "服务健康检查未通过，已清理本次安装" : "服务健康检查未通过，自动清理未完成；请检查目标服务器", 502)
    }
    const secret = await runAsRoot(client, target.username, target.password,
      "sed -n 's/^PANEL_API_KEY=//p' /opt/control-server/.env",
    )
    if (secret.code !== 0 || !/^[a-fA-F0-9]{48}$/.test(secret.output)) {
      const cleaned = await rollback()
      throw new CloudDeploymentError(cleaned ? "读取面板密钥失败，已清理本次安装" : "读取面板密钥失败，自动清理未完成；请检查目标服务器", 502)
    }
    return { api: `http://${target.host}:8443`, key: secret.output }
  } finally {
    if (remoteDirectory) await runRemote(client, `rm -rf ${remoteDirectory}`).catch(() => undefined)
    client.end()
    if (localDirectory) await rm(localDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}
