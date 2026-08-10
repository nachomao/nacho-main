# Windows 七项管理功能剩余工作——独立 IDE 提示词

> 初始生成日期：2026-08-03；最近进度同步：2026-08-07  
> 仓库根目录：`C:\Users\Administrator\Documents\Codex\Nacho\nacho-main`  
> 原进度计划：`C:\Users\Administrator\Documents\Codex\Nacho\nacho-main\WINDOWS_FEATURE_COMPLETION_PLAN.md`  
> 用途：把本文件中的某一个阶段单独复制到其他 IDE／AI 中继续实施。本文记录任务、已完成阶段证据与当前交接状态；已归档阶段只在最终验收中回归。

## 一、当前真实进度

- [x] 第 1 阶段：命令执行——**已完成，禁止重复实现；最终验收时只做回归**。
- [x] 第 2 阶段：批量安装——**已完成并正式归档，禁止重复实现；最终验收时只做回归**。
- [x] 第 3 阶段：文件下发——**已完成并正式归档，禁止重复实现；最终验收时只做回归**。
- [x] 第 4 阶段：用户管理——**已完成并正式归档，禁止重复实现；最终验收时只做回归**。
- [x] 第 5 阶段：注册表——**已完成并正式归档，禁止重复实现；最终验收时只做回归**。
- [x] 第 6 阶段：消息推送——**已完成并正式归档，禁止重复实现；最终验收时只做回归**。
- [x] 第 7 阶段：打开网页——**已完成并正式归档，禁止重复实现；最终验收时只做回归**。
- [ ] 最终三层联调与验收——尚未实施。

七个功能阶段已经全部完成并归档；当前唯一未完成项是最终三层联调与验收。按用户要求，第 7 阶段文档同步后先停下等待回应，不自动进入最终验收。

## 二、使用方法

1. **一次只复制一个阶段**到其他 IDE；每个阶段下面都提供了独立、可直接执行的提示词。
2. 严格按顺序推进：第 2 阶段正式归档后才能开始第 3 阶段，此后依次推进。
3. 每次先读取仓库根目录的 `AGENTS.md`、本文件、原进度计划、相关源码和测试，并执行 `git status --short`。
4. 保留工作区已有未提交修改、发布制品、证据目录、运行数据和 `tmp/repo-encoding-audit`；不得执行 `git reset`、`git clean`、擅自暂存、提交或推送。
5. 面板、服务端、Agent、测试、文档、真实链路和恢复必须在同一阶段闭环。不得用 React 本地 state、硬编码数组或 `setTimeout` 伪造服务端成功，这类狗屁空壳不计为完成。
6. 一个阶段未闭环时保持未勾选，不得提前开发下一个阶段。
7. 本文中的“已确认”数据是交接基线；接手 AI 对它将要声称的最终结果仍需亲自重新核验。

---

# 第 1 阶段独立提示词：命令执行（已完成备注）

## 状态备注

**本阶段已完成，不要重新实现。** 已完成真实 `run-shell` 链路，支持 CMD 与 Windows PowerShell；面板、服务端、Agent、测试、文档、真实链路和恢复均已闭环。

已记录的完成证据：

- 面板逻辑测试：26/26 通过。
- 服务端 WSL 测试：11/11 通过，TypeScript build 通过。
- Agent 测试：126/126 通过，Release build 0 warning / 0 error。
- 隔离真实链路分别执行只读 CMD 与 PowerShell，均为 `success`、`exitCode: 0`。
- 桌面及 `390x844` 浏览器检查无页面级横向溢出。
- 临时脚本、输出和夹具已清理，测试前 Agent 与服务状态已恢复。

## 可独立复制的提示词

```text
你正在处理 Windows 管理功能的第 1 阶段“命令执行”。本阶段已经完成，禁止重新实现、重构或覆盖现有 run-shell 链路。

仓库：C:\Users\Administrator\Documents\Codex\Nacho\nacho-main
先读取 AGENTS.md、WINDOWS_REMAINING_WORK_IDE_PROMPT.md、WINDOWS_FEATURE_COMPLETION_PLAN.md，并执行 git status --short，保留全部已有修改和制品。

现有能力包括：CMD/Windows PowerShell 双模式、严格 payload、批量 Windows 目标、真实命令轮询、ShellCommandExecutor、临时脚本、策略默认关闭、超时进程树终止、UTF-8 有界结果及重启稳定失败。原计划已经把第 1 阶段标为 [x]。

本阶段只在最终统一验收中参加回归；当前不要改动第 1 阶段代码，不要重新跑真机命令，也不要改变完成标记。若只是继续后续开发，直接退出本阶段并从原计划第一个未勾选阶段开始。
```

