# Nacho

Nacho 由三个组件组成，分布在**两个仓库**：

| 组件 | 仓库 | 路径 |
|---|---|---|
| 面板 Panel | `nachomao/nacho-main`（本仓） | `nacho-panel/` |
| 服务端 Control Server | `nachomao/nacho-server` | 仓库根目录 |
| 客户端 Agent | `nachomao/nacho-server` | `client/` |

三者之间的依赖关系、数据流、凭据模型和**改动归属**见 **[ARCHITECTURE.md](./ARCHITECTURE.md)**。

> 过渡期说明：本仓的 `server/` 目录是拆分前的副本，与 `nachomao/nacho-server` 暂时并存，后续会移除。以 `nachomao/nacho-server` 为服务端唯一来源。

## 面板

```powershell
cd nacho-panel
pnpm dev
```

面板默认地址为 `http://localhost:3000`。

## 服务端部署模式

控制服务端支持三种部署模式。面板和 Agent 每次只连接其中一个；同机并存时为不同模式分配不同端口。

| 模式 | 运行位置 | 进程管理 | 适用场景 |
|---|---|---|---|
| Windows 本机部署 | 当前 Windows 工作区 | 面板本机 API、PowerShell、HKCU 登录自启 | 单机使用、Windows 开发与快速安装 |
| WSL2 部署 | 本机 WSL2 Linux 发行版 | systemd `control-server.service` | 本机 Linux 兼容验证或明确选择的 WSL 常驻服务 |
| Linux 服务器部署 | 独立 Linux 主机 | systemd `control-server.service` | 局域网或生产服务器、多设备接入 |

Windows 本机部署不依赖 WSL；选择 Windows 模式时无需启动 WSL。WSL 与独立 Linux 模式共用 Linux 部署脚本和服务协议，但运行主机、网络地址和数据目录相互独立。

### Windows 本机一键部署

需要 Node.js 22+、npm、完整的服务端源码目录，并从 Windows 启动面板。首次进入引导页，或在“设置 → 连接”中选择“本机部署”，面板会自动生成独立密钥、安装锁定依赖、构建服务端、写入本机配置并启动后台进程；无需手动编辑 `.env` 或执行服务端命令。

默认仅监听 `127.0.0.1:8443`。选择“同一局域网”时才会请求 Windows 管理员授权，并仅创建 `Private + LocalSubnet + 指定 TCP 端口` 的入站规则；“登录后自动启动”使用当前 Windows 用户的 `HKCU` 启动项。设置页也可停止、重启、修复或彻底卸载，卸载会清除本机配置、SQLite 数据、日志、依赖和构建产物，但保留源码。

### WSL2 部署

在 WSL2 Linux 发行版中进入服务端源码根目录，使用 Linux 安装脚本部署。只有明确选择 WSL 模式时才启动发行版；面板连接 WSL 服务的可达地址，不同时依赖 Windows 本机服务。

```bash
cd <nacho-server 仓库根目录>
sudo ./deploy/install.sh
systemctl is-active control-server.service
curl -fsS http://localhost:8443/health
```

### 独立 Linux 服务器部署

Windows 本机面板的首次引导或“设置 → 连接”里可选择“云端服务 → 云端部署”：输入全新 Linux 主机的 IPv4 地址或有 IPv4 A 记录的域名、SSH 用户名和密码（非 root 用户需可用相同密码执行 `sudo`），核对主机 SHA-256 指纹后，面板会通过 SSH/SFTP 传输本机服务端源码及 Windows Agent 发布制品，执行 `install.sh` 并验证服务。域名的全部 A 记录在每次 SSH 连接前校验，连接使用本次校验的 IPv4 地址；指纹变更会中止部署。SSH 密码不会保存；成功后面板按原云端连接方式保存生成的 Panel API Key。自动部署仅在 Windows 本机面板开放，Vercel 预览／部署环境不提供远程 SSH 安装功能；已有控制服务请使用“云端对接”输入 API 地址与 Panel API Key，不会覆盖现有服务器。默认 API 为 `http://主机地址:8443`，公网使用前请配置 HTTPS、访问控制和云服务商防火墙。

也可以手动把服务端源码放到受支持的 Linux 主机后执行同一安装脚本。部署完成后，面板与 Agent 使用该服务器的局域网地址、域名或 HTTPS 地址，而不是各自机器上的 `localhost`。

```bash
cd <nacho-server 仓库根目录>
sudo ./deploy/install.sh
```

安装完成后可直接使用 Linux 运维入口：

```bash
napl
napl status
napl logs --follow
napl backup list
napl update check
```

配置、密钥、恢复、升级和卸载操作要求 root 或可用的 `sudo`；无终端时不会交互提权。入口为 `/usr/local/bin/napl`，卸载时仅移除指向本次安装的入口。备份默认保存在 `/var/backups/control-server`。新版 `napl update check` 从独立更新服务器查询签名索引，源码制品存放于 `nachomao/nacho-server` 的 GitHub Release；源码安装由面板经受认证的 API 上传后交给独立执行器构建与回滚。旧式预构建包仍验证独立签名和 manifest 哈希。

## 服务端开发运行

```bash
git clone https://github.com/nachomao/nacho-server.git
cd nacho-server
npm ci
npm run build
npm start
```

服务端的部署、Windows Agent 与制品说明见 [`nacho-server/README.md`](https://github.com/nachomao/nacho-server)。面板说明见 [`nacho-panel/README.md`](nacho-panel/README.md)。

