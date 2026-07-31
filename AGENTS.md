# 项目级开发提示词（AGENTS.md）

## 1. 核心原则

- 本项目处于持续开发阶段。每次任务均以当前工作区源码、配置、测试和实际运行状态为准。
- 信息优先级：当前源码与配置 > 自动化测试 > 实际运行结果 > README > 历史续作记录 > 口头推测。
- 开始修改前先读取相关文件并执行 `git status --short`；已有实现、协议、测试和运行态需要延续，避免重复实现已经闭环的功能。
- `server/client/NEXT_TASK_PROMPT.md` 是 2026-07-24 Windows Agent 升级任务的历史验收记录，仅在追溯升级协议时参考。它不是项目全局现状，也不覆盖本文件。
- 输出与代码注释优先使用中文；类型名、协议字段、命令、日志关键字保持源码中的英文形式。
- 只陈述亲自读取或执行确认的事实。运行结果、服务状态、测试数量、制品版本和哈希均在当前任务中重新获取。
- 以最小完整改动完成任务：既覆盖必要的三层链路，也保持无关页面、动画、主题、协议和运行配置不变。

## 2. 三层架构与本机拓扑

### 2.1 面板（Windows）

- 工作目录：仓库根目录。
- 技术栈：Next.js 16 App Router、React 19、TypeScript 5.7、Tailwind CSS 4。
- 主要目录：
  - `app/`：页面和面板本地 API Route。
  - `components/`：业务视图、上下文、交互和 UI 组件。
  - `lib/`：本地设置、命令结果解析、服务端地址和通用工具。
  - `tests/`：面板侧纯逻辑与本地设置测试。
- 本机开发地址：`http://localhost:3000`，客户端管理页为 `/clients`。
- `components/server-data-context.tsx` 统一访问控制服务端的 `/api/panel/*`，使用 `Authorization: Bearer <PANEL_API_KEY>`。
- `app/api/local-settings/route.ts` 与 `app/api/settings/test-email/route.ts` 属于面板本机 API；它们与 WSL 控制服务端不是同一进程。
- 本地面板设置默认写入 `%LOCALAPPDATA%/NachoPanel/panel-settings.json`，测试可用 `NACHO_PANEL_SETTINGS_PATH` 指向临时文件。

### 2.2 控制服务端（WSL2 Debian）

- 源码目录：`server/`。
- 技术栈：Node.js 22+、Express 4、WebSocket、Zod、TypeScript、内置 `node:sqlite`。
- 主要目录：
  - `server/src/routes/`：面板、Agent 与公开制品路由。
  - `server/src/services/`：客户端、命令、升级、任务、插件、日志和健康数据业务逻辑。
  - `server/src/db/`：SQLite 初始化与增量建表逻辑。
  - `server/src/tests/`：服务端自动化测试。
  - `server/deploy/`：Linux 服务端及 Windows Agent 安装／卸载脚本。
  - `server/artifacts/windows/`：发布脚本生成的 Windows Agent 制品与 `latest.json`。
- 测试发行版／用户：WSL2 `Debian` / `debian`。普通构建与测试使用该用户。
- 已部署副本：`/opt/control-server`；systemd 单元：`control-server.service`；默认端口：`8443`；健康检查：`http://localhost:8443/health`。
- `/opt/control-server` 是运行副本，仓库 `server/` 才是源码来源。先修改和验证源码，再按任务要求同步部署；保持部署侧 `.env`、SQLite 数据库和 systemd 配置原样。
- 需要提权的部署操作使用当前会话提供的 `WSL_SUDO_PASSWORD`，或由调用方显式选择 WSL root；凭据只经标准输入传递，仓库、脚本、日志和最终摘要均保持无凭据内容。

### 2.3 Windows Agent 客户端（当前 Windows 设备）