---

# 第 2 阶段独立提示词：批量安装（已完成备注）

## 状态备注

**本阶段已完成并正式归档，不要重新实现。** 已完成真实 MSI/EXE 软件仓库与批量安装链路；面板、服务端、Agent、测试、文档、浏览器、真实 EXE 链路、部署核验和恢复均已闭环，`WINDOWS_FEATURE_COMPLETION_PLAN.md` 已将第 2 阶段标为 `[x]`。

已存在的实现：

- 服务端已实现 `managed_artifacts`、`deployment_batches`、`deployment_items`，流式上传、SHA-256、原子 ready、活动命令删除保护、批次历史和四重下载绑定。
- 已实现仓库路由、`POST /api/panel/package-deployments`、批次查询及 Agent 受保护下载路由。
- Agent 已实现 `PackageInstallManager`、MSI 固定静默参数、EXE 参数数组、大小/哈希校验、超时、进程树终止、3010 重启标记、intent 恢复与清理。
- 面板已实现真实软件仓库、MSI/EXE 上传、进度、失败清理、多包多客户端矩阵、批次轮询、刷新恢复和逐客户端结果。
- 文档已更新到 `server/README.md` 和 `server/client/README.md`。

已记录的完成证据：

- 面板：30/30；`pnpm exec tsc --noEmit` 通过；独立目录 `pnpm build` 通过，仅有既存 Next NFT trace warning。
- 服务端：Windows 环境 16/16；WSL 原生隔离环境 16/16；build 通过。
- Agent：142/142；Release build 0 warning / 0 error。
- 浏览器真实页面已核对仓库、上传表单、目标选择和批次入口；1280×720 与 390×844 均无页面级横向溢出，控制台无 warning/error。
- 真实 EXE 链路：命令 `cmd-5b8c2c500a00` 为 `success`，`exitCode: 0`、`hashVerified: true`、`rebootRequired: false`、`timedOut: false`；测试 marker 已删除；Agent staging 剩余 0；错误客户端的下载请求返回 HTTP 404；终态删除后批次历史及 payload 快照保留。
- 服务端代码已部署到 `/opt/control-server`；部署备份 `/opt/control-server-backups/stage2-20260803T082941Z-14090` 已确认存在。
- 2026-08-04 正式收尾核验确认运行数据库 `/var/lib/control-server/control.db` 存在 `deployment_batches`、`deployment_items`、`managed_artifacts`，`control-server.service` 为 `active`，健康接口为 HTTP 200，核验命令退出码为 0。
- 原核验脚本中的错误数据库路径已定位；其产生的 0 字节 `/var/lib/control-server/nacho.db` 已精确清理。临时脚本 `tmp/verify-stage2-deploy.sh` 已删除，`tmp/repo-encoding-audit` 和工作区既有修改、制品及证据均保留。
- 隔离 Agent、隔离服务、数据库、安装包、marker 和路径记录均已清理；已安装 `NachoAgent` 未升级、未改配置并保持原服务运行态。

## 可独立复制的提示词

```text
你正在处理 Windows 管理功能的第 2 阶段“批量安装”。本阶段已经完成并正式归档，禁止重新实现、重构、重复部署或覆盖现有批量安装链路。

仓库：C:\Users\Administrator\Documents\Codex\Nacho\nacho-main
先读取 AGENTS.md、WINDOWS_REMAINING_WORK_IDE_PROMPT.md、WINDOWS_FEATURE_COMPLETION_PLAN.md，并执行 git status --short，保留全部已有修改、发布制品、证据和 tmp/repo-encoding-audit。

现有能力包括：MSI/EXE 软件仓库、draft/流式 PUT/SHA-256/原子 ready、活动命令删除保护、包×客户端命令矩阵、批次轮询与刷新恢复、四重下载绑定、PackageInstallManager、固定 MSI 静默参数、EXE 参数数组、大小/哈希校验、超时进程树终止、3010 重启标记及 intent 恢复。原计划已经把第 2 阶段标为 [x]。

本阶段只在最终统一验收中参加回归；当前不要改动第 2 阶段业务代码，不要重复部署或重跑真实安装，也不要改变完成标记。若继续后续开发，从原计划第一个未勾选阶段——第 3 阶段“文件下发”开始。
```

