# 项目级开发提示词（AGENTS.md）

## 1. 核心原则

- 本项目处于持续开发阶段。每次任务均以当前工作区源码、配置、测试和实际运行状态为准。
- 信息优先级：当前源码与配置 > 自动化测试 > 实际运行结果 > README > 历史续作记录 > 口头推测。
- 开始修改前先读取相关文件并执行 `git status --short`；已有实现、协议、测试和运行态需要延续，避免重复实现已经闭环的功能。
- `PROJECT_REMAINING_WORK.md` 是唯一当前待办来源；README 只说明使用方式，历史计划、阶段验收记录和临时证据均不代表项目现状。完成或发现待办时直接更新该文件，不再新增平行的续作清单。
- 输出与代码注释优先使用中文；类型名、协议字段、命令、日志关键字保持源码中的英文形式。
- 只陈述亲自读取或执行确认的事实。运行结果、服务状态、测试数量、制品版本和哈希均在当前任务中重新获取。
- 以最小完整改动完成任务：既覆盖必要的三层链路，也保持无关页面、动画、主题、协议和运行配置不变。

## 2. 三层架构与部署拓扑

### 2.1 面板（Windows）

- 工作目录：`nacho-panel/`。
- 技术栈：Next.js 16 App Router、React 19、TypeScript 5.7、Tailwind CSS 4。
- 主要目录：
  - `nacho-panel/app/`：页面和面板本地 API Route。
  - `nacho-panel/components/`：业务视图、上下文、交互和 UI 组件。
  - `nacho-panel/lib/`：本地设置、命令结果解析、服务端地址和通用工具。
  - `nacho-panel/tests/`：面板侧纯逻辑与本地设置测试。
- 本机开发地址：`http://localhost:3000`，客户端管理页为 `/clients`。
- `nacho-panel/components/server-data-context.tsx` 统一访问控制服务端的 `/api/panel/*`，使用 `Authorization: Bearer <PANEL_API_KEY>`。
- `nacho-panel/app/api/local-settings/route.ts` 与 `nacho-panel/app/api/settings/test-email/route.ts` 属于面板本机 API；它们与任一部署模式下的控制服务端都不是同一进程。
- 本地面板设置默认写入 `%LOCALAPPDATA%/NachoPanel/panel-settings.json`，测试可用 `NACHO_PANEL_SETTINGS_PATH` 指向临时文件。

### 2.2 控制服务端（三种部署模式）

- 源码目录：`server/`。
- 技术栈：Node.js 22+、Express 4、WebSocket、Zod、TypeScript、内置 `node:sqlite`。
- 主要目录：
  - `server/src/routes/`：面板、Agent 与公开制品路由。
  - `server/src/services/`：客户端、命令、升级、任务、插件、日志和健康数据业务逻辑。
  - `server/src/db/`：SQLite 初始化与增量建表逻辑。
  - `server/src/tests/`：服务端自动化测试。
  - `server/deploy/`：Linux 服务端及 Windows Agent 安装／卸载脚本。
  - `server/artifacts/windows/`：发布脚本生成的 Windows Agent 制品与 `latest.json`。
- 服务端支持三种互斥选择的运行模式：**Windows 本机部署**、**WSL2 部署**、**独立 Linux 服务器部署**。三种模式使用同一套 `server/` 源码和 API 协议，但进程管理、数据目录、监听地址与验收命令不同。
- 面板和 Agent 在一次运行中只连接一个选定的控制服务端。不得因普通 Windows 本机任务自动启动 WSL，也不得把某一模式的运行状态当作另一模式的状态。
- 多种模式在同一设备并存时必须使用不同端口；修改端口后同步更新面板连接地址、Agent `serverUrl`、防火墙与自启配置。

#### 2.2.1 Windows 本机部署

