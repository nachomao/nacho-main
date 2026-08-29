# Windows 七项管理功能补全实施计划

> 范围：仅补齐 Windows 的命令执行、批量安装、文件下发、用户管理、注册表、消息推送和打开网页。现有服务控制、进程终止、系统重启、日志采集保持原实现并参加回归；Linux 不在本计划内。

## 当前进度

- [x] 第 1 阶段：命令执行
- [x] 第 2 阶段：批量安装
- [x] 第 3 阶段：文件下发
- [x] 第 4 阶段：用户管理
- [x] 第 5 阶段：注册表
- [x] 第 6 阶段：消息推送
- [x] 第 7 阶段：打开网页
- [x] 最终三层联调与验收

## 执行规则

1. 每次先读取本计划、`AGENTS.md`、相关源码和测试，并执行 `git status --short`；保留已有修改、制品和运行数据。
2. 严格从第一个未勾选阶段开始。每阶段同时完成面板、服务端、Agent、测试、文档和阶段验收；当前阶段未闭环时不进入下一阶段。
3. 面板只使用真实服务端 API 和持久化命令状态，不以 React 本地状态、硬编码数组或 `setTimeout` 冒充成功。
4. 新命令沿用 `pending -> sent -> running -> success|failed|canceled`，并保持 Agent journal、ACK、串行执行、WebSocket/HTTP 回退、幂等恢复及结果重试。
5. payload/result 使用严格字段集合；未知字段、重复字段或错误类型产生结构化失败。完整结果不超过 512 KiB UTF-8。
6. 服务日志仅记录类型、状态、结果字节数、退出码和必要摘要，不复制脚本、stdout/stderr、文件正文、注册表值或用户信息。
7. 新 Agent 能力必须有本机策略；旧配置缺少字段时默认关闭或使用空允许列表。新安装生成默认字段，覆盖升级保留管理员配置。
8. 每阶段完成后勾选阶段，在末尾追加改动摘要、验证命令、退出状态、通过数量、真实链路证据、恢复情况及规定完成标记。

## 公共改造约束

- 面板主入口：`components/clients/extensions-panel.tsx`。
- 服务端主入口：`server/src/routes/panel.ts`；业务规则放入 service，认证和 Zod 校验留在路由层。
- Agent 主入口：`server/client/src/Nacho.Agent/CommandProcessor.cs`；Windows 操作优先使用 .NET/Win32 API。
- `TargetPicker` 为受控组件，接收 `selectedIds`、`onChange`、`multiple`、`onlineOnly`。
- 批量功能支持逐客户端聚合和刷新恢复；用户管理与注册表只允许单选 Windows 客户端。
- 新增并保持 `{ "ok": true, "data": ... }` envelope 的公共接口：
  - `POST /api/panel/commands/batch`
  - `GET|POST /api/panel/managed-artifacts`
  - `PUT /api/panel/managed-artifacts/:id/content`
  - `DELETE /api/panel/managed-artifacts/:id`
  - `POST /api/panel/package-deployments`
  - `POST /api/panel/file-deployments`
  - `GET /api/panel/deployment-batches/:id`
  - `POST /api/panel/clients/:clientId/file-deployments/:commandId/rollback`
  - `GET /agent/managed-artifacts/:artifactId?commandId=:commandId`
- 新增 `managed_artifacts`、`deployment_batches`、`deployment_items` SQLite 表，使用可重复执行的增量初始化。
- Agent 制品下载同时验证设备 token、客户端、commandId、命令状态、deployment item 与 ready artifact；普通软件包和文件不复用公开升级下载地址。

## 第 1 阶段：命令执行

- 命令：`run-shell`；payload 为 `shell: cmd|powershell`、`script`、`timeoutSeconds: 1..900`。
- 面板支持 shell 切换、脚本编辑、Windows 多选、确认、真实结果、每秒轮询和刷新恢复。
- 服务端提供严格判别联合和 `POST /api/panel/commands/batch`，目标去重并仅接受 Windows 客户端。
- Agent 使用临时 `.cmd`/`.ps1` 文件；CMD 调用系统 `cmd.exe`，PowerShell 调用内置 Windows PowerShell；超时终止进程树，UTF-8 输出有界并清理临时文件。
- 本机策略：`allowCmdExecution: false`、`allowPowerShellExecution: false`。
- Agent 重启不重放已经开始的 `run-shell`。

阶段完成标记：

```text
已完成第 1 阶段：命令执行。
下一个阶段开始完成第 2 阶段：批量安装。
```

## 第 2 阶段：批量安装

- 建立支持 MSI/EXE、最大 1 GiB、流式上传和 SHA-256 的服务端软件仓库。
- 上传流程为 draft 元数据、流式 PUT、服务端哈希、原子 ready；失败清理 draft 与临时文件。
- 按“包 × 在线 Windows 客户端”创建 `install-package` 命令矩阵并展示逐项状态。
- MSI 固定 `msiexec.exe /i <package> /qn /norestart`，成功码 0/3010；EXE 直接启动并使用 `ArgumentList`。
- Agent 策略 `allowPackageInstall: false`；校验大小/哈希，支持 60–7200 秒超时、进程树终止、intent 恢复和清理。

阶段完成标记：

```text
已完成第 2 阶段：批量安装。
下一个阶段开始完成第 3 阶段：文件下发。

```

## 第 3 阶段：文件下发

- 复用制品仓库，文件最大 512 MiB；新增 `deploy-file` 与 `rollback-file-deploy`。
- 支持 Windows 多选、绝对目标路径、创建目录和 `fail|replace` 冲突策略；默认 `fail`。
- Agent 策略 `allowedDeployRoots: []`、`fileDeployBackupRetentionDays: 7`。
- 禁止 UNC、设备路径、通配符、目录目标、ADS 和目录逃逸；写入前校验大小与 SHA-256。
- replace 先原子备份再原子替换；回滚校验备份及当前文件哈希，防止覆盖后续人工修改。

阶段完成标记：

```text
已完成第 3 阶段：文件下发。
下一个阶段开始完成第 4 阶段：用户管理。

```

## 第 4 阶段：用户管理

- 新命令 `manage-local-user`，action 为 list/enable/disable/delete/add-to-group/remove-from-group。
- 面板单选 Windows 客户端，删除需再次输入完整账户名；写操作完成后重新查询。
- Agent 使用 Windows NetAPI/Win32 API，不新增 PowerShell 链路。
- 策略：`allowLocalUserManagement: false`、`allowedLocalUsers: []`、`allowedLocalGroups: []`。
- 仅列举本地账户；写操作受允许列表约束并按 SID/RID 保护内置系统账户；启停和组操作幂等，删除不重放。

阶段完成标记：

```text
已完成第 4 阶段：用户管理。
下一个阶段开始完成第 5 阶段：注册表。
```

## 第 5 阶段：注册表