---
# 第 3 阶段独立提示词：文件下发（已完成备注）

## 状态备注

**本阶段已完成并正式归档，不要重新实现。** 已复用 `managed_artifacts`、`deployment_batches`、`deployment_items` 完成最大 512 MiB 的真实 Windows 文件下发、显式替换、受保护备份及哈希保护回滚；面板、服务端、Agent、自动化、真实链路、浏览器、清理恢复和文档均已闭环，`WINDOWS_FEATURE_COMPLETION_PLAN.md` 已将第 3 阶段标为 `[x]`。

已存在的实现：

- 面板已实现真实文件选择/拖放、上传校验与进度、失败制品清理、在线 Windows 目标多选、绝对目标路径、`createDirectories`、`fail|replace` 确认、批次轮询/刷新恢复、逐客户端结构化结果和防重复回滚。
- 服务端已实现严格 `deploy-file`/`rollback-file-deploy` 契约、`POST /api/panel/file-deployments`、专用回滚路由、文件部署矩阵、原命令所有权/成功结果/有效备份校验、回滚去重和四重下载绑定。
- Agent 已实现 `FileDeploymentManager`、允许根边界、UNC/设备路径/ADS/通配符/目录逃逸拒绝、大小与 SHA-256 校验、新建、冲突失败、受保护备份替换、当前文件哈希保护回滚、intent 恢复和过期清理。
- 新安装默认配置包含 `allowedDeployRoots: []` 与 `fileDeployBackupRetentionDays: 7`；空允许根等价于功能关闭，覆盖升级保留管理员配置。
- `server/README.md` 与 `server/client/README.md` 已记录路由、契约、策略、结果、日志与恢复语义。

已记录的完成证据：

- 面板：34/34；`pnpm exec tsc --noEmit` 通过；Next production build 通过，仅有既存 NFT trace warning。
- 服务端：Windows 19/19；WSL Debian `/tmp` 原生依赖隔离环境 19/19；两处 TypeScript build 均通过。
- Agent：153/153；Release build 0 warning / 0 error。
- 真实链路：新建 `cmd-0af9384fc770`、替换 `cmd-95a59e1969a2`、回滚 `cmd-2f5a24a14685` 均为 `success`；新旧、替换和恢复 SHA-256 全部一致。
- 错误客户端的受保护下载返回 HTTP 404；服务日志无文件正文；终态制品正文删除后批次与 payload 快照仍保留。
- 1280×720 与 390×844 均无页面级横向溢出，控制台无 warning/error。
- 隔离 Next、服务端、Agent、数据库、制品、目标、暂存、备份和 intent/journal 夹具目录已精确清理；端口 3000/18446 无监听；已安装 `NachoAgent` 保持 Running/Auto/LocalSystem。
- 证据保存在 `server/artifacts/evidence/stage3-file-deploy-20260804/real-chain.json` 与 `verification.txt`。

## 可独立复制的提示词

```text
你正在处理 Windows 管理功能的第 3 阶段“文件下发”。本阶段已经完成并正式归档，禁止重新实现、重构、重复部署或覆盖现有文件下发与回滚链路。

仓库：C:\Users\Administrator\Documents\Codex\Nacho\nacho-main
先读取 AGENTS.md、WINDOWS_REMAINING_WORK_IDE_PROMPT.md、WINDOWS_FEATURE_COMPLETION_PLAN.md，并执行 git status --short，保留全部已有修改、发布制品、证据和 tmp/repo-encoding-audit。

现有能力包括：512 MiB file artifact、draft/流式 PUT/SHA-256/原子 ready、在线 Windows 批次、四重下载绑定、严格 deploy-file/rollback-file-deploy、允许根路径边界、显式目录创建、fail/replace、受保护备份、当前文件哈希保护回滚、intent 重启恢复、七天清理、逐客户端结果和刷新恢复。原计划已经把第 3 阶段标为 [x]。

本阶段只在最终统一验收中参加回归；当前不要改动第 3 阶段业务代码，不要重复部署或重跑真实文件链路，也不要改变完成标记。若继续后续开发，从原计划第一个未勾选阶段——第 4 阶段“用户管理”开始。
```