- 由 Windows 上的面板首次引导或“设置 → 连接”管理，运行仓库中的 `server/dist/index.js`。
- 管理脚本：`server/deploy/windows/local-control-server.ps1`；配置：`server/.env`；状态与日志：`server/.nacho-local/`；默认地址：`http://127.0.0.1:8443`，端口冲突时从面板修改。
- 进程使用当前 Windows 用户的 HKCU 登录自启，不依赖 WSL、systemd 或 `/opt/control-server`。
- 安装、启动、停止、修复、端口迁移和卸载均走面板本机 API；只在配置局域网防火墙规则时请求 UAC。

#### 2.2.2 WSL2 部署

- 当前测试发行版／用户为 WSL2 `Debian` / `debian`；运行副本为 `/opt/control-server`，systemd 单元为 `control-server.service`，默认端口为 `8443`。
- WSL 模式适合本机 Linux 兼容验证或明确选择的 WSL 常驻服务。只有任务明确指向 WSL、`/opt/control-server` 或 `control-server.service` 时才启动发行版。
- `/opt/control-server` 是运行副本，仓库 `server/` 才是源码来源。先验证源码，再备份运行态并同步部署；保持部署侧 `.env`、SQLite 数据库和 systemd 配置原样。
- 需要提权时使用当前会话提供的 `WSL_SUDO_PASSWORD`，或由调用方显式选择 WSL root；凭据只经标准输入传递，不进入仓库、日志或摘要。

#### 2.2.3 独立 Linux 服务器部署

- 支持 Ubuntu、Debian、CentOS、RHEL、Rocky Linux、AlmaLinux 与 Fedora；使用 `server/deploy/install.sh` 安装 Node.js、系统用户和 `control-server.service`。
- 默认安装目录为 `/opt/control-server`，数据库与持久化目录按部署脚本配置；面板和 Agent 使用服务器可达的 HTTP(S) 地址，不得使用浏览器所在机器的 `localhost`。
- 远程部署遵循“源码验证 → 备份配置/数据库 → 同步或执行安装脚本 → 重启 systemd → 健康/API 验证 → 失败回滚”，并保持远程 `.env` 与凭据不出现在聊天输出。

### 2.3 Windows Agent 客户端（当前 Windows 设备）

- 源码目录：`server/client/`。
- 技术栈：.NET 10、Windows Service、自包含 `win-x64` 单文件发布。
- 项目：`server/client/src/Nacho.Agent/Nacho.Agent.csproj`。
- 测试：`server/client/tests/Nacho.Agent.Tests/Nacho.Agent.Tests.csproj`。
- Windows 服务：`NachoAgent`，以 `LocalSystem` 自动启动。
- 安装程序：`%ProgramFiles%/Nacho/Agent/nacho-agent.exe`。
- 配置与持久化状态：`%ProgramData%/Nacho/agent.json`、`state.dat`、`queue/` 及更新／重启 intent 文件。
- 受 ACL 保护的 `%ProgramData%/Nacho` 内容仅在确有验收需要时由提升后的终端读取；配置、设备 token 和 DPAPI 状态不进入输出。
- 当前支持的命令处理器包括：`run-program`、`run-shell`、`install-package`、`deploy-file`、`rollback-file-deploy`、`manage-service`、`list-processes`、`terminate-process`、`restart-process`、`set-process-efficiency`、`restart-system`、`collect-logs`、`manage-local-user`、`manage-registry`、`show-message`、`open-url`、`update-agent`。

## 3. 真实数据流与协议边界