- 新命令 `manage-registry`，action 为 list/get/set/delete；仅支持 HKLM/HKU 与 Registry32/Registry64。
- 支持 string/expandString/dword/qword/multiString/binary，单值序列化上限 64 KiB。
- 面板单选 Windows 客户端，展示真实值；写操作返回前值和后值，并能生成逆向 set/delete。
- Agent 使用 `Microsoft.Win32.RegistryKey`；`allowedRegistryPaths: []` 按规范化前缀匹配，禁止 HKCU、空根和前缀外路径。

阶段完成标记：

```text
已完成第 5 阶段：注册表。
下一个阶段开始完成第 6 阶段：消息推送。
```

## 第 6 阶段：消息推送

- 新命令 `show-message`；标题 1–128、正文 1–2000 Unicode 标量，超时 5–300 秒。
- 服务端固定生成创建后五分钟的 `expiresAt`，日志不记录标题与正文。
- Agent 策略 `allowMessagePush: false`；抽取 `ActiveUserSessionResolver`，控制台优先、RDP 确定性回退。
- 使用 `WTSSendMessageW`；无人登录或命令过期返回结构化失败；投递后 Agent 重启不重复弹窗。

阶段完成标记：

```text
已完成第 6 阶段：消息推送。
下一个阶段开始完成第 7 阶段：打开网页。

```

## 第 7 阶段：打开网页

- 新命令 `open-url`；仅接受最长 2048 字符的绝对 HTTP/HTTPS URL，禁止 userinfo、控制字符及其他协议。
- 服务端生成五分钟 `expiresAt`，日志仅记录 scheme/host，不记录 query/fragment。
- 复用活动会话解析器；不设置本机总开关、scheme 允许列表或 host 允许列表，严格 HTTP/HTTPS payload 校验通过后直接进入活动会话启动流程。
- 使用 WTS 用户 token、`DuplicateTokenEx`、用户环境块与 `CreateProcessAsUserW`，在活动用户会话启动系统 `explorer.exe <URL>`，不在 Session 0 启动。

阶段完成标记：

```text
已完成第 7 阶段：打开网页。
七个功能阶段全部完成，开始最终三层联调与验收。
```

### 2026-08-10 — 删除打开网页本机策略门禁

- Agent：从 `AgentOptions` 删除 `AllowOpenUrl`、`AllowedUrlSchemes`、`AllowedUrlHosts`，从 `OpenUrlManager` 删除 `POLICY_DISABLED`/`POLICY_DENIED` 分支与 scheme/host 本机允许列表；严格绝对 HTTP/HTTPS、userinfo、控制字符、长度、过期、活动会话、intent 防重放和 Win32 结果校验保持不变。
- 配置：新安装脚本和 `agent.example.json` 不再生成三个 open-url 策略字段；1.1.15 首次启动会备份现有配置到 `agent.json.before-open-url-policy-removal.bak`、物理删除三个遗留字段并写入 `open-url-policy-v1.removed.json`，后续启动保持幂等。
- 文档：`server/README.md`、`server/client/README.md` 与本计划的当前行为说明已经同步。
- 目标测试：`OpenUrlManagerTests` 与 `AgentPolicyMigratorTests` 合计 10/10，明确覆盖 HTTP/HTTPS 无策略启动以及旧配置字段的一次性备份、删除和幂等标记。
- 全量验证：Agent 200/200，Release build 0 warning/0 error；面板 open-url 3/3；服务端 27/27，TypeScript build 通过；所有命令退出码均为 0。
- 发布：`nacho-agent-1.1.15-win-x64.exe` 为 76,357,219 字节，SHA-256 `1a0cba2d63717a180fed3cd590c5d26e55e688aad2b68b96713df5ad7e5ec4e8`，`latest.json` 与文件完全一致。
- 部署备份：`/opt/control-server-backups/open-url-policy-removal-20260810`；先通过可见面板升级并验证无策略启动，再升级到包含物理配置清理的 1.1.15，命令 `cmd-3b918d7076f0` 为 success/healthy，`NachoAgent` 为 Running/Auto/LocalSystem。
- 可视化真机链路：`/clients → 批量操作 → Windows → 打开网页` 提交 `http://127.0.0.1:18766/index.html`，命令 `cmd-17072151d0b1` 为 success，Session 1、`processStarted:true`、PID 3380、40 ms；临时 HTTP fixture 收到 `/index.html` 并返回 200，证明旧 `POLICY_DISABLED` 行为已经消失。
- 浏览器：可见面板显示命令 success、Session/PID/耗时结构化结果，控制台 warning/error 为 0。
- 恢复：临时 HTTP 端口 18766 已停止监听，唯一 fixture 目录已删除；面板端口 3000 保持监听，控制服务 active/HTTP 200，`tmp/repo-encoding-audit` 保留。

### 2026-08-07 — 最终三层联调与可视化验收

**测试前基线与工作区保护**

- 唯一夹具前缀为 `final-ui-20260807-155423`。测试前面板端口 3000 正在监听；`NachoAgent` 为 Running/Auto/LocalSystem；`control-server.service` 为 active/enabled，健康检查 HTTP 200。
- `git ls-files` 为 207；全程保留已有修改、历史制品、证据和 `tmp/repo-encoding-audit`，未执行 reset、clean、stage、commit 或 push。
- 服务端部署前备份为 `/opt/control-server-backups/final-ui-20260807-155423`，最终重新确认备份存在。

**三层自动化、构建与发布**

- 面板：`pnpm exec tsx --test tests/*.test.ts` 退出码 0，47/47；`pnpm exec tsc --noEmit` 退出码 0。为保护运行中的 `.next/dev`，在唯一隔离副本执行 `pnpm build`，退出码 0；仅出现既存 Next NFT trace warning，隔离副本已清理。
- 服务端：WSL `/tmp/nacho-final-20260807-155423` 执行 `npm ci --no-audit --no-fund`、`npm test`、`npm run build`，均退出码 0；27/27 通过。经验证的 `dist` 与正式制品同步到 `/opt/control-server` 后重启，SQLite 增量初始化成功，服务最终 active、健康接口 HTTP 200；隔离目录已清理。
- Agent：正式 1.1.13 源码执行 `dotnet test server/client/tests/Nacho.Agent.Tests/Nacho.Agent.Tests.csproj`，退出码 0、200/200；`dotnet build server/client/src/Nacho.Agent/Nacho.Agent.csproj -c Release` 退出码 0、0 warning/0 error；`publish.ps1` 退出码 0。
- 正式制品 `nacho-agent-1.1.13-win-x64.exe` 为 76,353,123 字节，SHA-256 `cbcd1a1cf98083b657df244ce929ce1c2a37c771f1832bcbd69ce4c309549c6c`；`latest.json` 的版本、文件名、大小和哈希与实际文件完全一致。
- 通过面板“客户端更新”依次完成测试策略 canary 与正式 1.1.13 升级；最终已安装程序版本为 1.1.13，安装文件 SHA-256 与正式制品一致，服务为 Running/Auto/LocalSystem。正式升级后策略探针 `cmd-0d24370a813f` 返回 failed，面板准确显示 PowerShell 被本机策略关闭，证明测试策略已经恢复。