---
# 第 4 阶段独立提示词：用户管理（已完成备注）

## 状态备注

**本阶段已完成并正式归档，不要重新实现。** 已完成真实 `manage-local-user` 三层链路，范围为 Windows 本地账户查询、启用、禁用、删除和本地组加入/移出；不创建账户、不修改密码。

已存在的实现：
- 面板使用在线 Windows 受控单选目标，展示真实账户名、SID、启用状态、内置标记和本地组，支持历史 list 恢复、确认摘要、删除全名二次确认、防重复与写后自动刷新。
- 服务端使用固定 `action/userName/groupName` 三字段严格判别 schema，只接受 Windows 目标，并校验 result 大小、结构、action 与终态一致性；日志不复制账户、组或 SID 列表正文。
- Agent 使用 NetAPI/Win32；策略为 `allowLocalUserManagement:false`、`allowedLocalUsers:[]`、`allowedLocalGroups:[]`；写操作精确命中允许项，以 SID/RID 保护内置账户，启停和组关系幂等，已开始的删除在重启后不重放。
- 文档已更新到 `server/README.md` 与 `server/client/README.md`；证据位于 `server/artifacts/evidence/stage4-user-management-20260806/`。

已重新核验的完成证据：
- 面板 37/37、服务端 Windows/WSL 均 21/21、Agent 164/164；TypeScript、Next production build、服务端 build 和 Agent Release build 均通过。
- 真实 `list -> disable -> enable -> add-to-group -> remove-from-group -> delete -> list` 七条命令全部 success；审计脱敏通过。
- Agent 已发布并升级到 1.1.4，76,271,201 字节，SHA-256 `1950ae78ba787e4668b57b1f4273068d0c45477cf66ceb61917a694f52889f56`。
- 桌面与 390x844 无页面级横向溢出或控制台错误；一次性用户/组、临时策略、配置备份、脚本和临时目录均已恢复或清理，服务最终为 active/Running/HTTP 200。

## 可独立复制的提示词

```text
你正在处理 Windows 管理功能的第 4 阶段“用户管理”。本阶段已经完成并正式归档，禁止重新实现、重构、重复部署或覆盖现有 manage-local-user 链路。

仓库：C:\Users\Administrator\Documents\Codex\Nacho\nacho-main
先读取 AGENTS.md、WINDOWS_REMAINING_WORK_IDE_PROMPT.md、WINDOWS_FEATURE_COMPLETION_PLAN.md，并执行 git status --short，保留全部已有修改、发布制品、证据和 tmp/repo-encoding-audit。

现有能力包括：固定三字段严格 payload、Windows 单机目标、真实账户/SID/启用/内置/组列表、历史恢复、确认与删除二次输入、写后自动 list、严格 result 与日志脱敏、NetAPI/Win32、默认关闭策略、精确允许项、RID 保护、幂等写操作和删除重启不重放。原计划已经把第 4 阶段标为 [x]。

本阶段只在最终统一验收中参加回归；当前不要改动第 4 阶段业务代码，不要重复创建真实用户/组或重新部署。若继续后续开发，从原计划第一个未勾选阶段——第 5 阶段“注册表”开始。
```

---

# 第 5 阶段独立提示词：注册表（已完成备注）

## 状态备注

**本阶段已完成并正式归档，不要重新实现。** 已完成真实 `manage-registry` 三层链路，范围严格限定为 HKLM/HKU 允许前缀内的值级 list/get/set/delete；不提供 HKCU、递归枚举或递归删除键。

已存在的实现：
- 面板使用在线 Windows 受控单选，提供 hive、32/64 位 view、subKey、真实值列表、六种类型编辑器、Base64 解码字节数、写/删确认、previous/current 展示、自动刷新和严格逆向 set/delete 回滚。
- 服务端使用固定七字段严格 schema，按 action/valueKind 验证路径、类型、范围、Base64、64 KiB 单值和 512 KiB 总结果；只接受 Windows 目标，日志只保留 action、hive、view、pathHash、changed 与字节数。
- Agent 使用 `Microsoft.Win32.RegistryKey`，策略为 `allowedRegistryPaths:[]`，支持 HKLM/HKU 与 Registry32/Registry64；执行完整段前缀匹配、六种类型转换、旧值返回、幂等 set/delete 和重启不重放。
- 文档已更新到 `server/README.md` 与 `server/client/README.md`；证据位于 `server/artifacts/evidence/stage5-registry-20260806/`。

