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
关于页从构建信息读取已安装版本与类型，离线也可查看。更新页读取服务器的统一推荐索引；面板和服务端可分别推荐 Beta、Stable 等类型。用户不再切换频道，历史 `update-channel.json` 不参与更新选择。
统一入口 `/updates/index.json` 重定向到 `/updates/revisions/<sequence>/index.json`；签名从同一不可变地址读取。SSE `/updates/events` 仅通知全局序号，收到通知后重新验签。安装与传输绑定已确认的版本及序号；推荐的目标组件变化时重新确认，另一组件变化不影响既有上传。
控制服务缺少更新源、使用旧协议或 Linux 独立升级执行器需要迁移时，只在对应卡片说明原因，面板仍可独立检查和安装自身更新。旧控制服务须安装迁移版本并更新 root 拥有的执行器；Agent 制品准备与逐台／批量手动下发仍是独立操作。

「设置 → 更新」由 Electron 主进程独立读取私有更新服务器的 Ed25519 签名索引，并在确认后校验安装包大小及 SHA-256、静默安装和重启。网页开发版只显示更新信息。
面板卡片在确认安装后立即显示准备状态，下载时展示真实百分比及已下载／总大小，随后进入校验和退出安装阶段。下载中断换源或分段回退时重新计算当前尝试进度；切换页面再返回会从主进程恢复状态。下载达到 100% 仍需通过完整性校验，失败保留错误并可重试；安装交接后继续保持忙碌直至退出。
面板 EXE 的 Authenticode 签名可选；有可信签名时会额外核对索引声明的证书指纹，未签名时索引不包含该字段且不会跳过 Ed25519 和 SHA-256 校验。发布用私钥仅保存在独立更新服务器的受限目录。
打包时指定 `NACHO_UPDATE_ORIGIN=https://更新服务器域名`，桌面封装会将公开更新源地址写入应用，Electron 主进程和其启动的 Next.js 面板服务使用同一地址；未指定时构建仅用于本地开发，发布检查会要求先配置更新源。

## 运行

运行安装包并完成安装，再从快捷方式打开 NachoPanel。运行时文件常驻安装目录，不再像便携版一样每次启动都解包到临时目录。Electron 启动面板的 Next standalone runtime，并在退出时回收该进程。

服务端和 Agent 仍需独立部署。连接远程服务端时，直接在面板中填写服务端地址和 Panel API Key。

如果使用面板中的“Windows 本机控制服务”管理功能，需要通过环境变量提供外部 `server/` 项目目录：

```powershell
$env:NACHO_LOCAL_SERVER_DIR = "C:\Users\Administrator\Documents\Codex\Nacho\nacho-server"
& "$env:LOCALAPPDATA\Programs\NachoPanel\NachoPanel.exe"
```

安装目录中不会复制服务端源码、Agent 源码、SQLite 数据库或运行配置。若选择了其他安装目录，请将示例中的 EXE 路径替换为实际路径。

## AI Mode（桌面本地）

- AI Mode 只在 Windows 桌面版可用。浏览器访问面板时，AI 相关接口返回 `desktop-only`，不会写入任何本机密钥。
- 安装包随附固定版本的 opencode（1.19.5，MIT，见 `THIRD_PARTY_NOTICES.md`），位于 `resources/opencode/opencode.exe`。运行时以 `--pure --hostname 127.0.0.1` 启动，隔离 HOME/XDG 数据目录，不安装外部插件，也不会自我更新。
- 模型 Provider 指向面板进程内的本地代理；真实 API Key 由 DPAPI helper 加密保存在 `%LOCALAPPDATA%\NachoPanel\ai-settings.json`，不会进入 opencode 进程或其日志。
- 本机代码工具（bash/edit/read/grep 等）只作用于面板所在机器；受管客户端操作通过内部 MCP broker 调用控制服务端 `/api/panel/*`。危险操作会等待面板确认，直接调用 broker 也不能绕过。
- opencode 会话、工作区、MCP 配置和日志位于 `%LOCALAPPDATA%\NachoPanel\opencode`、`ai-workspace` 与 `ai-opencode.log`。卸载默认保留 AI 设置与工作区。
- 面板侧会话快照保存在同目录的 `ai-chat-history.json`，`uiSessionId → opencodeSessionId` 映射保存在 `ai-chat-session-map.json`；历史中的图片正文不落盘，重启后显示文件占位。
- 升级 opencode 必须更新 `opencode.lock.json` 并重新执行 `build:opencode`、桌面测试和 EXE 打包；不要在运行时替换二进制。

## GitHub 下载与镜像

本机源码、云端源码和 GitHub 文件下载会在实际下载的机器上并行探测，检测预算为 5 秒。直连成功时优先使用 GitHub；连接失败或超时后依次尝试 `gh-proxy.com`、`ghproxy.net`。公开 API 备用入口仅使用支持 JSON 的 `gh-proxy.com`。能连接但速度慢时不会主动切换（Git 智能协议在国内常被限速，云端部署因此优先改用源码包，见下条）。

GitHub 文件达到 8 MiB 且正确支持 HTTP Range 时，Windows 默认使用最多四路分段下载；小文件、未知大小或不支持分段的端点使用单连接。网络中断后清理本次下载并换源，所有制品仍以签名索引中的官方 URL、大小和 SHA-256 为准。其他来源的下载和上传保持原有方式。

Git 克隆保留浅克隆和实时进度，不使用 HTTP 文件分段。云端部署优先按分支头 commit 下载 GitHub 源码包（codeload，国内实测比 Git 智能协议快一个数量级），源码包根目录固定为 `仓库名-commit`，可据此校验内容归属；缺少 `curl`/`tar`、解析不到提交或校验不符时自动回退浅克隆。桌面构建缺少 GitHub 工具归档缓存时也通过同一下载器预取，并保留构建工具自身的完整性校验。此行为不修改全局 Git、代理或系统 TLS 配置。

## 本机凭据加密与恢复

- v2 连接记录使用 Windows DPAPI `CurrentUser`，由随安装包分发的独立 .NET helper 调用系统 API；只通过匿名 stdin/stdout 管道传输，明文不写入文件、参数或日志。构建增加 .NET 10 SDK 要求，安装后的 helper 为自包含程序。
- v2 不再依赖 Chromium `Local State` 的中间密钥。它仍受 Windows 用户身份约束，不保证迁移到其他账户或重装 Windows 后自动解密。
- 可读的 v1 `safeStorage` 记录在解密和字段校验成功后迁移，原始密文保留；缺少原匹配密钥的 v1 记录保持原样并进入恢复屏，不自动解锁、不回退 localStorage。
- 每次保存先解密验证、写临时文件并落盘，再验证临时及最终磁盘记录；失败恢复原文件。每次读取重新验证磁盘，内存状态不掩盖下次启动失败。
- 安装版显式保留 `%APPDATA%/nacho-panel-runtime` 和 `%LOCALAPPDATA%/NachoPanel`，开发版使用 `nacho-panel-runtime-dev` / `NachoPanel-dev`，防止混用凭据。
- 恢复屏支持重试；用户逐字确认后才能将密文备份并重新建立本机连接／登录方式，用户名、主题和 Linux 服务端保持原样。此流程没有 SSH 恢复功能。