- 源码目录：`server/client/`。
- 技术栈：.NET 10、Windows Service、自包含 `win-x64` 单文件发布。
- 项目：`server/client/src/Nacho.Agent/Nacho.Agent.csproj`。
- 测试：`server/client/tests/Nacho.Agent.Tests/Nacho.Agent.Tests.csproj`。
- Windows 服务：`NachoAgent`，以 `LocalSystem` 自动启动。
- 安装程序：`%ProgramFiles%/Nacho/Agent/nacho-agent.exe`。
- 配置与持久化状态：`%ProgramData%/Nacho/agent.json`、`state.dat`、`queue/` 及更新／重启 intent 文件。
- 受 ACL 保护的 `%ProgramData%/Nacho` 内容仅在确有验收需要时由提升后的终端读取；配置、设备 token 和 DPAPI 状态不进入输出。
- 当前支持的命令处理器包括：`run-program`、`manage-service`、`terminate-process`、`restart-system`、`collect-logs`、`update-agent`。

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
- 根首页组件名和 `app/layout.tsx` metadata 仍带有早期 v0/加密仪表盘遗留命名；业务卡片已部分接入真实 overview。相关任务应以渲染数据链路为准，并逐步清理命名，而非据文件名判断功能。

### 4.2 服务端改动

- 路由层负责认证、Zod 校验和 HTTP envelope；业务规则放在 `server/src/services/`；SQLite 映射集中在 db/service 层。
- 数据库变更采用可重复执行的增量初始化，兼容现有 `/opt/control-server` 数据库。
- 修改命令契约时同时检查 HTTP、WebSocket、SQLite、日志裁剪、离线队列和重复投递。
- 新增写操作时记录必要的业务审计摘要，同时避免把命令完整结果、凭据或采集正文复制进服务日志。
- 保持 `server/.env.example` 只包含示例值。运行中的 `.env` 仅用于部署，不读取到聊天输出。

### 4.3 Agent 改动

- 命令执行继续串行化，并沿用 `CommandJournal` 的先持久化、ACK、执行、报告和重试流程。
- `run-program`、服务控制、进程终止、系统重启和日志采集继续执行本机策略与允许列表；升级保留既有 `agent.json`、DPAPI 身份和 journal。
- Windows 操作优先使用现有 .NET／Win32 API，不引入额外 shell 链路。
- 真实服务、进程、重启、日志和升级验收均使用专门夹具或当前任务指定对象，记录并恢复测试前状态。
- 发布只通过 `server/client/deploy/publish.ps1` 生成制品和清单；发布后再验证清单、文件大小和 SHA-256。

### 4.4 新命令或新业务的完成定义

一次完整实现通常包含：

1. 面板交互、请求、状态展示与结构化结果解析。
2. 服务端类型、Zod schema、路由、service、持久化和日志。
3. Agent 模型、处理器、平台实现、本机策略、journal 恢复和结果契约。
4. 三层单元测试／集成测试、README 或协议说明。
5. Windows + WSL + 浏览器的最小真实链路验证。

若某层与任务无关，在最终摘要中说明经过核对后无需变更的原因。

## 5. 当前已知的真实功能与演示边界

- 已接通真实链路：客户端注册与心跳、客户端列表、Panel API、WebSocket/HTTP 命令投递、Agent journal、程序执行、服务控制、进程终止、系统重启、受限日志采集、Agent 手动升级与回滚。
- 服务端已提供任务、插件、健康、日志和设置 CRUD/API，但面板是否真正调用这些接口需要按具体组件核对。
- `components/tasks/tasks-view.tsx` 当前只在 React 本地状态中创建、编辑、启停和删除任务，尚未接入服务端 `/tasks`。
- `components/plugins/plugins-context.tsx` 当前只维护 React 本地状态，导入、下载、批量安装等交互尚未形成服务端 + Agent 完整闭环。
- `components/health/health-view.tsx` 的发现项、日志包、主动采集和重新分析目前是空初值加本地定时模拟，尚未接入已有 health API。
- `components/ai-mode/ai-workspace.tsx` 是本地演示脚本，未调用真实模型、MCP、插件或 Agent 工具。
- `components/topbar/webssh-dialog.tsx` 与 `webssh-files-panel.tsx` 是本地模拟终端和模拟文件系统。
- `components/scripts/scripts-view.tsx` 主要在浏览器本地生成／编辑脚本；`components/scripts/install-dialog.tsx` 才会下载服务端动态生成的真实 `/install.ps1`。
- `server/src/scripts/seed.ts` 只用于种子／演示数据，测试结果和生产状态不引用它作为真机证据。
- 发现“注释宣称真实、实现仍为本地 state 或定时模拟”的情况时，以代码行为为准，并在相关任务中修正注释。

## 6. 文件与依赖管理