已重新核验的完成证据：
- 面板 41/41、服务端 Windows/WSL 均 23/23、Agent 180/180；TypeScript、Next production build、服务端 build 和 Agent Release build 均通过。
- 唯一 HKLM TestFixtures GUID 夹具的 15 条真实命令全部 success，覆盖新建、读取、覆盖、幂等、删除、逆向回滚、Registry32/Registry64 隔离和 binary；日志脱敏通过。
- Agent 已发布并升级到 1.1.5，76,299,873 字节，SHA-256 `e34164284c9fd28982cd976c7e57bd6d23409ff4d5992d371240edd12c1cc889`。
- 桌面与 390x844 无页面级横向溢出；窄屏长值表只在局部横向滚动。GUID 键在两视图均已删除，Agent 配置、策略和服务已恢复。

## 可独立复制的提示词

```text
你正在处理 Windows 管理功能的第 5 阶段“注册表”。本阶段已经完成并正式归档，禁止重新实现、重构、重复部署或覆盖现有 manage-registry 链路。

仓库：C:\Users\Administrator\Documents\Codex\Nacho\nacho-main
先读取 AGENTS.md、WINDOWS_REMAINING_WORK_IDE_PROMPT.md、WINDOWS_FEATURE_COMPLETION_PLAN.md，并执行 git status --short，保留全部已有修改、发布制品、证据和 tmp/repo-encoding-audit。

现有能力包括：严格七字段 payload、HKLM/HKU、Registry32/Registry64、六种值类型、64 KiB/512 KiB 边界、在线单选、真实值列表、历史恢复、类型编辑器、previous/current、逆向回滚、RegistryKey、精确允许前缀、幂等和重启不重放。原计划已经把第 5 阶段标为 [x]。

本阶段只在最终统一验收中参加回归；当前不要改动第 5 阶段业务代码，不要重复创建真实注册表夹具或重新部署。若继续后续开发，从原计划第一个未勾选阶段——第 6 阶段“消息推送”开始。
```

---

# 第 6 阶段独立提示词：消息推送（已完成备注）

## 状态备注

**本阶段已完成并正式归档，不要重新实现。** 已完成真实 `show-message` 三层链路：服务端生成五分钟过期时间，Agent 向活动控制台/RDP 会话投递 WTS 原生消息，面板提供批量目标、状态恢复和严格结果展示。

已存在的实现：
- 面板提供标题/正文 Unicode 标量计数、info/warning/error、5–300 秒超时、在线 Windows 受控多选、确认摘要、防重复、轮询恢复和逐客户端 session/响应/超时/耗时。
- 服务端严格拒绝 expiresAt 注入并为同批命令生成相同过期时间；日志不复制 title/message，只记录 severity 和投递摘要。
- Agent 新增 `allowMessagePush:false`、`ActiveUserSessionResolver`、可替换 WTS 接口、控制台优先/RDP 稳定回退、过期/无人登录/Win32 失败和 message intent 不重投。
- 文档与证据位于 `server/README.md`、`server/client/README.md`、`server/artifacts/evidence/stage6-message-push-20260807/`。

已重新核验的完成证据：
- 面板 44/44、服务端 Windows/WSL 均 25/25、Agent 190/190；全部 build 通过。
- 真机命令 `cmd-39a47bfa66bf` 向 session 1 投递一次，响应 32000、`timed-out`、耗时 5046 ms；补充真实确认命令 `cmd-437d34fa2eec` 返回 `confirmed`、`responseCode:1`、`timedOut:false`、耗时 3970 ms；重启后记录仍唯一且没有重投，日志正文脱敏通过。
- Agent 已进一步发布并正式升级到 1.1.7，76,332,641 字节，SHA-256 `1fdc19d16711e75deccccd1bb6e97602091c6bcf434b257dc81ac07df9a4d3e4`；部署默认启用消息推送，既有配置由一次性迁移自动备份并启用，迁移标记保护后续管理员覆盖。
- 正式升级命令 `cmd-da8108ab6183` 为 success/healthy；正式消息 `cmd-bc19db4f49e5` 在“猫羽雫的计算姬”上返回 confirmed、responseCode 1、Session 1、3446 ms，证明生产面板/服务端启动后不再返回 `POLICY_DISABLED`。
- `/clients → 批量操作 → Windows → 消息推送` 已完成 1280×720 与 390×844 真实浏览器验收；两种视口均无页面级横向溢出，控制台无 warning/error，confirmed 结构化结果可见，四张截图与 `browser-verification.json` 已保存。