**显示框架与七项真实链路**

- 全部操作从可见的 `http://localhost:3000/clients → 批量操作 → Windows` 页面发起；面板读取真实 API/SQLite 状态，并在刷新后的页面显示 Agent 终态，而非仅运行代码测试。
- 命令执行：CMD `cmd-00ba2f151d8a` 与 PowerShell `cmd-e15eea18d246` 均为 success、`exitCode:0`，分别显示 `shell:cmd`、`shell:powershell`、未截断和真实 stdout。
- 批量安装：EXE fixture 由 UI 创建、上传、选择并确认下发；批次 `batch-735b50b4342b` / 命令 `cmd-cbcea35d1f52` 为 success，下载 70.1 MiB、哈希通过、退出码 0、未超时；终态后由 UI 删除软件仓库测试包。
- 文件下发：新建 `cmd-8e22ff0a67ed` 为 success，最终 SHA-256 `a56c170f7ea9e733385dd0c7ea492ae219784af4fc9b4a2cc07dd162b63a8387`；备份替换 `cmd-d4f502e4aa7c` 为 success，显示替换是、备份有效，最终 SHA-256 `7ca925bd63673a648cc4c195766ab39b1d53bf98bea7d063ecd50c21288e9b30`；UI 回滚 `cmd-d1e46db7e1c6` 为 success 并恢复原哈希。
- 用户管理：UI 列表 `cmd-8e02cf306b5d`、禁用 `cmd-6bd3e11dffa9`、启用 `cmd-69cb9fbd11dc`、加入组 `cmd-cc28a582ed3b`、移出组 `cmd-a30d4b154b31` 均为 success，页面逐步显示启停与组成员变化；最终清理命令 `cmd-c0cc57b6ef26` 为 success，复核账户与组查询退出码均为 2（不存在）。
- 注册表：精确 HKLM 夹具前缀下 list `cmd-0113f4218943`、set `cmd-dad7b5df5aba`、delete `cmd-145da05d1410`、逆向回滚后 list `cmd-91764a3a51be` 及最终 delete/list `cmd-10ac3141a4fe` 均为 success；页面展示 `changed:true`、旧值/新值与回滚恢复。最终 `reg query` 退出码 1（夹具键不存在）。
- 消息推送：UI 向活动 Session 1 投递唯一测试消息，最终 `cmd-ab000e686773` 为 success、`confirmed`、`responseCode:1`、`timedOut:false`、1122 ms。
- 打开网页：UI 启动 `http://127.0.0.1:18765/index.html`，命令 `cmd-f1752e106e46` 为 success、Session 1、`processStarted:true`、PID 32420、25 ms；临时 HTTP 服务收到一次 `/index.html` GET 并返回 200，Edge 窗口标题显示 `Nacho Final UI Fixture`。
- 面板截图保存在 `server/artifacts/evidence/final-ui-20260807-155423/desktop-open-url.png` 与 `mobile-open-url.png`。390×844 实测 `innerWidth/clientWidth/scrollWidth=390/390/390`，无页面级横向溢出；面板 console warning/error 为 0。

**恢复与清理**

- UI 命令恢复 canary 启动前的受保护 `agent.json`，删除唯一账户/组、注册表键、文件目标、文件部署目录、消息/网页 intent 与测试策略标记；正式 1.1.13 升级后通过默认关闭探针复核配置生效。
- 软件包由 UI 删除；文件制品 `payload.txt`、`payload-v2.txt` 通过受认证 Panel API 删除；一次性 canary 1.1.11/1.1.12 的工作区与部署制品均已删除，只保留正式 1.1.13。
- 临时 HTTP 端口 18765 最终无监听，Windows fixture 目录不存在；WSL 隔离源码、工作区 canary/构建/脚本目录均已精确清理，根 `node_modules` 与 `tmp/repo-encoding-audit` 保留。
- 最终面板端口 3000 仍在监听；`NachoAgent` 为 Running/Auto/LocalSystem；`control-server.service` 为 active，健康接口 HTTP 200。

已完成最终三层联调与验收。
Windows 七项管理功能补全计划全部完成。

## 最终三层联调与验收

1. 面板运行 `pnpm exec tsx --test tests/*.test.ts`、`pnpm exec tsc --noEmit`、`pnpm build`，并检查 `/clients` 桌面与 `390x844`、加载/空/错/重试/离线/刷新恢复及控制台。
2. 服务端在 WSL `/tmp` 原生依赖隔离副本运行 `npm ci --no-audit --no-fund`、`npm test`、`npm run build`；部署前备份，保留 `.env`、SQLite 和 systemd 配置，重启后核对 active 与 `/health`，失败则回滚。
3. Agent 运行全量 test、Release build 与 `publish.ps1`；校验 `latest.json`、大小和 SHA-256，并通过现有升级链验证七项最小夹具、WebSocket/HTTP 回退、journal、结果重试和服务恢复。
4. 清理文件、包、账户、组、注册表、消息、网页和临时服务夹具，恢复 Agent 策略及测试前服务状态。
5. 七张卡片均调用真实 API；七类命令均有 Agent 处理器，`open-url` 不再设置本机策略门禁；逐客户端展示结构化结果；制品下载四重绑定；原有四项功能回归继续通过；日志和报告中无 token、配置或敏感正文。

最终完成标记：

```text
已完成最终三层联调与验收。
Windows 七项管理功能补全计划全部完成。
```

## 已锁定的假设与默认值

- 只补齐七项缺口，不重写已有四项。
- 批量安装使用服务端软件仓库；支持 MSI/EXE；强制 SHA-256，不增加 Authenticode。
- 文件冲突默认失败；显式替换时备份并支持回滚。
- 用户管理不包含创建账户和密码修改。
- 注册表仅为 HKLM/HKU 允许前缀，不提供递归删除键。
- 消息和网页投递到当前活动控制台或 RDP；无人登录时结构化失败。
- 新写操作策略默认关闭或允许列表为空；消息推送按 2026-08-07 后续生产要求调整为部署时默认启用，并由 Agent 1.1.7 对既有配置执行一次性、可回滚迁移。
- 面板只选择当前在线 Windows 客户端；创建后短暂离线继续走现有队列恢复。

## 阶段执行记录

### 2026-08-03 — 第 1 阶段：命令执行

**改动摘要**

