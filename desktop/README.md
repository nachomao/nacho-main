# NachoPanel Windows 安装版

`desktop/` 只封装 `nacho-panel/`，不包含 `server/` 和 Windows Agent。

## 构建

在仓库根目录执行：

```powershell
pnpm --dir desktop install --frozen-lockfile
pnpm --dir desktop run build
```

构建结果：

```text
desktop/dist/NachoPanel/NachoPanel-Setup-<version>.exe
```

这是 Windows x64 NSIS 安装包。安装向导允许选择安装目录，默认按当前用户安装，并创建桌面和开始菜单快捷方式。

构建不会自动递增版本。正式发布前显式修改 `desktop/package.json` 的 `version` 和 `releaseChannel`（`stable` / `beta` / `alpha`）；普通测试构建不会被当作新版。
关于页从构建信息读取版本，显示为 `X.Y.Z Stable`、`X.Y.Z Beta` 或 `X.Y.Z Alpha`，离线也可查看。新安装默认检查构建对应的更新频道；升级保留用户已选择的频道，切换更新频道不会改变当前安装版本的标识。

「设置 → 更新」由 Electron 主进程独立读取私有更新服务器的 Ed25519 签名索引，并在确认后校验安装包大小及 SHA-256、静默安装和重启。网页开发版只显示更新信息。
面板 EXE 的 Authenticode 签名可选；有可信签名时会额外核对索引声明的证书指纹，未签名时索引不包含该字段且不会跳过 Ed25519 和 SHA-256 校验。发布用私钥仅保存在独立更新服务器的受限目录。
打包时指定 `NACHO_UPDATE_ORIGIN=https://更新服务器域名`，桌面封装会将公开更新源地址写入应用，Electron 主进程和其启动的 Next.js 面板服务使用同一地址；未指定时构建仅用于本地开发，发布检查会要求先配置更新源。

## 运行

运行安装包并完成安装，再从快捷方式打开 NachoPanel。运行时文件常驻安装目录，不再像便携版一样每次启动都解包到临时目录。Electron 启动面板的 Next standalone runtime，并在退出时回收该进程。

服务端和 Agent 仍需独立部署。连接远程服务端时，直接在面板中填写服务端地址和 Panel API Key。

如果使用面板中的“Windows 本机控制服务”管理功能，需要通过环境变量提供外部 `server/` 项目目录：

```powershell
$env:NACHO_LOCAL_SERVER_DIR = "C:\Users\Administrator\Documents\Codex\Nacho\nacho-main\server"
& "$env:LOCALAPPDATA\Programs\NachoPanel\NachoPanel.exe"
```

安装目录中不会复制服务端源码、Agent 源码、SQLite 数据库或运行配置。若选择了其他安装目录，请将示例中的 EXE 路径替换为实际路径。

## GitHub 下载与镜像

本机源码、云端源码和 GitHub 文件下载会在实际下载的机器上并行探测，检测预算为 5 秒。直连成功时优先使用 GitHub；连接失败或超时后依次尝试 `gh-proxy.com`、`ghfast.top`。公开 API 备用入口仅使用支持 JSON 的 `gh-proxy.com`。能连接但速度慢时不会主动切换。

GitHub 文件达到 8 MiB 且正确支持 HTTP Range 时，Windows 默认使用最多四路分段下载；小文件、未知大小或不支持分段的端点使用单连接。网络中断后清理本次下载并换源，所有制品仍以签名索引中的官方 URL、大小和 SHA-256 为准。其他来源的下载和上传保持原有方式。

Git 克隆保留浅克隆和实时进度，不使用 HTTP 文件分段。桌面构建缺少 GitHub 工具归档缓存时也通过同一下载器预取，并保留构建工具自身的完整性校验。此行为不修改全局 Git、代理或系统 TLS 配置。