## 可独立复制的提示词

```text
你正在处理 Windows 管理功能的第 6 阶段“消息推送”。本阶段已经完成并正式归档，禁止重新实现、重构、重复部署或覆盖现有 show-message 链路。

仓库：C:\Users\Administrator\Documents\Codex\Nacho\nacho-main
先读取 AGENTS.md、WINDOWS_REMAINING_WORK_IDE_PROMPT.md、WINDOWS_FEATURE_COMPLETION_PLAN.md，并执行 git status --short，保留全部已有修改、制品和证据。

现有能力包括：严格 Unicode 标量/超时、服务端 expiresAt、Windows 批量目标、日志正文脱敏、活动控制台优先、RDP 回退、WTSSendMessageW、确认/取消/超时结果、Agent 1.1.7 部署默认启用与既有配置一次性迁移、过期/无人会话失败和 intent 不重投。原计划已把第 6 阶段标为 [x]。

本阶段只在最终验收中参加回归；当前不要改动第 6 阶段代码或重复发送真机消息。第 7 阶段也已完成，下一项仅为等待用户确认后的最终三层联调与验收。
```

---

# 第 7 阶段独立提示词：打开网页（已完成备注）

## 状态备注

**本阶段已完成并正式归档，不要重新实现。** 已完成真实 `open-url` 三层链路：服务端生成五分钟过期时间，Agent 在活动 Windows 用户会话中通过默认浏览器启动经过三层严格校验的 HTTP/HTTPS URL；成功只表示已启动浏览器请求，不宣称页面内容已经加载。

已存在的实现：
- 面板提供 2048 字符、绝对 HTTP/HTTPS、userinfo/控制字符校验，在线 Windows 受控多选、确认、防重复、轮询恢复和逐客户端 session/process/PID/耗时/error；空 `urlPresets` 不渲染。
- 服务端使用严格 request/Agent/result schema，同批生成一致 `expiresAt`，拒绝离线与非 Windows 目标；日志只保留规范化 scheme/host 与启动摘要，不记录 path/query/fragment。
- Agent 复用 `ActiveUserSessionResolver`，使用 WTS 用户 token、`DuplicateTokenEx`、用户环境块和 `CreateProcessAsUserW` 启动系统 `explorer.exe`；策略为 `allowOpenUrl:false`、`allowedUrlSchemes:["https"]`、`allowedUrlHosts:[]`，host 做 IDN/大小写/尾点规范化后精确匹配，intent 保证启动后不重放。
- 文档与证据位于 `server/README.md`、`server/client/README.md`、`server/artifacts/evidence/stage7-open-url-20260807/`。

已重新核验的完成证据：
- 面板 47/47、服务端 Windows/WSL 均 27/27、Agent 200/200；全部 TypeScript、Next、服务端和 Agent build 通过，Agent 为 0 warning / 0 error。
- 真机命令 `cmd-551d41020404` 为 success：Session 1、`processStarted:true`、PID 30440、40 ms；本机 fixture 导航只发生一次，Edge 页面可见，Agent 重启后未重放，审计 query/fragment 脱敏通过。
- 最终 Agent 1.1.10 为 76,353,123 字节，SHA-256 `c2f668946b98119c453cfcc6a1b02a486cd9ee2c0a2f5d9aa0cdb5be09f31746`；升级 `cmd-1b980002fecb` success/healthy。最终策略探针 `cmd-bf9fe9007a88` 返回 `POLICY_DISABLED`，证明正式安装态保持默认关闭。
- 1280×720 与 390×844 无页面级横向溢出，控制台无 warning/error；fixture、测试页、HTTP 端口、canary 源码/制品和临时脚本已清理，Edge 原页面会话已恢复，服务最终 Running/active/HTTP 200。

## 可独立复制的提示词