- 面板：`TargetPicker` 改为受控选择器；命令执行卡片接入真实 CMD/PowerShell 表单、批量创建、每秒轮询、刷新恢复和严格结果展示；新增 `lib/run-shell.ts` 与测试。
- 服务端：新增严格命令判别 schema 和 `/api/panel/commands/batch`；目标 ID 去重、客户端存在性及 Windows 校验；`run-shell` 结果日志仅记录字节数。
- Agent：新增 `ShellCommandExecutor`、两个默认关闭策略、临时脚本清理、进程树超时、UTF-8 有界结果和重启稳定失败；安装脚本与示例配置同步默认字段。
- 文档：`server/README.md` 和 `server/client/README.md` 记录批量接口、命令契约、执行方式、结果边界和策略默认值。
- 边界修正：面板、服务端、Agent 均拒绝纯空格/换行脚本。

**自动化与构建证据（全部退出码 0）**

- `pnpm exec tsx --test tests/*.test.ts`：26/26 通过。
- `pnpm exec tsc --noEmit`：通过。
- 独立目录 `pnpm install --offline --frozen-lockfile && pnpm build`：Turbopack production build 通过，`/clients` 等路由生成成功；未改写正在运行的 `.next/dev`。
- WSL Debian `/tmp` 原生依赖隔离副本 `npm test && npm run build`：11/11 通过，TypeScript build 通过。
- `dotnet test server/client/tests/Nacho.Agent.Tests/Nacho.Agent.Tests.csproj --no-restore`：126/126 通过。
- `dotnet build server/client/src/Nacho.Agent/Nacho.Agent.csproj -c Release --no-restore`：0 warning / 0 error。

**浏览器证据**

- `http://localhost:3000/clients` 的“批量操作 → Windows → 命令执行”显示真实 shell 切换、脚本、超时、受控目标和提交按钮。
- 1280×720：document/body scrollWidth 均为 1280，无页面级横向溢出，控制台无 warning/error。
- 390×844：document/body scrollWidth 均为 390，无页面级横向溢出，控制台无 warning/error。

**真实链路证据**

- 使用已构建服务端候选、临时数据库和端口 18443 启动隔离控制服务；使用独立 data dir 启动 Windows 测试 Agent，并确认 WebSocket 已连接。
- CMD：`cmd-d65e3247f048` → `success`，exitCode 0，timedOut false，truncated false，stdout 标记 `NACHO_STAGE1_CMD`，duration 76 ms。
- PowerShell：`cmd-2f68a448b024` → `success`，exitCode 0，timedOut false，truncated false，stdout 标记 `NACHO_STAGE1_POWERSHELL`，duration 256 ms。
- 服务端日志中未出现两个脚本或 stdout 标记；Agent 工作目录临时脚本数为 0；两个 journal 项均为 completed。

**恢复情况**

- 隔离 Agent 与 18443 控制服务均按精确 PID/命令行终止；临时 Agent data dir、数据库、构建目录和路径记录均已删除；18443 无监听。
- 原 `NachoAgent` 保持 Running/Auto/LocalSystem，PID 18716；原 `control-server.service` 未部署改写，仍为 active/enabled，`http://localhost:8443/health` 返回成功。
- 工作区既有未提交文件、发布制品和 `tmp/repo-encoding-audit` 均保留。

已完成第 1 阶段：命令执行。
下一个阶段开始完成第 2 阶段：批量安装。

### 2026-08-04 — 第 2 阶段：批量安装

**改动摘要**

- 面板：`components/clients/extensions-panel.tsx` 接入真实 MSI/EXE 软件仓库、流式上传进度、失败草稿清理、受控 Windows 目标多选、包与客户端命令矩阵、批次轮询、刷新恢复和逐客户端结构化结果；`components/server-data-context.tsx` 提供带鉴权的二进制上传；`lib/package-deployment.ts` 集中定义表单校验、批次类型和结果解析。
- 服务端：`server/src/db/index.ts` 以可重复初始化方式新增 `managed_artifacts`、`deployment_batches`、`deployment_items`；`server/src/services/managed-artifacts.ts` 实现 draft → 流式 PUT → SHA-256 → 原子 ready、删除保护、批次历史和下载绑定；`server/src/routes/panel.ts`、`server/src/routes/agent.ts` 与 `server/src/schemas/commands.ts` 接入专用部署入口、查询及严格 `install-package` 契约。
- Agent：`PackageInstallManager` 实现受保护下载、大小与 SHA-256 校验、MSI 固定静默参数、EXE 参数数组、60–7200 秒超时、进程树终止、0/3010 结果、重启标记以及 intent 恢复/清理；`AgentOptions`、`CommandProcessor`、模型、示例配置和安装脚本同步 `allowPackageInstall` 等默认策略。
- 测试与文档：面板、服务端和 Agent 均新增批量安装目标测试；`server/README.md` 与 `server/client/README.md` 记录软件仓库、批次、下载绑定、命令结果和策略边界。

**阶段既有验收证据（本次按阶段交接记录归档，未重复执行真实安装）**

- 面板：30/30 通过；`pnpm exec tsc --noEmit` 通过；独立目录 `pnpm build` 通过，仅有既存 Next NFT trace warning。
- 服务端：Windows 16/16、WSL 原生隔离环境 16/16 通过；TypeScript build 通过。
- Agent：142/142 通过；Release build 为 0 warning / 0 error。
- 浏览器：`/clients` 已核对真实仓库、上传表单、目标选择和批次入口；1280×720 与 390×844 均无页面级横向溢出，控制台无 warning/error。
- 真实 EXE 链路：`cmd-5b8c2c500a00` → `success`，`exitCode: 0`、`hashVerified: true`、`rebootRequired: false`、`timedOut: false`；marker 已删除，Agent staging 剩余 0，错误客户端下载返回 HTTP 404，终态删除后批次历史与 payload 快照保留。
- 部署与恢复：服务端代码已部署到 `/opt/control-server`；备份 `/opt/control-server-backups/stage2-20260803T082941Z-14090` 本次只读确认存在。阶段交接记录确认隔离 Agent、隔离服务、数据库、安装包、marker 和路径记录已清理，已安装 `NachoAgent` 未升级、未改配置并保持原服务状态。

**2026-08-04 正式收尾核验（退出码 0）**

- 先审阅 `tmp/verify-stage2-deploy.sh`；发现其数据库路径误写为 `/var/lib/control-server/nacho.db`。首次执行输出 `MIGRATION_TABLES=` 并以退出码 2 结束；只读诊断确认运行服务实际打开 `/var/lib/control-server/control.db`。
- 将临时脚本修正为以 `readOnly: true` 打开运行库后执行：`wsl.exe -d Debian -u root -- bash /mnt/c/Users/Administrator/Documents/Codex/Nacho/nacho-main/tmp/verify-stage2-deploy.sh`。
- 字面输出：`MIGRATION_TABLES=deployment_batches,deployment_items,managed_artifacts`、`SERVICE_STATE=active`、`HEALTH_HTTP=200`、`POWERSHELL_OBSERVED_EXIT=0`。
- 精确删除首次错误检查产生的 0 字节 `/var/lib/control-server/nacho.db`；服务进程仅持有 `control.db`、`control.db-wal` 和 `control.db-shm`。随后使用 .NET 字面路径删除且只删除 `tmp/verify-stage2-deploy.sh`；复查脚本不存在，`tmp/repo-encoding-audit` 仍存在。
- 收尾前后均执行 `git status --short`；既有源码修改、发布制品、证据目录和运行数据均保留，未执行 `git reset`、`git clean`、暂存、提交或推送。