1. 面板通过 HTTP 调用服务端 `/api/panel/*`，服务端校验 Panel API Key。
2. Agent 首次调用 `/agent/enroll` 注册并取得独立设备 token，之后以该 token 心跳、拉取、ACK 和上报结果。
3. 服务端把业务数据与命令状态持久化到 SQLite；在线 Agent 优先由 `/agent/ws` 接收命令，断线时由 HTTP 轮询回退。
4. 命令状态主链路为 `pending -> sent -> running -> success|failed|canceled`。Agent 先把命令写入本地 journal，再 ACK，最终结果支持断线重试与幂等恢复。
5. 面板只通过服务端读取设备与命令状态；面板不直接操作 Agent 文件、服务或 SQLite。
6. API 成功响应遵循 `{ "ok": true, "data": ... }`；失败响应由服务端统一错误处理返回。新增接口继续沿用此 envelope。
7. Panel API Key、首次入网用 Enrollment Key、Agent 设备 token 是三种独立凭据，字段与使用位置保持分离。
8. `update-agent` 只能由 `/api/panel/agent-updates` 根据服务端真实发布清单生成。通用 `/clients/:id/commands` 保持对该类型的专用入口约束。
9. `result` 当前是命令表中的字符串字段；结构化结果以 JSON 字符串保存。修改字段时同步更新 Agent、服务端、面板解析器与测试。
10. HTTP 与 WebSocket 的结果上报保持一致的大小、状态和所有权校验；`collect-logs` 的 512 KiB UTF-8 上限不得被旁路。

## 4. 跨层功能实现规则

### 4.1 面板改动

- 优先复用 `ServerDataProvider.apiRequest()`、现有业务 Context、对话框和响应式组件样式。
- 后端已有真实接口时，面板状态来自接口，不再新增硬编码业务数据或用 `setTimeout` 伪造成功。
- 请求包含加载、空数据、错误、重试、重复点击和终态刷新处理。
- 保留桌面和移动端布局；至少核对窄屏 `390x844` 无页面级横向溢出。
- `next.config.mjs` 当前设置 `typescript.ignoreBuildErrors: true`，因此 `pnpm build` 与独立的 `pnpm exec tsc --noEmit` 两项均需执行。
- 根首页组件名和 `nacho-panel/app/layout.tsx` metadata 仍带有早期 v0/加密仪表盘遗留命名；业务卡片已部分接入真实 overview。相关任务应以渲染数据链路为准，并逐步清理命名，而非据文件名判断功能。

### 4.2 服务端改动

- 路由层负责认证、Zod 校验和 HTTP envelope；业务规则放在 `server/src/services/`；SQLite 映射集中在 db/service 层。
- 数据库变更采用可重复执行的增量初始化，兼容现有 `/opt/control-server` 数据库。
- 修改命令契约时同时检查 HTTP、WebSocket、SQLite、日志裁剪、离线队列和重复投递。
- 新增写操作时记录必要的业务审计摘要，同时避免把命令完整结果、凭据或采集正文复制进服务日志。
- 保持 `server/.env.example` 只包含示例值。运行中的 `.env` 仅用于部署，不读取到聊天输出。

### 4.3 Agent 改动

- 命令执行继续串行化，并沿用 `CommandJournal` 的先持久化、ACK、执行、报告和重试流程。
- 程序／Shell／包安装、文件部署与回滚、服务／进程／用户／注册表管理、消息／URL、系统重启和日志采集继续执行各自的本机策略、权限与允许列表；升级保留既有 `agent.json`、DPAPI 身份和 journal。
- Windows 操作优先使用现有 .NET／Win32 API，不引入额外 shell 链路。
- 真实服务、进程、重启、日志和升级验收均使用专门夹具或当前任务指定对象，记录并恢复测试前状态。
- 发布只通过 `server/client/deploy/publish.ps1` 生成制品和清单；发布后再验证清单、文件大小和 SHA-256。

### 4.4 新命令或新业务的完成定义

一次完整实现通常包含：

1. 面板交互、请求、状态展示与结构化结果解析。
2. 服务端类型、Zod schema、路由、service、持久化和日志。
3. Agent 模型、处理器、平台实现、本机策略、journal 恢复和结果契约。
4. 三层单元测试／集成测试、README 或协议说明。
5. Windows Agent + 当前选定的服务端部署模式 + 浏览器的最小真实链路验证；无需同时启动三种服务端模式。