```text
你正在处理 Windows 管理功能的第 7 阶段“打开网页”。本阶段已经完成并正式归档，禁止重新实现、重构、重复部署或覆盖现有 open-url 链路。

仓库：C:\Users\Administrator\Documents\Codex\Nacho\nacho-main
先读取 AGENTS.md、WINDOWS_REMAINING_WORK_IDE_PROMPT.md、WINDOWS_FEATURE_COMPLETION_PLAN.md，并执行 git status --short，保留全部已有修改、正式制品、阶段证据和 tmp/repo-encoding-audit。

现有能力包括：严格绝对 HTTP/HTTPS URL、服务端五分钟 expiresAt、Windows 在线批量目标、scheme/host 审计脱敏、ActiveUserSessionResolver、WTS 用户 token、CreateProcessAsUserW、explorer.exe 独立 URL 参数、默认关闭策略、IDN/大小写/尾点精确 host 允许列表、结构化启动结果、刷新恢复和 intent 不重放。原计划已把第 7 阶段标为 [x]。

本阶段只在最终统一验收中参加回归；当前不要改动第 7 阶段代码、重复打开真机页面或重复部署。下一项是“最终三层联调与验收”，必须等待用户明确回应后再开始。
```

---
# 最终三层联调与验收独立提示词（尚未实施）

## 状态备注

**最终验收尚未实施。必须等原计划第 1～7 阶段全部标为 `[x]` 后再执行。** 本阶段以验证、部署、恢复和形成最终证据为主；发现缺陷时做最小修复并完整重验，不顺手增加新功能。

## 可独立复制的提示词

