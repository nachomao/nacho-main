const childProcess = require("node:child_process")

/**
 * 启动安装交接脚本。
 *
 * 面板在交接完成后会自己退出，所以安装脚本必须脱离面板的生命周期独立存活。
 * Windows 上用 detached 直接启动的 PowerShell 进程会立刻退出且不执行脚本，
 * 因此这里用 cmd /c start /b 作为承载：它会创建一个不受父进程退出影响的独立进程。
 *
 * @returns {{file: string, args: string[], options: object}}
 */
function handoffLaunch(script, installer, appPath, parentPid, statusPath) {
  const powershell = [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
    "-File", script,
    "-Installer", installer,
    "-AppPath", appPath,
    "-ParentPid", String(parentPid),
    "-StatusPath", statusPath,
  ]
  return {
    file: "cmd.exe",
    args: ["/c", "start", "", "/b", "powershell.exe", ...powershell],
    options: { stdio: "ignore", windowsHide: true },
  }
}

/** 启动安装交接脚本；cmd 退出后脚本继续运行。 */
function startHandoff(script, installer, appPath, parentPid, statusPath) {
  const launch = handoffLaunch(script, installer, appPath, parentPid, statusPath)
  const child = childProcess.spawn(launch.file, launch.args, launch.options)
  // cmd 只负责拉起脚本，随后自行退出；脚本不受父进程退出影响。
  child.unref?.()
  return child
}

/** 等待承载进程真正创建；创建失败时抛出，调用方据此保留面板并允许重试。 */
function waitForHandoff(child) {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve)
    child.once("error", reject)
  })
}

module.exports = { handoffLaunch, startHandoff, waitForHandoff }