已完成第 2 阶段：批量安装。
下一个阶段开始完成第 3 阶段：文件下发。

### 2026-08-04 — 第 3 阶段：文件下发

**改动摘要**

- 面板：`components/clients/extensions-panel.tsx` 将文件下发占位区替换为真实文件选择/拖放、512 MiB 校验、制品流式上传进度、在线 Windows 目标多选、绝对目标路径、创建目录开关、`fail|replace` 确认、批次轮询/刷新恢复、逐客户端结构化结果和防重复回滚；新增 `lib/file-deployment.ts` 与纯逻辑测试。
- 服务端：`server/src/schemas/commands.ts` 增加严格 `deploy-file` 与 `rollback-file-deploy` 契约；`server/src/services/managed-artifacts.ts` 复用现有制品/批次/项目表创建文件部署矩阵，验证 ready file、Windows 在线目标、四重下载绑定、原命令所有权/成功结果/有效备份和回滚去重；`server/src/routes/panel.ts` 增加专用文件部署与回滚路由并阻止通用命令入口旁路。
- Agent：新增 `FileDeploymentManager`，实现本地盘绝对路径与允许根边界检查，拒绝 UNC、设备路径、ADS、通配符、目录目标及逃逸；下载后校验大小/SHA-256，支持新建、存在即失败、受保护备份替换、当前文件哈希保护回滚、intent 重启恢复、失败恢复和过期清理。`AgentOptions`、模型、DI、命令恢复、示例配置和安装脚本同步 `allowedDeployRoots: []` 与 `fileDeployBackupRetentionDays: 7`。
- 文档与证据：`server/README.md`、`server/client/README.md` 记录路由、命令、策略、结果、日志边界和恢复语义；真实链路证据保存于 `server/artifacts/evidence/stage3-file-deploy-20260804/`。

**自动化与构建证据（全部退出码 0）**

- `pnpm exec tsx --test tests/*.test.ts`：34/34 通过；`pnpm exec tsc --noEmit` 通过。
- `pnpm build`：Next.js 生产构建通过，全部路由生成成功；仅有既存 Next NFT trace warning。
- Windows `server` 目录 `npm test && npm run build`：19/19 通过，TypeScript build 通过。
- WSL Debian `/tmp/nacho-stage3-*` 原生依赖隔离副本执行 `npm ci --no-audit --no-fund && npm test && npm run build`：19/19 通过，build 通过，临时目录由 trap 精确清理。
- `dotnet test server/client/tests/Nacho.Agent.Tests/Nacho.Agent.Tests.csproj --no-restore`：153/153 通过。
- `dotnet build server/client/src/Nacho.Agent/Nacho.Agent.csproj -c Release --no-restore`：0 warning / 0 error。

**真实链路证据**

- 隔离服务端使用端口 18446、临时数据库/制品目录；当前 Release Agent 使用独立 data dir 和专用允许根通过 WebSocket 注册，未修改已安装 Agent。
- 新建：`cmd-0af9384fc770` → `success`，最终 SHA-256 `d3299a143216c6217d04a7121a9b9f2b5a30b0a3afe97a7ed82592b178038199`，下载哈希验证通过。
- 替换：`cmd-95a59e1969a2` → `success`，备份有效；旧 SHA-256 `eb2610d2efd39c580135ea84ee85766e861c36ed7db3b7e8a8519223826c3f75`，新 SHA-256 `207534e52d66e4a4a23e196b467f0822c1b11159974af7fb745e2b36e71b1152`。
- 回滚：`cmd-2f5a24a14685` → `success`，恢复 SHA-256 与旧文件完全一致，回滚后备份失效。
- 错误客户端请求同一制品/命令下载返回 HTTP 404；服务日志未出现三个文件正文标记；删除终态制品正文后，批次与命令 payload 快照仍可读取。

**浏览器与恢复**

- `http://127.0.0.1:3000/clients` 的“批量操作 → Windows → 文件下发”显示真实上传、展示名、目标路径、冲突策略、目录开关、目标选择和批次区域。
- 1280×720：document/body scrollWidth 均为 1280；390×844：document/body scrollWidth 均为 390；两种视口均无页面级横向溢出，控制台无 warning/error。
- 清理前 Agent `staged.bin` 为 0、`backup.bin` 为 0，4 个真实命令 journal 均留在隔离 data dir；随后精确终止隔离 Next/Agent/服务端进程并删除整个唯一夹具目录，端口 3000/18446 均无监听。
- 已安装 `NachoAgent` 保持 Running/Auto/LocalSystem，PID 23908；工作区既有修改、发布制品、证据和 `tmp/repo-encoding-audit` 均保留，未暂存、提交或推送。

已完成第 3 阶段：文件下发。
下一个阶段开始完成第 4 阶段：用户管理。

### 2026-08-06 — 第 4 阶段：用户管理

**改动摘要**

- 面板：`components/clients/extensions-panel.tsx` 将空用户列表替换为真实 `manage-local-user` 链路，使用在线 Windows 受控单选目标，展示账户名、SID、启用状态、内置标记和本地组；实现历史 list 恢复、搜索、加载/空/错误/离线状态、确认摘要、删除全名二次确认、防重复提交及写成功后自动 list。新增 `lib/local-user-management.ts` 与测试。
- 服务端：`server/src/schemas/commands.ts` 增加固定三字段的严格 action 判别 payload 与严格 result schema；`server/src/routes/panel.ts` 拒绝非 Windows 目标；`server/src/services/commands.ts` 校验 512 KiB UTF-8、结果 action 与命令 payload 一致、成功/失败与 error 一致，并只记录 action、changed、exitCode 和结果字节数。
- Agent：新增 `LocalUserManager` 与 `LocalUserPlatform`，通过 NetAPI/Win32 枚举和修改本地账户；新增默认关闭的 `allowLocalUserManagement`、`allowedLocalUsers`、`allowedLocalGroups`；实现名称边界、大小写不敏感精确允许项、RID 500/501/503/504 保护、启停/组操作幂等、删除不存在稳定结果及 running 删除重启后不重放。
- 配置与文档：`agent.example.json`、Windows 安装脚本、DI、命令处理器、`server/README.md`、`server/client/README.md` 同步契约、策略、结果、日志和恢复语义；证据保存于 `server/artifacts/evidence/stage4-user-management-20260806/`。