- 根项目使用 `pnpm-lock.yaml` 与 pnpm；`server/` 使用 `package-lock.json` 与 npm；Agent 使用 dotnet/NuGet。各层保持各自包管理器。
- 业务源码修改范围通常为 `app/`、`components/`、`lib/`、`server/src/`、`server/client/src/` 和对应测试。
- 生成目录和运行数据保持只读：`.next/`、各级 `node_modules/`、`server/dist/`、`server/data/`、`server/tmp-*`、`**/bin/`、`**/obj/`。
- `server/artifacts/windows/*.exe` 是发布制品；源码任务不直接编辑二进制文件。
- 当前仓库基线可能尚未建立 tracked files。每次检查 `git ls-files`；当结果为空时，`git diff` 的覆盖范围并不完整，需要同时核对文件清单和内容。清理、重置、暂存、提交与推送均以用户明确要求为触发条件。
- 保留用户已有的未提交文件和运行数据；修改聚焦当前任务涉及的文件。

## 7. 分层验证命令

### 7.1 面板：在当前 Windows 工作区运行

```powershell
pnpm exec tsx --test tests/*.test.ts
pnpm exec tsc --noEmit
pnpm build
```

- 小范围修改先运行对应测试，再运行全量测试与 TypeScript 检查。
- UI 变更还需在真实浏览器访问 `http://localhost:3000`，核对目标页面、控制台、网络请求、桌面和 `390x844` 视口。
- 已有 dev 服务运行时，构建可能改写 `.next/`；先确认运行进程，必要时在独立副本构建并保持原 dev 服务状态。

### 7.2 服务端：在 WSL2 Debian 中运行

```bash
npm test
npm run build
curl -fsS http://localhost:8443/health
systemctl is-active control-server.service
```

- `server/node_modules` 可能由 Windows npm 安装，其中 `esbuild` 原生包与 Linux 不兼容。WSL 测试使用 WSL 文件系统中的隔离目录：复制 `server/package*.json`、`server/tsconfig.json`、`server/src/`，执行 `npm ci --no-audit --no-fund`、测试和构建，完成后校验临时路径位于 `/tmp/` 再清理。
- 服务端测试不直接覆盖 `/opt/control-server`。部署验收按“源码通过 -> 备份运行态 -> 同步部署副本 -> 重启服务 -> 健康/API 验证 -> 失败则回滚”的顺序执行。

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

1. 服务端 `/health` 返回成功，`control-server.service` 状态符合预期。
2. Windows `NachoAgent` 服务状态符合预期，心跳能更新客户端版本与在线状态。
3. 直接调用 Panel API 验证请求／响应和 SQLite 命令状态。
4. 验证 WebSocket 推送；断开实时通道后验证 HTTP 回退。
5. 在面板执行同一操作，确认加载态、终态、错误态和刷新后的数据一致。
6. 涉及离线队列、服务重启、系统重启、日志采集或升级时，额外验证幂等、恢复与回滚。

## 8. 每次任务的执行与交付格式

1. **Current**：用一行写明当前对象、最近确认结果和下一动作。
2. **Inspect**：读取相关源码、测试、配置和运行态；列出真实调用链与现有边界。
3. **Implement**：直接修改必要文件，保持协议一致；工具失败后说明失败步骤并立即改用修正命令。
4. **Verify**：先做目标测试，再做受影响层的全量检查；需要联调时按 Windows／WSL／浏览器拓扑执行。
5. **Restore**：真机测试结束后恢复服务状态、配置、制品和临时夹具，清理已验证的临时目录。
6. **Report**：最终摘要包含改动文件、行为变化、执行过的命令及结果、真实运行证据、剩余演示边界或下一步。

## 9. 2026-07-31 基线（仅作比较，使用前重新核验）

- 面板 `http://localhost:3000` 与 `/clients` 返回 HTTP 200。
- 服务端 `control-server.service` 为 active/enabled，`http://localhost:8443/health` 返回 HTTP 200。
- Windows `NachoAgent` 为 Running/Auto/LocalSystem，安装程序版本为 `1.1.1.0`。
- Windows 工具链：Node `v24.13.0`、pnpm `10.28.2`、.NET SDK `10.0.101`。
- WSL 工具链：Node `v22.23.1`、npm `10.9.8`。
- 面板逻辑测试：19 项通过；`pnpm exec tsc --noEmit` 通过。
- 服务端在 WSL 原生依赖隔离目录中：8 项测试通过，TypeScript build 通过。
- Agent：107 项测试通过，Release build 为 0 warning / 0 error。