```text
你正在执行 Windows 七项管理功能的最终三层联调与验收。只有当 WINDOWS_FEATURE_COMPLETION_PLAN.md 的第 1～7 阶段全部为 [x] 时才开始；若仍有未勾选阶段，停止并回到第一个未完成阶段。

仓库：C:\Users\Administrator\Documents\Codex\Nacho\nacho-main
先读取 AGENTS.md、WINDOWS_REMAINING_WORK_IDE_PROMPT.md、WINDOWS_FEATURE_COMPLETION_PLAN.md、全部相关 README/契约和测试，执行 git status --short、git ls-files。保留全部已有修改、制品、证据和运行数据；不得 reset/clean/stage/commit/push。

【验收前记录】
1. 记录面板 dev 服务、WSL control-server.service、Windows NachoAgent 的测试前状态。
2. 记录但不输出任何凭据正文；备份 /opt/control-server 运行副本、Agent 程序/配置/状态和需要修改的本机策略。
3. 所有测试夹具使用唯一 ID 和专用目录/键/账户/组；建立逐项清理清单。

【面板全量】
在仓库根目录运行并记录字面命令、退出码和通过数量：
pnpm exec tsx --test tests/*.test.ts
pnpm exec tsc --noEmit
pnpm build

如果根 .next/dev 正被当前 dev 服务使用，在独立副本完成生产构建，不破坏运行中的 dev 状态。浏览器访问 /clients 及 Windows 批量操作页，逐项检查七张卡片、加载、空数据、错误、重试、防重复、离线和刷新恢复；检查桌面与 390x844；控制台不得有 React、network 或 hydration 错误。

【服务端全量与部署】
1. 在 WSL /tmp 内创建隔离源码副本，只复制 package*.json、tsconfig.json 和 src；确认绝对路径位于 /tmp 后执行：
   npm ci --no-audit --no-fund
   npm test
   npm run build
2. 验证所有 SQLite 增量建表在旧库和重复启动时成功。
3. 备份 /opt/control-server，保留部署侧 .env、SQLite、systemd 配置和数据；同步已经通过测试的源码/构建，重启 control-server.service。
4. 必须核对 systemctl is-active control-server.service 输出 active，curl http://localhost:8443/health 返回 HTTP 200，并对七项所需 Panel/Agent API 做最小真实性检查。
5. 部署失败时立即恢复备份并再次核对 active 与 HTTP 200。不得把 .env、API key、device token 写入报告。

【Agent 全量、发布与升级】
运行并记录命令、退出码、测试数量和 warning/error：
dotnet test C:\Users\Administrator\Documents\Codex\Nacho\nacho-main\server\client\tests\Nacho.Agent.Tests\Nacho.Agent.Tests.csproj
dotnet build C:\Users\Administrator\Documents\Codex\Nacho\nacho-main\server\client\src\Nacho.Agent\Nacho.Agent.csproj -c Release
powershell -ExecutionPolicy Bypass -File C:\Users\Administrator\Documents\Codex\Nacho\nacho-main\server\client\deploy\publish.ps1

发布后重新读取 latest.json，校验发布文件存在、字节数和 SHA-256 完全一致。备份已安装 Agent 程序、配置和测试前服务状态；使用现有 update-agent 专用链路升级测试 Agent，验证身份、设备 token、配置、journal 和策略保留。

【七项最小真实链路】
1. 命令执行：只读 CMD 与 PowerShell 各一次，核对 stdout、exitCode 和终态。
2. 批量安装：一次性 EXE fixture；MSI 至少覆盖固定参数/退出码集成分支；核对哈希、退出码、重启标记和清理。
3. 文件下发：新建、replace、backup、rollback，核对前后内容与 SHA-256。
4. 用户管理：一次性用户/组的 list、disable、enable、add、remove、delete。
5. 注册表：唯一 HKLM TestFixtures 键的 list/get/set/delete/rollback。
6. 消息推送：当前活动会话投递一次明确测试消息并确认。
7. 打开网页：本机临时 HTTP fixture，在活动会话启动一次并人工确认页面。

每项都核对面板 -> Panel API -> SQLite 命令 -> WebSocket/HTTP -> Agent journal/ACK/执行/上报 -> 面板终态的真实链路。单独验证 WebSocket 正常投递、断开实时通道后的 HTTP 轮询回退、结果上报重试、Agent 重启恢复和服务端重启恢复。不得用本地 state 或定时器替代服务端状态。

【安全边界与回归】
1. 验证 payload/result 严格字段、未知字段失败、512 KiB 总结果上限及注册表单值 64 KiB 上限。
2. 验证制品下载绑定设备 token、客户端、commandId、deployment_item 和 ready artifact。
3. 验证日志与最终报告不含 token、配置正文、脚本正文、stdout/stderr 正文、文件正文、注册表值、用户名列表、消息正文或 URL query/fragment。
4. 原有 manage-service、terminate-process、restart-system、collect-logs 只做自动化回归，不重写。
5. 单台批量失败不得掩盖其他客户端状态；所有写操作必须有确认、结构化结果和错误展示。

【恢复与清理】
逐项删除安装 marker/暂存包、文件目标/备份/intent、一次性账户/组、注册表测试键、消息/网页 intent、临时 HTTP 服务、临时制品、隔离数据库和浏览器测试页。恢复 Agent 策略、配置、服务状态及原有 Panel/WSL/Agent 运行状态。对每个角色重新打开或查询确认恢复成功。只清理本次唯一夹具，保留 tmp/repo-encoding-audit 和用户原有文件。

【最终记录】
在 WINDOWS_FEATURE_COMPLETION_PLAN.md 追加每条实际命令、退出状态、测试数量、发布版本/字节数/SHA-256、部署备份、服务 active、健康 HTTP 200、七项真实链路证据和逐项恢复结果。所有事实必须来自本次亲自执行。

全部验收与恢复成功后勾选“最终三层联调与验收”，追加：
已完成最终三层联调与验收。
Windows 七项管理功能补全计划全部完成。

最终回复列出改动文件、七项行为、三层测试、真实链路、部署健康、发布哈希和恢复结果；不得声称未亲自验证的内容。
```

---

## 三、阶段交接记录模板

每个接手 AI 完成其阶段后，在 `WINDOWS_FEATURE_COMPLETION_PLAN.md` 末尾追加以下结构，并填入亲自验证的真实值：

```markdown
## YYYY-MM-DD 第 N 阶段完成记录

- 状态：已完成第 N 阶段：<名称>。
- 面板改动：<文件与真实行为>
- 服务端改动：<文件、路由、schema、数据库与日志>
- Agent 改动：<文件、策略、执行器、journal/intent 与恢复>
- 文档改动：<文件>
- 面板验证：<命令、退出码、通过数量、build 结果>
- 服务端验证：<命令、退出码、通过数量、build/health 结果>
- Agent 验证：<命令、退出码、通过数量、warning/error>
- 真实链路：<命令 ID、终态、关键结构化字段>
- 浏览器：<页面、视口、控制台与溢出结果>
- 恢复：<策略、服务、配置、夹具和临时文件逐项结果>
- 工作区保护：<git status 摘要；确认未 reset/clean/stage/commit/push>

已完成第 N 阶段：<名称>。
下一个阶段开始完成第 N+1 阶段：<名称>。
```

最终阶段使用原计划规定的最终完成标记，不再填写“下一个阶段”。
