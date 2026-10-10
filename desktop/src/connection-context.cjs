const fs = require("node:fs")
const path = require("node:path")

/** 保持已安装实例的历史 profile 名称；开发实例使用另一目录及另一连接文件。 */
function configureConnectionContext(app, env = process.env) {
  const packaged = app.isPackaged === true
  const userData = path.join(app.getPath("appData"), packaged ? "nacho-panel-runtime" : "nacho-panel-runtime-dev")
  const localRoot = env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local")
  const dataDirectory = path.join(localRoot, packaged ? "NachoPanel" : "NachoPanel-dev")
  fs.mkdirSync(userData, { recursive: true })
  app.setPath("userData", userData)
  app.setPath("sessionData", userData)
  return {
    userData, dataDirectory,
    filePath: path.join(dataDirectory, "connection-secrets.json"),
    archivedPath: packaged ? path.join(dataDirectory, "connection-secrets-before-0.2.2.json") : null,
  }
}

module.exports = { configureConnectionContext }