若某层与任务无关，在最终摘要中说明经过核对后无需变更的原因。

## 5. 当前已知的真实功能与演示边界

- 已接通真实链路：客户端注册与心跳、客户端列表、Panel API、WebSocket/HTTP 命令投递、Agent journal，以及 `CommandProcessor` 当前列出的 Windows 命令处理器。
- `nacho-panel/components/tasks/tasks-view.tsx` 已通过服务端 `/tasks` 相关 API 完成真实读取、CRUD、启停和任务下发。
- `nacho-panel/components/health/health-view.tsx` 已通过 health API 完成发现项与日志包读取、主动采集、下载、重分析和重采集。
- `nacho-panel/components/plugins/plugins-context.tsx` 的目录读取、CRUD 与启停状态已由服务端持久化；包下载、导入和批量安装仍未形成真实包传输与 Agent 执行闭环。
- `nacho-panel/components/ai-mode/ai-workspace.tsx` 仍是本地演示脚本，未调用真实模型、MCP、插件或 Agent 工具。
- `nacho-panel/components/topbar/webssh-dialog.tsx` 与 `nacho-panel/components/topbar/webssh-files-panel.tsx` 仍是本地模拟终端和模拟文件系统。
- `nacho-panel/components/scripts/scripts-view.tsx` 主要在浏览器本地生成／编辑脚本；`nacho-panel/components/scripts/install-dialog.tsx` 才会下载服务端动态生成的真实 `/nacho.ps1`。
- `server/src/scripts/seed.ts` 只用于种子／演示数据，测试结果和生产状态不引用它作为真机证据。
- 发现“注释宣称真实、实现仍为本地 state 或定时模拟”的情况时，以代码行为为准，并在相关任务中修正注释。

## 6. 文件与依赖管理

- 根 `package.json` 与根 `pnpm-lock.yaml` 是 Vercel 部署及命令代理入口，不得作为多余文件删除；面板使用 `nacho-panel/pnpm-lock.yaml` 与 pnpm，`server/` 使用 `package-lock.json` 与 npm，Agent 使用 dotnet/NuGet。各层保持各自包管理器。
- 业务源码修改范围通常为 `nacho-panel/app/`、`nacho-panel/components/`、`nacho-panel/lib/`、`server/src/`、`server/client/src/` 和对应测试。
- 生成目录和运行数据保持只读：`nacho-panel/.next/`、各级 `node_modules/`、`server/dist/`、`server/data/`、`server/tmp-*`、`**/bin/`、`**/obj/`。
- `server/artifacts/windows/*.exe` 是发布制品；源码任务不直接编辑二进制文件。
- `.codex-*`、`.v0-backups/`、`*.bak` 和无引用的调试截图属于临时文件，不提交到仓库；正式 UI 图片和 `public/` 运行资源不按扩展名批量清理。
- 当前仓库基线可能尚未建立 tracked files。每次检查 `git ls-files`；当结果为空时，`git diff` 的覆盖范围并不完整，需要同时核对文件清单和内容。清理、重置、暂存、提交与推送均以用户明确要求为触发条件。
- 保留用户已有的未提交文件和运行数据；修改聚焦当前任务涉及的文件。

## 7. 分层验证命令

### 7.1 面板：在当前 Windows 工作区的 `nacho-panel/` 中运行

```powershell
Push-Location nacho-panel
pnpm exec tsx --test tests/*.test.ts
pnpm exec tsc --noEmit
pnpm build
Pop-Location
```

- 小范围修改先运行对应测试，再运行全量测试与 TypeScript 检查。
- UI 变更还需在真实浏览器访问 `http://localhost:3000`，核对目标页面、控制台、网络请求、桌面和 `390x844` 视口。
- 已有 dev 服务运行时，构建可能改写 `nacho-panel/.next/`；先确认运行进程，必要时在独立副本构建并保持原 dev 服务状态。

### 7.2 服务端：按部署模式验证

源码级测试在 `server/` 中执行：