**自动化与构建证据（全部退出码 0）**

- `pnpm exec tsx --test tests/*.test.ts`：37/37 通过；`pnpm exec tsc --noEmit` 通过。
- 通过临时 `NACHO_NEXT_DIST_DIR=.next-stage4-build` 执行 `pnpm build`：Next.js production build 通过；仅有既存 NFT trace warning，构建目录已精确清理，运行中的端口 3000 dev 服务未中断。
- Windows `server` 目录 `npm test && npm run build`：21/21 通过，TypeScript build 通过。
- WSL Debian `/tmp/nacho-stage4-*` 原生依赖隔离副本执行 `npm ci --no-audit --no-fund && npm test && npm run build`：21/21 通过，build 通过，临时目录由 trap 精确清理。
- `dotnet test server/client/tests/Nacho.Agent.Tests/Nacho.Agent.Tests.csproj`：164/164 通过。
- `dotnet build server/client/src/Nacho.Agent/Nacho.Agent.csproj -c Release`：0 warning / 0 error。

**真实链路、部署与发布证据**

- 使用提升后的唯一一次性本地用户/组夹具并临时开启精确允许项；`list`：`cmd-b78941793e98`，`disable`：`cmd-da0b2f13bf63`，`enable`：`cmd-2e926af12960`，`add-to-group`：`cmd-72e4850bdb5b`，`remove-from-group`：`cmd-7d2c11569660`，`delete`：`cmd-ae570bd48d3f`，最终 `list`：`cmd-bf1744eafd70`；七条命令全部 `success`，五条写操作均 `changed:true`，最终列表确认夹具不存在。
- 审计日志复查确认未包含夹具账户、组或 SID/列表正文；命令结果保留严格结构化状态。
- WSL 控制服务部署备份为 `/opt/control-server-backups/stage4-20260806T032055Z-856` 与 `/opt/control-server-backups/stage4-final-20260806T033220Z-1681`；最终 `control-server.service` 为 active，`/health` 为 HTTP 200，七条命令在部署后重新读取仍全部 success。
- `publish.ps1` 发布 Agent `1.1.4`，文件 `nacho-agent-1.1.4-win-x64.exe` 为 76,271,201 字节，SHA-256 `1950ae78ba787e4668b57b1f4273068d0c45477cf66ceb61917a694f52889f56`；清单大小/哈希与文件完全一致。专用 `update-agent` 命令 `cmd-e8ebafeeb258` 为 success；已安装服务为 Running，程序版本 `1.1.4.0` 且哈希一致，服务端心跳为 online/connected/1.1.4。

**浏览器与恢复**

- `http://localhost:3000/clients` 的“单机管理 → 用户管理”展示真实服务端 list；内置账户的启停、组与删除按钮全部禁用，普通账户提供受控操作。
- 1280×720：document scrollWidth/clientWidth 为 1280/1280；390×844：为 390/390；两种视口无页面级横向溢出，控制台均无 warning/error。
- 真实验收后确认一次性用户、一次性组、临时允许策略、受保护配置备份和全部阶段脚本均已清理；原 Agent 配置已恢复，`NachoAgent` 保持 Running，临时 Next 构建目录与 WSL 隔离目录均无残留。
- 收尾 `git status --short` 确认第 1～3 阶段既有修改、制品、证据、运行数据和 `tmp/repo-encoding-audit` 均保留；未执行 reset、clean、暂存、提交或推送。

已完成第 4 阶段：用户管理。
下一个阶段开始完成第 5 阶段：注册表。

### 2026-08-06 — 第 5 阶段：注册表

**改动摘要**

- 面板：`components/clients/extensions-panel.tsx` 删除硬编码 `regEntries`，接入在线 Windows 受控单选与真实 `manage-registry` 历史/轮询；实现 HKLM/HKU、32/64 位 view、subKey、真实值表、六种类型编辑器、Base64 解码字节数、写/删确认、previous/current 展示、自动 list 刷新和严格逆向 set/delete 回滚。新增 `lib/registry-management.ts` 与测试。
- 服务端：`server/src/schemas/commands.ts` 增加固定七字段的 list/get/set/delete 严格契约与按 valueKind 判别的 result；校验路径、名称、控制字符、DWORD/QWORD 范围、multiString、规范 Base64、64 KiB 单值和 512 KiB 总结果。`server/src/routes/panel.ts` 拒绝非 Windows 目标；`server/src/services/commands.ts` 校验 action/终态并只记录 action、hive、view、pathHash、changed 和字节数。
- Agent：新增 `RegistryManager` 与 `WindowsRegistryPlatform`，直接使用 `Microsoft.Win32.RegistryKey`；新增默认空的 `allowedRegistryPaths`，实现 HKLM/HKU、Registry32/Registry64、完整段前缀边界、六种类型转换、写前旧值、写后新值、相同 set/缺失 delete 幂等和 running 写操作重启不重放。
- 配置、文档与证据：`agent.example.json`、Windows 安装脚本、DI、命令处理器、`server/README.md`、`server/client/README.md` 同步策略与契约；证据保存于 `server/artifacts/evidence/stage5-registry-20260806/`。

**自动化与构建证据（全部退出码 0）**

- `pnpm exec tsx --test tests/*.test.ts`：41/41 通过；`pnpm exec tsc --noEmit` 通过。
- 临时 `NACHO_NEXT_DIST_DIR=.next-stage5-build` 执行 `pnpm build`：Next.js production build 通过；仅有既存 NFT trace warning。独立构建目录已精确清理，端口 3000 dev 服务未中断。
- Windows `server` 目录 `npm test && npm run build`：23/23 通过，TypeScript build 通过。
- WSL Debian `/tmp/nacho-stage5-*` 原生依赖隔离副本执行 `npm ci --no-audit --no-fund && npm test && npm run build`：23/23 通过，build 通过，临时目录由 trap 清理。
- `dotnet test server/client/tests/Nacho.Agent.Tests/Nacho.Agent.Tests.csproj`：180/180 通过。
- `dotnet build server/client/src/Nacho.Agent/Nacho.Agent.csproj -c Release`：0 warning / 0 error。

**真实链路、部署与发布证据**

