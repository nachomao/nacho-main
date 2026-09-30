# Nacho 三层架构

本文说明 Nacho 三个组件之间的依赖关系：**谁提供什么、谁调用谁、改动落在哪个仓库**。

只想跑起来请看 [README.md](./README.md)；想知道"改这个功能要动哪几个仓"请直接跳到 [§6 改动归属](#6-改动归属)。

---

## 1. 三个组件与仓库映射

| 组件 | 职责 | 仓库 | 路径 | 技术栈 |
|---|---|---|---|---|
| **面板** Panel | 唯一的用户界面。不存任何业务数据 | `nachomao/nacho-main` | `nacho-panel/` | Next.js 16 App Router、React 19、TypeScript、Tailwind 4 |
| **服务端** Control Server | 唯一持久化与调度中心。存数据、管注册、向面板供 API、向 Agent 下发指令 | `nachomao/nacho-server` | 仓库根目录（`src/`） | Node.js ≥22、Express 4、WebSocket、Zod、`node:sqlite` |
| **客户端** Agent | 在目标 Windows 机器上执行指令 | `nachomao/nacho-server` | `client/` | .NET 10、Windows Service、自包含 `win-x64` |

> 服务端与 Agent 同仓，因为发布链是闭合的：
> `client/deploy/publish.ps1` → `artifacts/windows/*.exe` → `deploy/install.sh` 校验 SHA-256 → 服务端对外提供下载路由。
> 拆成两仓会让这条链多一层跨仓依赖。

---

## 2. 运行时拓扑

```
┌──────────────┐   ① Panel API Key    ┌──────────────────┐  ② 设备 token + WS  ┌──────────────┐
│    面板      │ ───────────────────▶ │     服务端        │ ◀──────────────────▶ │    Agent     │
│  nacho-main  │ ◀─────────────────── │  nacho-server    │   ③ Enrollment Key  │  (每台 Windows)│
│              │   /api/panel/*      │                  │                      │              │
│  浏览器 UI   │                     │  SQLite (唯一库)  │                      │  串行执行器   │
└──────────────┘                     └──────────────────┘                      └──────────────┘
        │                                     │                                      ▲
        │  ④ SSH/SFTP 下发安装                  │  ⑤ 公共下载路由                        │
        └────────────────────────────────────▶│  /nacho.ps1、/agent/downloads/windows/* │
                                              └──────────────────────────────────────┘
```

编号对应三种凭据与两条安装链路，见 §3、§4。

---

## 3. 三种凭据（最常被搞混的部分）

它们**互相独立**，不能互换、不能复用同一个值：

| 凭据 | 在哪里 | 用来做什么 | 谁持有 |
|---|---|---|---|
| ① **Panel API Key** | 服务端 `.env` 的 `PANEL_API_KEY` | 面板调 `/api/panel/*` 时的 `Authorization: Bearer <key>` | 管理员，填进面板"设置 → 服务端连接" |
| ② **设备 token** | Agent 首次注册时由服务端签发 | Agent 调 `/agent/*` 的鉴权，一次性下发、长期使用 | `%ProgramData%\Nacho\agent.json`，Agent 自行持久化 |
| ③ **Enrollment Key** | 服务端 `.env` 的 `ENROLLMENT_KEY` | 仅首次 `POST /agent/enroll` 注册时提交 | 管理员，安装 Agent 时输入 |

**排查顺序**：面板 401 → Panel API Key 不对；Agent 注册 401/403 → Enrollment Key 不对；Agent 已注册但掉线 → 设备 token 或 `serverUrl`。

---

## 4. 两条数据流

### 4.1 指令下发（服务端 → Agent）

```
面板 POST /api/panel/clients/:id/commands
  → 服务端写入 commands 表，状态 pending
  → 在线走 WS /agent/ws 推送，状态 sent；离线由 Agent 轮询 /agent/commands/pending 兜底
  → Agent 先写本地 journal，再 POST /agent/commands/:id/ack
  → 串行执行，状态 running
  → POST /agent/commands/:id/report，状态 success | failed | canceled
```

命令状态机：`pending → sent → running → success | failed | canceled`

关键约束：Agent **先持久化再 ACK**，因此断线重投和进程重启都能靠 journal 幂等恢复。服务端和 Agent 都不允许旁路投递。

### 4.2 软件安装（面板 → 目标服务器 → Agent）

```
面板"云端部署"：SSH/SFTP 把服务端源码 + Agent 制品推到远程 /tmp
  → 远端执行 deploy/install.sh
  → 安装 Node、编译、建系统用户、写 .env、装 systemd 单元 control-server.service

Agent 安装：浏览器执行 irm http://SERVER:8443/nacho.ps1 | iex
  → 该脚本由服务端按当前安装档案动态生成
  → 安装器从 /agent/downloads/windows/latest.json 读取版本与 SHA-256 再下载 exe
```

安装链接与服务端**共用同一地址和端口**，没有单独的下载服务。

---

## 5. 服务端部署模式

同一套源码支持三种互斥模式。**面板和 Agent 一次只连一个**；同机并存必须用不同端口。

| 模式 | 运行位置 | 安装目录 | 进程管理 |
|---|---|---|---|
| Windows 本机部署 | 当前 Windows 设备 | 仓库内（见 `nacho-panel/lib/local-control-server.ts`） | 面板本机 API + PowerShell + HKCU 登录自启 |
| WSL2 部署 | 本机 WSL2 Linux 发行版 | `/opt/control-server` | systemd `control-server.service` |
| Linux 服务器部署 | 远程 Linux 主机 | `/opt/control-server` | systemd `control-server.service` |

- Windows 本机模式**不依赖 WSL**，选择它时不会启动 WSL。
- 三种模式不得共享同一个 SQLite 文件或 `.env`。
- 服务端**只读**部署副本：`/opt/control-server` 是运行态，仓库是源码，改代码后要显式同步再重启。

---

## 6. 改动归属

这是本文最该记住的一张表。

| 你要改的东西 | 改哪个仓 | 具体路径 | 是否牵动另一侧 |
|---|---|---|---|
| 面板页面、交互、主题、动画 | `nacho-main` | `nacho-panel/app/`、`components/`、`lib/` | 否（只读 `/api/panel/*`） |
| 面板调用的服务端 API | **两个仓** | 服务端 `src/routes/` + `src/services/`；面板 `components/*-context.tsx` | 是，先服务端后面板 |
| **新增/修改命令类型** | **新仓单侧，但要改两处** | Agent `client/src/Nacho.Agent/CommandProcessor.cs` + 服务端 `src/schemas/commands.ts` | 是，**两端必须同时改** |
| 命令 payload 字段 | **新仓三处** | Agent `Models.cs`、服务端 Zod schema、面板 `lib/` 解析器 | 是，三处同步 |
| Agent 本机策略、允许列表 | 新仓 | `client/src/Nacho.Agent/*Manager.cs`、`AgentOptions.cs` | 否（Agent 本机判定） |
| 部署脚本、systemd、`napl` | 新仓 | `deploy/` | 面板打包清单 `nacho-panel/lib/cloud-deployment.ts` 要同步 |
| 数据库表结构 | 新仓 | `src/db/index.ts` | 用可重复执行的增量建表，兼容已有库 |
| Windows 本机服务管理 | 新仓 | `deploy/windows/*.ps1` | 面板 `lib/local-control-server.ts` 调用它 |

### 命令契约的三处同步

改一个命令的字段时，下面三处**必须同时改**，否则会出现"服务端接受但 Agent 忽略"或"面板解析失败"：

1. **Agent**：`nacho-server/client/src/Nacho.Agent/Models.cs`（模型）+ `CommandProcessor.cs` 及对应 Manager（处理器）
2. **服务端**：`nacho-server/src/schemas/commands.ts`（Zod 校验）
3. **面板**：`nacho-panel/lib/` 下按命令类型拆分的解析器，例如 `collect-logs.ts`、`run-shell.ts`、`file-deployment.ts`、`package-deployment.ts`、`registry-management.ts`、`local-user-management.ts`、`message-push.ts`、`open-url.ts`

服务端会对 Agent 上报的结果再做一次结构校验，两侧上限统一为 **512 KiB UTF-8**（`src/schemas/commands.ts`），这个限制不能被旁路。

---

## 7. 跨仓协作约定

两个仓库独立发版，因此：

- **协议先行**：改 API 或命令契约，先在 `nachomao/nacho-server` 发版，再更新 `nachomao/nacho-main` 的面板。
- **兼容性**：服务端应容忍旧 Agent（未知命令类型返回明确错误，而不是静默丢弃）。
- **更新来源**：面板、服务端和 Agent 的源码仍在 GitHub 两仓；签名索引与制品由私有 `nacho-update-server` 独立分发。旧公钥已计划轮换，旧安装实例须先人工安装迁移版。
- 各自仓库的 `AGENTS.md` 是该仓的开发约束，跨仓任务两边都要看。

---

## 8. 本地同时跑三个

```powershell
# 1. 服务端（nacho-server 仓库根目录）
npm ci
npm run dev            # http://localhost:8443

# 2. 面板（nacho-main/nacho-panel）
pnpm install
pnpm dev               # http://localhost:3000

# 3. Agent（需要先发布制品，服务端才有东西可下载）
powershell -ExecutionPolicy Bypass -File client/deploy/publish.ps1
```

然后在面板"设置 → 服务端连接"填入服务端 `.env` 里的 `PANEL_API_KEY`，地址填 `http://127.0.0.1:8443`。

---

## 9. 当前已知的演示边界

以下功能**尚未形成真实链路**，界面可用但不是生产实现：

- 面板 AI 工作区是本地演示脚本，未调用真实模型或工具
- 面板 WebSSH 是模拟终端和模拟文件系统
- 面板脚本页主要在浏览器本地生成，安装对话框才下载服务端真实生成的 `/nacho.ps1`
- 插件的包下载、导入和批量安装没有真实传输与 Agent 执行闭环

判断功能真假时以代码行为为准，不以注释为准。