```bash
npm test
npm run build
```

Windows 本机部署：

```powershell
Invoke-RestMethod http://127.0.0.1:PORT/health
Invoke-RestMethod http://localhost:3000/api/local-control-server -Headers @{ Origin = "http://localhost:3000" }
```

WSL2 Debian 部署：

```bash
curl -fsS http://localhost:8443/health
systemctl is-active control-server.service
```

- `server/node_modules` 可能由 Windows npm 安装，其中 `esbuild` 原生包与 Linux 不兼容。WSL 测试使用 WSL 文件系统中的隔离目录：复制 `server/package*.json`、`server/tsconfig.json`、`server/src/`，执行 `npm ci --no-audit --no-fund`、测试和构建，完成后校验临时路径位于 `/tmp/` 再清理。
- 服务端测试不直接覆盖 `/opt/control-server`。部署验收按“源码通过 -> 备份运行态 -> 同步部署副本 -> 重启服务 -> 健康/API 验证 -> 失败则回滚”的顺序执行。

独立 Linux 服务器部署在目标主机执行：

```bash
systemctl is-active control-server.service
curl -fsS http://127.0.0.1:PORT/health
```

- 远程健康检查还需从面板或 Agent 所在网络访问其公开地址，验证监听、防火墙、反向代理与 TLS；不要用本机 `localhost` 代替远程服务器地址。
- 验证前先确认当前任务选择的部署模式；其他模式保持原状态，不为凑齐拓扑而启动。

### 7.3 Agent：在当前 Windows 设备运行

```powershell
dotnet test server/client/tests/Nacho.Agent.Tests/Nacho.Agent.Tests.csproj
dotnet build server/client/src/Nacho.Agent/Nacho.Agent.csproj -c Release
```

- 涉及发布时追加：

```powershell
powershell -ExecutionPolicy Bypass -File server/client/deploy/publish.ps1
```

- 涉及已安装服务时，先查询 `Get-CimInstance Win32_Service -Filter "Name='NachoAgent'"`，再执行最小真实验收；结束时恢复服务、配置和夹具状态。

### 7.4 三层联调顺序

1. 当前选定模式的服务端 `/health` 返回成功；Windows 本机模式核对受管 PID，WSL/Linux 模式核对 `control-server.service`。
2. Windows `NachoAgent` 服务状态符合预期，心跳能更新客户端版本与在线状态。
3. 直接调用 Panel API 验证请求／响应和 SQLite 命令状态。
4. 验证 WebSocket 推送；断开实时通道后验证 HTTP 回退。
5. 在面板执行同一操作，确认加载态、终态、错误态和刷新后的数据一致。
6. 涉及离线队列、服务重启、系统重启、日志采集或升级时，额外验证幂等、恢复与回滚。

## 8. 每次任务的执行与交付格式

1. **Current**：用一行写明当前对象、最近确认结果和下一动作。
2. **Inspect**：读取相关源码、测试、配置和运行态；列出真实调用链与现有边界。
3. **Implement**：直接修改必要文件，保持协议一致；工具失败后说明失败步骤并立即改用修正命令。
4. **Verify**：先做目标测试，再做受影响层的全量检查；需要联调时按 Windows Agent／选定服务端模式／浏览器拓扑执行。
5. **Restore**：真机测试结束后恢复服务状态、配置、制品和临时夹具，清理已验证的临时目录。
6. **Report**：最终摘要包含改动文件、行为变化、执行过的命令及结果、真实运行证据、剩余演示边界或下一步。

## 9. 动态基线规则

- 不在本文件固化测试数量、工具链版本、服务状态、制品版本或哈希；这些信息会随持续开发和部署变化。
- 每次任务按受影响层重新执行第 7 节验证，并在最终报告中记录当次命令、结果与未执行原因。
- 历史聊天、验收截图和证据目录只能用于追溯，不能替代当前源码、自动化测试和真实运行结果。