- 真机仅使用 `HKLM\SOFTWARE\Nacho\TestFixtures\<GUID>` 唯一夹具并临时把精确路径加入 `allowedRegistryPaths`。15 条命令覆盖 64 位空列表、新建 string、get、32 位隔离、覆盖为 dword、相同 set 幂等、delete 返回旧值、由旧值生成逆向 set 回滚、回滚后 list、32 位 binary set/get/delete、64 位清理及两视图最终空列表；全部 `success`。
- 关键命令：新建 `cmd-1dc1ae3b7b26`、覆盖 `cmd-adb20a69f323`、幂等 `cmd-84cdfa42c6ec`、删除 `cmd-380986942b1b`、逆向回滚 `cmd-572c68b36815`、32 位 binary `cmd-dd138f144755`、最终 64/32 位列表 `cmd-1ba03194697d` / `cmd-94e04dd0b311`。
- 审计日志确认未包含完整 subKey、valueName、字符串或 binary 正文，仅保留哈希摘要和必要状态。
- WSL 部署备份 `/opt/control-server-backups/stage5-20260806T082443Z-4608`；最终服务 active，健康接口 HTTP 200，部署后重新读取 15 条命令仍全部 success。
- `publish.ps1` 发布 Agent `1.1.5`，文件 76,299,873 字节，SHA-256 `e34164284c9fd28982cd976c7e57bd6d23409ff4d5992d371240edd12c1cc889`；清单与文件一致。`update-agent` 命令 `cmd-e609e048c354` success；已安装服务 Running，程序版本 `1.1.5.0` 且哈希一致。

**浏览器与恢复**

- `http://localhost:3000/clients` 的“单机管理 → 注册表”恢复真实最终 list，展示 hive/view/subKey、六种编辑器、Base64 解码 4 字节提示、删除和回滚入口。
- 1280×720：document scrollWidth/clientWidth 为 1280/1280；390×844：为 390/390。窄屏值表局部 clientWidth/scrollWidth 为 186/680，可局部横向滚动；控制台无 warning/error。
- 真机验收后提升检查确认唯一 GUID 键在 Registry64 与 Registry32 均不存在，Agent 配置和 `allowedRegistryPaths` 已恢复，受保护备份、脚本和临时目录已清理，`NachoAgent` 保持 Running。
- 收尾保留第 1～4 阶段已有修改、制品、证据、运行数据和 `tmp/repo-encoding-audit`；未执行 reset、clean、暂存、提交或推送。

已完成第 5 阶段：注册表。
下一个阶段开始完成第 6 阶段：消息推送。

### 2026-08-07 — 第 6 阶段：消息推送

**改动摘要**

- 面板：`MessagePush` 接入真实 `show-message` 批量命令，提供 Unicode 标量计数、info/warning/error、5–300 秒超时、在线 Windows 受控目标、提交摘要、防重复、每秒轮询、同批 expiresAt 恢复和逐客户端 session/响应/超时/耗时展示；新增 `lib/message-push.ts` 与测试。
- 服务端：新增严格请求/Agent payload/result schema，拒绝调用者注入 expiresAt，统一生成创建后五分钟 UTC 过期时间；批量目标去重并限制 Windows。日志不记录标题/正文，只记录 severity、deliveryStatus、sessionId、responseCode、timedOut 与结果字节数。
- Agent：新增可替换的 `ActiveUserSessionResolver`、WTS 会话平台与 `WindowsMessageSender`；活动控制台优先、RDP 按 session ID 稳定回退，使用 `WTSSendMessageW` 映射图标及确认/取消/超时。新增 `allowMessagePush:false`、无会话/过期/Win32 结构化失败和不含正文的 intent；投递开始后重启或重复执行不再次弹窗。
- 文档与证据：更新 `server/README.md`、`server/client/README.md`、示例配置和安装脚本；证据位于 `server/artifacts/evidence/stage6-message-push-20260807/`。

**验证与部署**

- 面板 44/44、服务端 Windows/WSL 均 25/25、Agent 190/190；TypeScript、Next production build、服务端 build、Agent Release build 全部通过，Agent 为 0 warning/0 error。
- WSL 部署备份 `/opt/control-server-backups/stage6-20260807T044320Z-208`；服务最终 active，健康接口 HTTP 200。
- 发布 Agent 1.1.6，76,324,449 字节，SHA-256 `018889b3512789b36171c171d047b81a75108caec44d0c8cbd82acbbd3c5cc36`；升级命令 `cmd-e2a2848a0d4c` success。
- 2026-08-07 严格收尾时浏览器插件已恢复可用：`/clients → 批量操作 → Windows → 消息推送` 在 1280×720 与 390×844 均完成真实页面核对；document/body 宽度分别为 1280/1280 与 390/390，无页面级横向溢出，控制台 warning/error 为 0，并保存四张视口截图与 `browser-verification.json`。

**真实链路与恢复**

- 临时开启 `allowMessagePush`，向当前活动 session 1 仅投递一次明确测试消息；命令 `cmd-39a47bfa66bf` 为 success，WTSSendMessage 响应 32000，deliveryStatus `timed-out`，timedOut true，耗时 5046 ms。
- 首次真实弹窗采用 5 秒显示超时自然关闭；严格收尾另以发布版 Agent 1.1.6 和隔离真实控制服务投递 `cmd-437d34fa2eec`，在 Session 1 取得 `confirmed`、`responseCode:1`、`timedOut:false`、`durationMs:3970` 的真实结果。
- 隔离 Agent 重启后该 confirmed 命令记录仍为 1 条且没有第二次投递；隔离服务审计日志不含测试标题或正文。`confirmed-chain.json` 与更新后的 `real-chain.json` 保存字面结果。
- Agent 重启后同一命令仍为唯一一条 terminal success 记录，没有再次投递；日志中不存在测试标题和正文。
- 验收后 Agent 配置与 `allowMessagePush` 已恢复，唯一 message intent 已删除，临时脚本和构建目录已清理，NachoAgent 保持 Running。
- 补充验收使用的隔离 Next、Agent、控制服务、数据库、设备身份、journal/intent 和辅助脚本均已精确清理；端口 3000/18447 无残留监听，`tmp/repo-encoding-audit` 保留。

**2026-08-07 生产策略修复**

- 根据生产部署要求，Agent 1.1.7 将消息推送调整为部署时默认启用：新安装与覆盖部署均写入 `allowMessagePush:true`；既有数据目录首次启动时备份原配置、执行一次性迁移并写入迁移标记。标记存在后不再持续强制，管理员后续显式关闭仍会保留。
- 新增 `AgentPolicyMigratorTests`；迁移与消息目标测试 14/14、Agent 全量 194/194 通过，Release build 为 0 warning / 0 error。
- 发布 `nacho-agent-1.1.7-win-x64.exe`，76,332,641 字节，SHA-256 `1fdc19d16711e75deccccd1bb6e97602091c6bcf434b257dc81ac07df9a4d3e4`；正式制品目录备份为 `/opt/control-server-backups/stage6-policy-20260807T063545Z`。
- 正式升级命令 `cmd-da8108ab6183` 为 success/healthy，客户端从 1.1.6 升至 1.1.7，未回滚。正式消息 `cmd-bc19db4f49e5` 向“猫羽雫的计算姬”投递成功：Session 1、confirmed、responseCode 1、timedOut false、3446 ms；审计正文脱敏通过。
- `production-policy-fix.json` 保存正式链路记录；`rollback-production-message-push.ps1` 提供基于受保护原配置备份的哈希核验回滚。Linux 控制服务保持 active，健康接口 HTTP 200。

已完成第 6 阶段：消息推送。
下一个阶段开始完成第 7 阶段：打开网页。

### 2026-08-07 — 第 7 阶段：打开网页

**改动摘要**

- 面板：`OpenWebpage` 从空壳改为真实 `open-url` 批量命令，提供 2048 字符、绝对 HTTP/HTTPS、userinfo/控制字符校验、在线 Windows 受控多选、准确确认文案、防重复、每秒轮询、同批恢复及逐客户端 session/process/PID/耗时/error 展示；空 `urlPresets` 不渲染。新增 `lib/open-url.ts` 与测试。
- 服务端：严格请求/Agent payload/result schema，拒绝调用方注入 `expiresAt`，同批生成创建后五分钟过期时间并拒绝离线或非 Windows 目标；结果终态与 `processStarted/pid/expired/error` 交叉校验。创建审计只记录规范化 scheme/host，结果审计只记录启动摘要与字节数，path/query/fragment 均不进入日志。
- Agent：新增 `OpenUrlManager`、可替换 `IUserProcessLauncher` 与 Win32 启动器；复用 `ActiveUserSessionResolver`，以 WTS 用户 token、`DuplicateTokenEx`、用户环境块和 `CreateProcessAsUserW` 在活动用户桌面启动系统 `explorer.exe`，URL 为独立参数。新增 `allowOpenUrl:false`、`allowedUrlSchemes:["https"]`、`allowedUrlHosts:[]`，实现 IDN/大小写/尾点规范化后的精确 host 允许列表、过期/无人会话/策略/Win32 失败和不含 URL 的 intent，启动开始后不重放。
- 配置、文档与证据：更新 `agent.example.json`、Windows 安装脚本、DI、命令处理器、`server/README.md`、`server/client/README.md`；证据位于 `server/artifacts/evidence/stage7-open-url-20260807/`。

**自动化、构建与部署（全部退出码 0）**

- 面板 `pnpm exec tsx --test tests/*.test.ts` 为 47/47，`pnpm exec tsc --noEmit` 通过，`pnpm build` 通过，仅有既存 Next NFT trace warning。
- 服务端 Windows 与 WSL Debian `/tmp` 原生依赖隔离环境均为 27/27，TypeScript build 均通过；WSL 临时目录已精确删除。
- Agent 为 200/200；Release build 为 0 warning / 0 error。
- WSL 首次部署备份 `/opt/control-server-backups/stage7-20260807T071135Z-1712`，最终严格路由补丁部署备份 `/opt/control-server-backups/stage7-final-20260807T074116Z-3246`；最终 `control-server.service` 为 active，健康接口 HTTP 200。
- 最终发布 `nacho-agent-1.1.10-win-x64.exe`，76,353,123 字节，SHA-256 `c2f668946b98119c453cfcc6a1b02a486cd9ee2c0a2f5d9aa0cdb5be09f31746`，清单大小/哈希与文件一致；升级命令 `cmd-1b980002fecb` 为 success/healthy、未回滚，已安装程序与清单一致且服务 Running。

**真实链路、浏览器与恢复**

- 受 ACL 保护配置保持未改动；使用隔离源码副本构建的一次性 1.1.9 canary 仅为缺失配置字段提供 `allowOpenUrl=true`、HTTP/HTTPS 与精确 `127.0.0.1` 的有效测试策略。canary 升级 `cmd-b42ac8d2d23b` success；验收后已从服务端和工作区精确删除，并升级到正式默认关闭的 1.1.10。
- 真机命令 `cmd-551d41020404` 为 success：Session 1、`processStarted:true`、PID 30440、`durationMs:40`、`expired:false`。本机 fixture 收到一次 `/stage7?query-secret=redacted` 导航与一次 favicon；Edge 标题确认页面可见，fragment 未被发送。
- 正式升级造成 Agent 重启后导航计数仍为 1，没有重复打开。审计包含 `scheme=http;host=127.0.0.1` 与 `processStarted=true`，不含 query/fragment。最终策略探针 `cmd-bf9fe9007a88` 为 failed/`POLICY_DISABLED`、`processStarted:false`，证明正式安装态已恢复默认关闭。
- `/clients → 批量操作 → Windows → 打开网页` 在 1280×720 与 390×844 的 document 宽度分别为 1280/1280 与 390/390，无页面级横向溢出，控制台 warning/error 为 0；真实失败结构化结果与准确“浏览器启动请求失败”文案可见。
- fixture 页面已关闭；误触 Edge 窗口关闭后已用浏览器会话恢复原 7 个页面，再只关闭 fixture tab。临时 HTTP 端口 18777、canary 源码/发布目录/服务端制品和一次性脚本均已清理；`tmp/repo-encoding-audit` 保留。面板原 dev 服务保持运行，Agent 保持 Running，WSL 服务 active/HTTP 200。

已完成第 7 阶段：打开网页。
七个功能阶段全部完成，开始最终三层联调与验收。

### 2026-08-10 — 关闭全部 Agent 本机策略门禁

- 目标：新增兼容开关 `disableAllPolicies`。为 `true` 时绕过 CMD、PowerShell、软件安装、本地用户、注册表、消息、文件下发、服务、进程、系统重启、日志采集、程序允许列表和 Agent 升级的本机 allow/deny 门禁；协议字段、过期时间、路径格式、大小、会话、哈希、intent、防重放和结构化结果校验保持启用。
- 迁移：Agent 1.1.16 首次启动备份旧配置到 `agent.json.before-all-policies-disabled.bak`，写入 `disableAllPolicies:true` 并生成 `all-policies-disabled-v1.json`，后续启动幂等。
- Agent：全量测试 202/202；目标迁移、Shell 和 open-url 测试 25/25；Release build 0 warning/0 error；发布制品 `nacho-agent-1.1.16-win-x64.exe` 为 76,361,315 字节，SHA-256 `b983ad33fd60c3100091e382b62059a93978de1179fcc2ffb0886713b25fbc3a`，清单与文件一致。
- 部署：备份目录 `/opt/control-server-backups/open-url-policy-removal-20260810` 增补 1.1.15 回滚制品；正式升级命令 `cmd-09edb9519512` 为 success/healthy，最终 Agent 为 1.1.16、Running/Auto/LocalSystem。
- 真实验证：服务端 API 下发 PowerShell `Write-Output POLICY_BYPASS_OK`，命令 `cmd-9ff035bf4f21` 为 success、`exitCode:0`、stdout 为 `POLICY_BYPASS_OK`，此前的 `PowerShell execution is disabled by local policy` 不再出现。
- 健康：`control-server.service` active，健康 HTTP 200，面板端口 3000 保持监听；临时脚本已清理，`tmp/repo-encoding-audit` 保留。