# 当前待办

> 本文件是唯一当前待办来源。以下「未完成功能待办」为 2026-11-11 基于当前源码的只读复核结果；历史发布记录已剥离至 `PROJECT_RELEASE_HISTORY.md`。完成一项后勾选并更新对应条目。

## 未完成功能待办（2026-11-11）

**复核统计**：共 18 个条目（文档编号无 TODO-04），已完成 2 项（TODO-01、TODO-08），未完成 16 项。未完成项中，TODO-02、TODO-03、TODO-06、TODO-11、TODO-12 为部分完成；TODO-03 前置是 TODO-03 的门禁。本次复核仅做只读核查，未修改代码、未执行测试或打包、未发布、未提交或推送。

**统计口径**：面板界面 + 服务端 API + Agent 执行三层端到端可用。仅界面存在、后端未闭环的也计入。开发者预览模式为有意设计，不计入待办。

**优先级**：P0 = 界面已承诺但后端未兑现，优先处理；P1 = 已明示的演示边界或平台缺口；P2 = 清理项。

**通用完成标准**：涉及命令契约时同步修改 Agent `Models.cs` / `CommandProcessor.cs`、服务端 `src/schemas/commands.ts` 与面板解析器；按各仓 `AGENTS.md` 第 7 节执行分层测试与 Windows EXE 打包。

### P0

- [x] **TODO-01 计划任务自动调度**
  - 现状（已完成，2026-11-05；2026-11-11 复核通过）：服务端新增周期调度器，按任务 IANA 时区自动触发 `daily` / `weekly` / `cron`；任务记录返回 `nextRunAt`、`lastRunAt`、`lastStatus`、`lastError`，面板表单增加时区并显示下次/最近执行时间。启停、任务编辑会重算或清空排期；服务重启只补一次错过排期并恢复未完成运行；`task_runs(task_id, scheduled_for)` 与命令 `run_id` 唯一约束防重复投递；下发异常指数退避重试 3 次。
  - 已完成子项：`daily` / `weekly` / `cron` 周期调度；IANA 时区；`nextRunAt` / `lastRunAt` / `lastStatus` / `lastError`；启停与编辑重算；重启恢复；唯一约束与重试。
  - 未完成/残余子项：`logon` / `startup` / `boot` 事件触发及 Agent 侧事件上报。
  - 证据：`nacho-server/src/lib/schedule.ts`、`nacho-server/src/services/task-scheduler.ts`、`nacho-server/src/services/tasks.ts`、`nacho-server/src/db/index.ts`、`nacho-panel/components/tasks/tasks-view.tsx`、`nacho-panel/lib/task-schedule-format.ts`。
  - 验证（2026-11-05 当次记录）：服务端/Agent 已迭代到 1.1.25、面板到 0.3.22。服务端 118 项测试与 `npm run build` 通过，Agent Release 构建通过（Agent 测试受当前终端 testhost 父进程句柄拒绝访问的环境限制未完成）；面板 336 项测试、`tsc --noEmit`、`pnpm build` 通过；桌面 60 项测试与 `pnpm build` 通过，生成 `desktop/dist/NachoPanel/NachoPanel-Setup-0.3.22.exe`（SHA-256 `ec0e95149b6ba1ce821eea3a0fa093fec8edd18d6115dc156c1f2afce939c33f`）；真实浏览器与 `390x844` 视口验证任务卡片、时区字段、下次/最近执行与滚动。2026-11-11 复核未重新执行测试或打包，功能代码与残余限制均未变化。
  - 残余限制：`logon` / `startup` / `boot` 属于客户端事件，当前保留配置且界面明确标注“服务端不排期”，需 Agent 侧事件上报或本机计划任务后才能闭环。

- [x] **TODO-13 面板统一管理更新源（0.4.1 / 1.2.1）【加急】**
  - 完成记录（2026-11-12）：Step 0–8 全部完成；面板 0.4.1 Beta 与服务端/Agent 1.2.1 Beta 已发布（签名索引 sequence 19），`10.11.32.200` 已升级并保留既有数据，Windows Agent 已安装 1.2.1 并在线。发布与真机证据见 Step 7/8。
  - 现状基线（2026-11-12）：面板 `0.4.0 Beta`（提交 `b3205433f7f92936ba3004a7dd41e769cbf0994b`）、服务端与 Agent `1.2.0 Beta`（提交 `b608fc80d945ebb7b58880489b35b373a4445600`）已发布；签名索引为 `sequence 18`，包含面板 0.4.0、服务端/Agent 1.2.0。新安装的 `deploy/install.sh` 已会把 `NACHO_UPDATE_ORIGIN` 写入 `.env`，但**面板没有写服务端更新源的 API**；既有 1.1.24 服务端只读 `.env`，所以面板能看到索引 #18，服务端卡片仍提示“控制服务尚未配置更新源”，Agent 制品按钮被禁用。
  - 产品目标：**面板是唯一管理入口，服务端是持久化与验签主体**。面板关闭时服务端仍能使用最后一次持久化的更新源完成索引校验、Agent 制品准备和服务端升级检查；`.env` 只保留为首次安装、无面板或 headless 部署的 bootstrap 回退，不再是唯一来源。
  - 版本与门禁：服务端与 Agent 统一 `1.2.1`，面板 `0.4.1`；服务端 `deploy/compatibility.json` 增加 `features.updateSourceManagement: "0.4.1"`；旧面板/旧服务端必须安全降级，不能把“面板本地已保存”误报成“服务端已配置”。
  - 当前代码锚点：`nacho-server/src/services/settings.ts`、`nacho-server/src/services/release-index.ts`、`nacho-server/src/services/product-updates.ts`、`nacho-server/src/services/agent-release-sync.ts`、`nacho-server/src/routes/panel.ts`、`nacho-server/deploy/compatibility.json`、`nacho-server/deploy/install.sh`、`nacho-main/nacho-panel/components/settings/updates-panel.tsx`、`nacho-main/nacho-panel/lib/product-update-status.ts`、`nacho-main/nacho-panel/lib/cloud-deployment.ts`、`nacho-main/nacho-panel/app/api/cloud-deployment/route.ts`、`nacho-main/desktop/src/main.cjs`、`nacho-main/desktop/src/updates.cjs`。
  - 全局约束：
    - 不允许把更新源只存在面板 localStorage 或桌面 `update-origin.txt`；服务端必须持久化。
    - 不允许面板通过 SSH 直接改服务端 `.env`；统一走认证 API。
    - 不允许绕过索引 Ed25519 验签、固定 GitHub 制品地址、大小与 SHA-256 校验。
    - 不允许把 `PANEL_API_KEY`、`ENROLLMENT_KEY`、SSH 密码或 `.env` 全文写入日志、聊天或代码。
    - 不允许让服务端在面板离线时失去更新检查能力；必须使用最后持久化的有效 origin。
    - 本待办只记录计划，未开始改代码；实施前先按本条目核对当前源码和 `git status`。

  - [x] **Step 0【加急】现有 1.1.24 一次性迁移**
    - 完成记录（2026-11-12）：已用 1.2.0（固定提交 `b608fc80d945ebb7b58880489b35b373a4445600`）的 `deploy/install.sh` 在 `10.11.32.200` 原地重装，保留 `.env`、SQLite 与既有凭据，并补充 `NACHO_UPDATE_ORIGIN=https://maojiu.cc`。安装前备份位于 `/root/nacho-step0-backup-20261112-042557/`（`.env`、`control.db` 一致性快照、systemd 单元）。核对：`control-server` active、`/health` 正常、安装版本 1.2.0、`runtime-info.updateSourceConfigured=true`；`.env` 去除新增行后 SHA-256 与备份完全一致（`08e86d15…63f0`），权限仍为 `640 root:control`；数据库保留 1 个客户端与 2 条命令。1.2.0 尚无 `updateSource`/`updateSourceManagement` 字段，待 1.2.1 提供。
    - 目标：让当前 `10.11.32.200` 的 1.1.24 先具备可用的更新源，并具备后续升级到 1.2.1 的条件。
    - 事实：1.1.24 没有 `updates` 设置分组、没有面板管理 API，新面板无法直接修它；这是鸡生蛋问题，必须一次性迁移。
    - 推荐路径：在 `10.11.32.200` 上用 1.2.0/1.2.1 的 `deploy/install.sh` 重新安装，保留 `.env`、SQLite、Agent 数据和既有凭据；安装时传入 `NACHO_UPDATE_ORIGIN=https://maojiu.cc`。安装前备份 `/opt/control-server/.env` 与数据库，安装后核对 `systemctl is-active control-server`、`/health`、`runtime-info.updateSourceConfigured=true`。
    - 临时止血：若暂不迁移，备份 `.env` 后追加/修正 `NACHO_UPDATE_ORIGIN=https://maojiu.cc`，保持原 `root:control 640` 权限，重启 `control-server`，再在面板“设置 → 更新”点“检查更新”；Agent 制品按钮应启用。
    - 验收：服务端 `runtime-info` 返回 `updateSourceConfigured=true`；面板服务端卡片不再显示“未配置更新源”；Agent“准备新版制品”可点击；`.env` 其他字段和凭据未被改写；备份可回滚。
    - 已知限制：当前会话用 `C:\Users\Administrator\Downloads\id_ed25519` 登录 `root@10.11.32.200` 被拒（`Permission denied`）；新会话需用户提供可用 SSH 密钥/授权，或由用户在该机手工执行。不要把密码写入仓库或聊天。

  - [x] **Step 1【加急】服务端设置持久化 `updates.origin`**
    - 完成记录（2026-11-12）：`settings.ts` 新增 `updates` 分组与 `UpdateSettings`，默认值读取 `config.updateOrigin`（`NACHO_UPDATE_ORIGIN`），新增 `normalizeUpdateOrigin()`、`storedUpdateOrigin()`、`resolveUpdateOrigin()`；仅接受规范化 HTTPS 源，拒绝 `http://`、路径、查询、凭据、控制字符、占位值与非法端口，空字符串表示未配置。`PUT /api/panel/settings` 按分组浅合并，非法值返回 400 且不覆盖旧值；审计日志只额外记录 origin。新增 `src/tests/settings-updates.test.ts` 覆盖默认值、env 回退、面板优先、尾斜杠、空值、非法值、未知字段、并发保存、缓存重载与日志脱敏；设置相关 14 项测试通过，`npm run build` 通过。runtime-info 的即时反射在 Step 2 的动态读取中完成并验证。
    - 改 `nacho-server/src/services/settings.ts`：新增 `updates` 分组与 `UpdateSettings = { origin: string }`；`origin` 允许空字符串表示未配置；默认值从 `config.updateOrigin`（`NACHO_UPDATE_ORIGIN`）读取；加入 `defaultSettings()`、`AppSettings`、`sectionSchemas`、`getEffectiveSettings()`、`mergeSettings()`；未知字段继续保留以兼容前后端版本差。
    - 校验：只接受 `^https://[a-z0-9.-]+(:[0-9]+)?$`；统一去掉尾部 `/`；拒绝 `http://`、路径、查询、凭据、控制字符、空 host 和占位值 `https://updates.example.invalid`；非法值返回 400，不覆盖旧值。
    - API：复用 `PUT /api/panel/settings`，请求体示例 `{ "updates": { "origin": "https://maojiu.cc" } }`；成功后 `runtime-info` 立即反映；审计日志只记录分组名与 origin（origin 非密钥），不得记录其他设置值或凭据。
    - 读取语义：`settings.updates.origin` 非空优先；否则回退 `NACHO_UPDATE_ORIGIN`；两者都无效视为未配置。服务端重启后设置仍保留。
    - 测试：新增/扩展 `src/tests/settings*.test.ts` 覆盖默认值、env 回退、settings 优先、非法 origin、尾斜杠、空值、未知字段保留、并发保存和重启读取。

  - [x] **Step 2【加急】服务端运行时读取与索引缓存隔离**
    - 完成记录（2026-11-12）：`release-index.ts` 删除模块级 `UPDATE_ORIGIN`/`RELEASE_INDEX_URL`，新增 `resolveUpdateOrigin()`（设置优先、env 回退、严格校验），未配置时抛出明确错误且不请求占位地址；内存与磁盘缓存均记录 origin，跨 origin 不复用，新增 `invalidateReleaseIndexCache()` 并在 `PUT /settings` 保存 `updates` 时调用，代次计数阻止在途旧请求写回缓存。`product-updates.ts` 的 `runtimeInfo()` 新增 `updateSource`、`updateSourceOrigin`（`panel`/`env`/`none`）、`updateSourceConfigured` 与 `capabilities.updateSourceManagement`；`compatibility.json` 增加 `updateSourceManagement: "0.4.1"`。新增 `release-index-origin.test.ts`、`release-index-unconfigured.test.ts` 并重写 `release-index.test.ts`，覆盖设置优先、env 回退、未配置报错、origin 变化清缓存、跨 origin 缓存隔离、在途失效与签名校验；服务端 159 项测试全部通过，`npm run build` 通过。
    - 改 `nacho-server/src/services/release-index.ts`：删除模块级常量 `UPDATE_ORIGIN`/`RELEASE_INDEX_URL`，改为 `resolveUpdateOrigin(): string | null`（settings 优先、env 回退、严格校验）；`indexUrl(sequence?)`、`getReleaseIndex()` 全部通过它取地址；未配置时抛出明确错误，不请求占位地址。
    - 缓存：内存缓存与磁盘 `release-index-cache-recommended.json` 增加 origin 字段；origin 不一致时忽略旧缓存；新增 `invalidateReleaseIndexCache()`，面板保存新 origin 后清空内存缓存和磁盘缓存，避免把旧 origin 的索引当成新 origin 的结果。
    - 改 `nacho-server/src/services/product-updates.ts`：`runtimeInfo()` 增加 `updateSourceConfigured`、`updateSource`（当前 origin 或 null）、`updateSourceOrigin`（`panel` / `env` / `none`）和 `capabilities.updateSourceManagement`；`availableUpdates()`、`requestServerUpdate()` 使用动态 origin。
    - 改 `nacho-server/deploy/compatibility.json`：增加 `updateSourceManagement: "0.4.1"`；旧面板不发送设置更新，旧服务端不返回该能力。
    - 测试：`src/tests/recommended-updates.test.ts` 覆盖 settings 优先、env 回退、未配置报错、origin 变化清缓存、跨 origin 缓存不复用、签名校验仍生效。

  - [x] **Step 3【加急】面板统一编辑入口与状态展示**
    - 完成记录（2026-11-12）：新增 `lib/update-origin.ts` 统一保存流程：先写面板本地（桌面桥 `setOrigin` + localStorage），服务端支持时再 `PUT /api/panel/settings` 写入 `updates.origin`，随后 `GET /api/panel/product-updates` 验证；服务端写入失败自动恢复面板本地，验证失败保留新值并返回警告。`updates-panel.tsx` 的更新服务器弹窗同时展示面板本地与服务端更新源，支持能力门槛降级提示、保存失败错误与“恢复上一个更新源”，概览卡增加两处来源 Meta。`product-update-status.ts` 新增 `updateSourceState`（`panel-local`/`server-env`/`server-panel`/`unsupported`/`disconnected`）与真实来源文案，Agent 制品按钮继续以服务端 `updateSourceConfigured` 为准。新增 `tests/update-origin.test.ts` 并扩展 `product-update-status.test.ts`，覆盖双写、降级、失败回滚、验证失败与状态展示；面板 364 项测试、`tsc --noEmit`、`pnpm build` 通过。浏览器与 `390x844` 视口验收在 Step 7 统一执行。
    - 改 `nacho-main/nacho-panel/components/settings/updates-panel.tsx`：保留现有“更新源”弹窗；保存时同时执行：
      1. `window.nachoUpdates.setOrigin(origin)` 更新面板本地（`update-origin.txt`）；
      2. 调用 `PUT /api/panel/settings` 写入 `updates.origin` 更新服务端。
    - 加载时分别读取并显示“面板本地更新源”和“服务端更新源”；服务端 `runtime-info` 的 `updateSource`/`updateSourceOrigin` 决定文案，禁止再用面板本地 origin 推断服务端已配置。
    - 能力门槛：若 `runtime-info` 没有 `capabilities.updateSourceManagement`（1.2.0 及更早），只保存面板本地，并明确显示“服务端 1.2.1 起支持面板管理更新源，请先升级服务端”；不得静默丢弃服务端同步失败。
    - 保存后调用一次 `GET /api/panel/product-updates` 验证新 origin；失败时提示错误、保留“恢复上一个更新源”操作，不把失败状态写成成功。
    - 改 `nacho-main/nacho-panel/lib/product-update-status.ts` 的类型与状态：Agent 制品按钮继续使用服务端 `updateSourceConfigured`；新增 UI 状态区分 `panel-local` / `server-env` / `server-panel` / `unsupported`。
    - 测试：面板纯逻辑测试覆盖保存双写、服务端不支持降级、保存失败回滚、origin 展示、`updateSourceConfigured` 门禁；不得把真实密钥写入测试夹具。

  - [x] **Step 4【加急】新安装与云端部署写入服务端设置**
    - 完成记录（2026-11-12）：`cloud-deployment.ts` 新增 `persistCloudUpdateOrigin()`：安装完成、健康检查通过并读取 `PANEL_API_KEY` 后，在现有 SSH 会话内调用服务端本机 `127.0.0.1:8443` 的 `runtime-info` 检查 `updateSourceManagement`，再 `PUT /api/panel/settings` 写入 `updates.origin`；密钥只经 SSH stdin 传递，不进入命令 argv 或日志，响应只解析状态与 origin。能力缺失时跳过写入并提示升级；写入失败不回滚安装，返回“服务端更新源未持久化”警告并写入部署日志。`cloud-deploy-form.tsx` 完成页新增更新源未持久化与 Agent 制品未准备提示。`route.ts` 已确认只从面板进程环境读取 `NACHO_UPDATE_ORIGIN` 并复用严格校验，无需功能改动。`cloud-deployment.test.ts` 19 项通过，覆盖成功写入、能力缺失、写入失败不阻断、密钥不出现在命令中、Agent 准备顺序与日志；`tsc --noEmit` 通过。
    - 改 `nacho-main/nacho-panel/lib/cloud-deployment.ts` 与 `app/api/cloud-deployment/route.ts`：安装时继续把 `NACHO_UPDATE_ORIGIN` 传给 `install.sh` 作为 bootstrap；健康检查通过并读取 `PANEL_API_KEY` 后，调用 `PUT /api/panel/settings` 将 origin 持久化到服务端设置，再执行 Agent 制品准备。
    - 只从面板服务进程环境（或已验证的部署上下文）取 origin，不从客户端请求体任意接收；origin 仍走严格 HTTPS 校验与 shell 转义。
    - 失败处理：设置写入失败不回滚已安装服务端，但必须在部署日志/完成页明确提示“服务端更新源未持久化”，并保留手动设置入口；不得静默成功。
    - 测试：扩展 `tests/cloud-deployment.test.ts` 覆盖设置写入、能力缺失、写入失败不阻断、Agent 准备顺序和日志；真实云端安装由用户提供目标机后验收。

  - [x] **Step 5【加急】修复 0.4.0 的 Agent 制品自动准备缺陷**
    - 完成记录（2026-11-12）：`prepareCloudAgentArtifact` 改为在现有 SSH 会话内调用服务端本机 `http://127.0.0.1:8443`：准备请求使用 `curl --max-time 1200`（避免 undici 5 分钟 headersTimeout），并带 `X-Nacho-Panel-Version`；`PANEL_API_KEY` 只通过 SSH stdin 以 `Authorization: Bearer …` 传给 `curl -H @-`，不进入 argv 或部署日志；准备成功后再经本机 `runtime-info` 与公开 `latest.json` 校验版本。`deployCloudServer` 不再以公网 8443 可达为前提，探测失败时仍会准备制品；失败只警告、不回滚安装。`cloud-deployment.test.ts` 19 项通过，覆盖本机命令包含 `--max-time`/`127.0.0.1`/`X-Nacho-Panel-Version`、密钥只经 stdin 且不出现在命令与日志、失败不抛错、公网端口不可达仍准备成功；`tsc --noEmit` 通过。真实制品下载与 `latest.json` 200 验证在 Step 7 执行。
    - 改 `prepareCloudAgentArtifact`：不再使用全局 `fetch` 等待 20 分钟；改为在现有 SSH 会话内对服务端本机 `http://127.0.0.1:8443/api/panel/product-updates/agent-artifact` 发起请求，优先 `curl --max-time 1200`，或使用 `node:http` 显式设置 20 分钟 socket 超时；不得依赖公网 8443 可达。
    - `PANEL_API_KEY` 从远端 `.env` 读取，不得进入命令行 argv、日志或面板日志；通过 stdin/`curl -H @-` 或 600 权限临时文件传 header，并在 finally 清理。
    - 请求必须带 `X-Nacho-Panel-Version`；准备成功后用远端 `GET /agent/downloads/windows/latest.json` 校验版本；失败只警告、不回滚安装、保留面板“准备新版制品”手动兜底。
    - 测试：覆盖 SSH 本机命令包含 `--max-time`/`127.0.0.1`/`X-Nacho-Panel-Version`、密钥不出现在命令与日志、失败不抛错、公网端口不可达仍可准备。

  - [x] **Step 6【加急】兼容、迁移与降级路径**
    - 完成记录（2026-11-12）：版本矩阵已落实到代码与文档：1.1.24 无设置分组与管理 API，面板按 `unsupported` 只保存本地并在弹窗提示“1.1.24 需按部署文档一次性迁移”；1.2.0 无 `updateSourceManagement`，同样降级并提示升级；1.2.1+ 面板写 `updates.origin`，设置优先于 `.env`，`.env` 仅作 bootstrap/headless 回退。面板同时展示面板本地与服务端来源，保存默认双写，失败恢复上一值。`nacho-server/README.md` 新增“更新源管理与一次性迁移”章节、`NACHO_UPDATE_ORIGIN` 环境变量说明与 runtime-info 新字段；`nacho-main/ARCHITECTURE.md` 更新云端部署流程与跨仓更新源约定。新增 `install.sh` 迁移安全测试，确认不会删除数据目录、SQLite、`.env` 或已有 Agent 制品；部署脚本 19 项、面板更新源 11 项测试通过。迁移不覆盖既有数据的实证见 Step 0（`.env` 原内容 SHA-256 一致、数据库保留）。
    - 三个版本矩阵必须明确：
      - 1.1.24：没有 settings/API，只能按 Step 0 手工迁移；面板不得声称可管理。
      - 1.2.0：有更新源 env，但没有 `updateSourceManagement`；面板只保存本地并提示升级。
      - 1.2.1+：面板可写 `updates.origin`；设置优先于 env；`.env` 继续作为 headless/bootstrap 回退。
    - 面板本地 origin 与服务端 origin 短暂不一致时，UI 必须分别展示；保存默认同步，失败可恢复上一值。
    - 迁移不得覆盖现有 `.env`、SQLite、Agent token、journal、已下发命令的旧制品；升级/回滚遵循各仓 AGENTS 的备份、重启、健康验证、失败回滚流程。
    - 文档：更新 `nacho-server/README.md`、`nacho-main/ARCHITECTURE.md` 或相关运维说明，写清“面板管理、服务端持久化、env 仅 bootstrap”的语义和 1.1.24 一次性迁移步骤。

  - [x] **Step 7【加急】分层测试与真机验收**
    - 完成记录（2026-11-12）：服务端 `npm test` 160 项、`npm run build` 通过；面板 364 项、`tsc --noEmit`、`pnpm build` 通过；桌面 60 项、`pnpm build` 生成 `NachoPanel-Setup-0.4.1.exe`（223,431,146 字节，SHA-256 `96017b32fa9eb51f10da842bc58b45675dd7ac851050c6107573d4ed183fff2f`）；`bash deploy/tests/napl-fixture.sh` 通过，`install.sh`/`napl`/`uninstall.sh` 保持 LF。Agent `dotnet test` 仍被宿主沙箱拦截（testhost `UnauthorizedAccessException`），改用同一测试程序集的反射 runner：235 项通过，1 项 `PackageInstallManagerTests.Real_runner_preserves_argument_boundaries_and_kills_timeout_process_tree` 因沙箱子进程无法写入临时路径失败，`dotnet build -c Release` 通过。真机 `10.11.32.200` 升级到 1.2.1；面板保存 origin 后 `runtime-info` 立即变为 `panel`，非法 HTTP origin 返回 400 且不改旧值，空字符串回退 `env`，重启后仍为 `panel` 且设置行保留；索引缓存带 `origin`，保存后磁盘缓存被清空并在重新获取时重建；签名索引 sequence 18→19 读取正常。通过服务端本机 `curl --max-time 1200` 准备 Agent 1.2.1 制品成功（76,545,633 字节，SHA-256 与 GitHub 一致），`GET /agent/downloads/windows/latest.json` 返回 200。Windows 本机执行 `nacho.ps1` 安装/升级 Agent：旧 exe 被残留进程占用，重命名后安装成功；服务 Running、版本 1.2.1，服务端显示 online。真实 Chrome 390×844 视口：`scrollWidth=390` 无横向溢出，更新页与弹窗均显示面板本地/服务端两个来源；截图在 `%TEMP%/nacho-390x844.png` 与 `%TEMP%/nacho-390x844-modal.png`。安全验收：非法 origin/HTTP/路径/占位值/无效端口均拒绝，密钥未出现在命令、stdin 回显、日志或面板输出，索引 Ed25519 验签通过。
    - 服务端：`npm test && npm run build`；覆盖 settings、runtime-info、索引缓存、Agent 同步、非法 origin、重启持久化。
    - 面板：`pnpm exec tsx --test tests/*.test.ts`、`pnpm exec tsc --noEmit`、`pnpm build`；桌面 `pnpm test && pnpm build`，核对 `desktop/dist/NachoPanel/NachoPanel-Setup-0.4.1.exe` 重新生成。
    - 部署脚本：`bash deploy/tests/napl-fixture.sh`；`install.sh` 保持 LF；若修改 `install.sh`，按 AGENTS 核对 `cloud-deployment.ts` 的部署输入。
    - Agent：`dotnet test`（若本机 testhost 仍被宿主沙箱拦截，使用同一测试程序集的反射 runner，并在报告记录）；`dotnet build -c Release`。
    - 真机验收：面板修改 origin → 服务端 `runtime-info` 立即变化 → 重启服务端设置仍在 → Agent“准备新版制品”成功 → `GET /agent/downloads/windows/latest.json` 返回 200；从 Windows 机器执行 `irm .../nacho.ps1 | iex` 安装成功。
    - 安全验收：非法 origin、HTTP、路径、占位值、注入字符全部拒绝；日志/面板输出不出现 API Key、密码、`.env` 全文；索引 Ed25519 签名仍校验。

  - [x] **Step 8【加急】发布 0.4.1 / 1.2.1**
    - 完成记录（2026-11-12）：版本已递增：面板 0.4.1（desktop manifest，Beta），服务端/Agent 1.2.1（`package.json`、`package-lock.json`、`Nacho.Agent.csproj`），`compatibility.json` 已含 `updateSourceManagement: "0.4.1"`。固定提交：nacho-main `60da79565963a3c932442d0594b1328b05a84e13`，nacho-server `dbfb2bf2181b6287042705289c8cb7aff7b66baa`。GitHub Release 已上传并回读：面板 `NachoPanel-Setup-0.4.1.exe` 223,431,146 字节 SHA-256 `96017b32fa9eb51f10da842bc58b45675dd7ac851050c6107573d4ed183fff2f`；服务端源码 `nacho-server-source-1.2.1.tar.gz` 336,333 字节 SHA-256 `4a1498eea5f452a8bedbb92aaae0db1a694d3ef4ea1aaae5c5dbbcf85969d402`；Agent `nacho-agent-1.2.1-win-x64.exe` 76,545,633 字节 SHA-256 `68fb85e5216c712f49e573c0c87e47a5d4afd271de3e717b5f06268348c49acd`。更新服务器已签署 v4 推荐索引 sequence 19（panel/server 均为 beta）；`https://maojiu.cc/updates/index.json` 重定向到不可变修订地址，`.sig` 使用固定公钥独立验签通过，SSE `/updates/events` 推送 `{"sequence":19}`；索引中的版本、大小与 GitHub 元数据逐项一致。发布后真机已验证：10.11.32.200 为 1.2.1、Agent 1.2.1 online、面板 0.4.1 Beta 可见、签名索引可读取。回滚状态：旧索引 sequence 18 与旧制品保留在 GitHub/更新服务器不可变目录；本次未触发回滚。因本机 testhost 沙箱与发布脚本 SSH 密钥路径限制，使用 `publish-update.ps1` 的底层工具 `upload-github.mjs` 与 `publish-index-ssh.cjs` 完成等价流程，发布脚本本身未改动；Agent 测试结果按 Step 7 的反射 runner 记录。
    - 先确认 0.4.0/1.2.0 的已知自动准备缺陷已按 Step 5 修复，再递增版本：面板 `desktop/package.json` 与 `PANEL_VERSION` 语义为 `0.4.1`，服务端 `package.json`/`package-lock.json`/Agent `Nacho.Agent.csproj` 统一 `1.2.1`，`deploy/compatibility.json` 增加能力门槛。
    - 按 `AI_RELEASE_POLICY.md` 和根 `publish-update.ps1` 执行：全量测试 → 提交并推送固定 SHA → 生成面板 EXE、服务端源码包和 Agent EXE → GitHub Release 回读大小/哈希 → 通过 SSH 只发送发布元数据 → 更新服务器签署 v4 索引并 SSE 通知。
    - 发布后独立核对：签名索引 `.sig` 用固定公钥验签；GitHub API 资产 `size`/`digest` 与索引一致；记录索引序号、两个仓提交 SHA、版本、频道和回滚状态。
    - 升级顺序：先服务端/Agent `1.2.1`，再面板 `0.4.1`；1.1.24 先按 Step 0 迁移；1.2.0 可直接由面板升级（若执行器协议允许），否则按 Step 6 的迁移路径处理。
    - 报告必须区分：源码已修改、构建通过、源码已推送、远端已签名发布、客户端实际可用；未完成真机验证时不得声称用户端已生效。

  - 完成定义：面板可在“设置 → 更新”一处修改更新源，服务端持久化并在重启/面板离线后继续使用；新装自动写入；1.2.1+ 旧实例无需 SSH；1.2.0/1.1.24 有明确降级/迁移提示；Agent 自动准备不再受 undici 5 分钟和公网 8443 限制；全量测试、桌面 EXE、GitHub Release、签名索引和真机安装均有证据。
  - 不在本待办范围：替 1.1.24 直接增加新 API；修改索引签名/公钥；把私钥、PANEL_API_KEY、ENROLLMENT_KEY 或 SSH 密码写入仓库；绕过 512 KiB 结果上限或命令契约。

- [ ] **TODO-02 系统设置持久化与生效（常规 + 通知条件）**
  - 现状（2026-11-11 复核，部分完成）：服务端已有通用 `GET/PUT /api/panel/settings` JSON 存储与读取；面板挂载时只读取 `security.openEnrollment`，保存时也只在免密注册变化时提交该字段。常规设置与通知条件仍只存在前端 state，刷新即还原，服务端不消费。`PUT /settings` 仍是整包替换。
  - 已完成子项：服务端通用设置 JSON 存取；免密注册的持久化与服务端生效；免密注册相关测试。
  - 未完成子项：设置 schema 与默认值；面板整包读取/保存与重启后生效；并发数、命令超时、重试次数、日志保留、离线阈值、时区、自动清理、CPU/内存/磁盘阈值与静默时段的服务端消费；前向兼容未知字段；整包与单字段合并语义；往返、默认值、旧数据与非法值测试。
  - 证据：`nacho-panel/components/settings/settings-view.tsx:62`、`:86`、`nacho-server/src/routes/panel.ts:737`、`nacho-server/src/services/settings.ts:10`、`nacho-server/src/config.ts:41`。
  - 完成标准：服务端定义设置 schema 与默认值，整包保存/读取并前向兼容未知字段；实际消费并发数、命令超时、重试次数、日志保留、离线阈值、时区、自动清理、CPU/内存/磁盘阈值与静默时段；面板挂载时读取、保存后重启仍生效；测试覆盖往返、默认值、旧数据与非法值。
  - 合并语义：`PUT /settings` 当前为整包替换；面板只提交 `security.openEnrollment`，当前尚不会误清空其他字段，但一旦扩展为整包保存必须先定义合并语义并补测试。
  - 注意：SMTP 密码等敏感字段不得写入日志。

- [ ] **TODO-03 前置：HTTPS/TLS 基线与客户端信任策略（阻塞 TODO-03）**
  - 现状事实（2026-11-11 复核，仍未完成）：
    - 服务端只有明文监听，无任何 TLS 配置，HTTPS 只能由反向代理终止；反向代理后生成的下载/安装地址还依赖 `PUBLIC_BASE_URL` 与 `TRUST_PROXY` 才正确。
      `nacho-server/src/index.ts:72`、`nacho-server/src/routes/artifacts.ts:13`
    - Agent 使用默认 `SocketsHttpHandler` 与 `ClientWebSocket`，没有自定义 CA、证书回调或忽略选项；自签名证书、或证书主机名与访问地址（常见为 IP）不匹配时，注册、心跳、取命令与 WS 会全部失败；`serverUrl` 写死在每台机器的 `agent.json`，无法由服务端远程迁移。
      `nacho-server/client/src/Nacho.Agent/AgentApiClient.cs:18`、`:170`、`:180`
    - 面板的部署/管理链路全部硬编码 `http://`（本机健康检查、局域网 Agent 地址、云端部署返回地址）；服务端一旦强制 HTTPS，面板自建的本机实例会立即失联，健康检查、启停、修复、升级全部失效。
      `nacho-panel/lib/local-control-server.ts:305`、`:309`、`nacho-panel/lib/cloud-deployment.ts:471`、`:489`
    - 面板渲染进程直接 fetch/XHR，证书错误被统一吞成“连接服务端失败”，用户无法分辨证书问题；Electron 主进程没有证书错误处理。
      `nacho-panel/components/server-data-context.tsx:139`、`:153`、`nacho-main/desktop/src/main.cjs`（未找到证书错误处理）
    - 桌面端产品更新传输不接受带子路径的服务端地址，反向代理挂在子路径时会直接失败。
      `nacho-main/desktop/src/updates.cjs:363`
  - 已完成子项：无。只有基础 URL 校验允许 `https`，证书信任、错误诊断与迁移策略均未实现。
  - 未完成子项：上述 5 项前置产出全部未完成；部署文档没有 TLS 结论与迁移方案，面板也没有证书类错误文案。
  - 前置完成的定义（以下全部产出后才允许开始 TODO-03）：
    1. 明确结论：HTTPS 采用“反向代理终止 TLS”“服务端内置 TLS”或“明确不支持”，写进本文件与部署文档，UI 文案与结论一致。
    2. 若支持，写清：证书要求（以公共 CA 签发且主机名匹配为基线）、Agent 连接地址必须使用域名而非 IP、私有 CA 与 SPKI 固定的取舍、逐机迁移与回滚顺序、回环地址豁免策略、`PUBLIC_BASE_URL`/`TRUST_PROXY`/`X-Forwarded-Proto` 规范。
    3. 面板增加证书类错误的可诊断文案（自签名、过期、主机名不匹配、证书链缺失），不得继续只报“连接失败”。
    4. 迁移顺序固定为：反向代理同时接受 HTTP/HTTPS → 逐机切换 Agent → 最后强制；重定向仅允许 307/308，`/agent/*` 建议直接返回明确 4xx 而非重定向。
    5. 测试矩阵覆盖：自签名、过期、主机名不匹配、证书链缺失、明文被拒、回环豁免、子路径反向代理。
  - 未完成本前置时：不得实现任何服务端强制 HTTPS 逻辑。

- [ ] **TODO-03 安全策略生效**
  - 前置门禁：必须先完成「TODO-03 前置」；前置未写好、未定稿前，本项任何代码都不允许开始编写。
  - 现状（2026-11-11 复核，部分完成）：免密注册已持久化并在服务端生效；手动锁屏/解锁可用。会话超时仍不会自动锁定，IP 白名单、强制 HTTPS、双因素、面板接入鉴权、登出其他会话均无服务端实现；登录失败锁定仍只是 UI 开关。`sessionTimeout` 未被任何运行代码读取。
  - 已完成子项：免密注册持久化与服务端校验；手动锁屏及重新输入本机登录密钥/密码解锁；锁屏状态持久化。
  - 未完成子项：自动空闲锁定（会话超时）；IP/CIDR 白名单；强制 HTTPS 的“实现或移除”结论；双因素、面板接入鉴权、登出其他会话（Alpha，依赖 ALPHA-01）；登录失败锁定移除；上述实现对应的服务端/桌面端强制逻辑、测试与错误响应。
  - 证据：`nacho-panel/components/settings/security-panel.tsx:202`、`:217`、`:230`、`:234`、`:259`、`:278`、`nacho-panel/components/sidebar.tsx:129`、`nacho-panel/components/onboarding/onboarding-context.tsx:172`、`nacho-server/src/lib/auth.ts:25`。
  - 完成标准：逐项明确“实现”或“移除开关”。实现项需有服务端/桌面端强制逻辑、测试与错误响应；移除项需从 UI 与类型中删除，避免继续误导。其中「强制 HTTPS」默认按“移除开关 + 部署说明”处理，除非前置结论明确选择实现；「登录失败锁定」直接移除。
  - 依赖：TODO-02 的持久化。
  - 免密注册：保持现有默认（本机安装 `ALLOW_OPEN_ENROLLMENT=true`），本次不调整。
  - **子项 1：会话超时（待办，部分完成）**
    - 现状：手动锁屏已实现；无操作计时、自动进入锁屏、设置持久化均未实现。
    - 目标：面板无操作超过设定时长后自动锁定，需重新输入本机凭据。当前无服务端会话体系，先以本机锁屏实现；Alpha 账号体系落地后再评估服务端会话强制。
    - 完成标准：设置持久化并在重启后生效；空闲计时覆盖所有主页面与窗口失焦/恢复；锁屏后需重新输入凭据；测试覆盖计时、操作重置、设置变更与刷新恢复。
  - **子项 2：IP 访问白名单（方案已定，2026-10-30；2026-11-11 复核仍未实现）**
    - 产品形态：单一开关 + 统一 IP/CIDR 名单；「内网 / 外网」只作为录入模板与提示，不构成两套匹配规则。外网模板仅接受单个 IP（支持批量粘贴多条），内网模板接受单个 IP 与网段；两者最终落库为同一份规范化名单。
    - 作用域：默认且仅保护 `/api/panel/*` 管理面；不作用于 `/agent/*`、`/agent/ws` 与制品下载，避免 Agent 批量断连。若后续需要保护 Agent 面，必须另设独立名单并在 UI 明确区分。
    - 匹配规则：支持 IPv4/IPv6 单地址与 CIDR；地址规范化（含 `::ffff:` 映射、去重与合并）；回环地址永远放行；禁止空名单启用；禁止 `0.0.0.0/0`、`::/0`；限制条目数与总覆盖地址数。
    - 防自锁：保存/启用前校验当前请求来源 IP 已在名单内，否则拒绝启用；界面展示服务端看到的当前来源 IP 并支持一键加入；提供环境变量或 `napl` 应急关闭通道，并写入部署文档。
    - 代理联动：仅在 `TRUST_PROXY` 开启且请求来自可信代理时解析 `X-Forwarded-For` 链，取第一个非代理地址；与 DEF-01 共用同一套 IP 解析实现。
    - 拒绝诊断：403 响应包含来源 IP 与“被 IP 白名单拒绝”的明确文案，面板识别并展示；拒绝日志按来源限频，避免刷日志。
    - 持久化：写入 TODO-02 的设置存储并定义合并语义；服务启动时加载；设置读取异常时不得静默默认放行，需按显式安全默认处理并记录日志。
    - 测试矩阵：IPv4/IPv6、单 IP/CIDR、回环豁免、空名单拒绝启用、`/0` 拒绝、名单外 403、名单内放行、代理链解析、伪造 XFF、应急关闭、重启后生效。

- [ ] **TODO-05 邮件通知发送**
  - 现状（2026-11-11 复核，未完成）：SMTP 表单完整，但服务端无发信实现；`/api/settings/test-email` 只做 TCP 连通性探测，明确不发送邮件。
  - 已完成子项：SMTP 表单与参数校验；TCP 连通性探测；站内通知中心。
  - 未完成子项：SMTP 真实发送与加密；失败重试/队列；按通知条件触发；敏感信息脱敏；本地 SMTP 夹具；测试邮件真实可送达。
  - 证据：`nacho-panel/app/api/settings/test-email/route.ts:9`、`nacho-server/package.json`（无邮件依赖）、`nacho-server/src/services/notifications.ts`（仅站内通知）。
  - 完成标准：服务端实现 SMTP 发送（加密、超时、失败重试/队列、敏感信息脱敏）；按通知条件真实触发；测试邮件真实可送达；测试使用本地 SMTP 夹具覆盖成功与失败。
  - 若不实现：移除“启用邮件通知”与 SMTP 表单，保留站内通知。

### P1

- [ ] **TODO-06 插件包真实链路（导入/下载/批量安装）**
  - 现状（2026-11-11 复核，小部分完成）：服务端插件元数据 CRUD 与状态持久化已真实可用；“导入”拖拽区仍是静态 UI，提交只写元数据；“下载”只按地址生成记录；批量安装仅把状态改为 installed；Agent 无插件安装/卸载命令。
  - 已完成子项：插件元数据 CRUD、启停状态、列表读取与持久化。
  - 未完成子项：插件包上传/下载与大小、哈希、清单校验；Agent 安装/卸载及结果回传；批量安装真实执行状态汇总；真实文件选择、进度与失败重试；三层契约测试。
  - 证据：`nacho-panel/components/plugins/plugins-view.tsx:209`、`:265`、`nacho-panel/components/plugins/plugins-context.tsx:164`、`nacho-server/src/routes/panel.ts:617`、`nacho-server/src/services/plugins.ts:47`、`nacho-server/client/src/Nacho.Agent/CommandProcessor.cs`（无插件命令）。
  - 完成标准：新增插件包上传/下载与校验（大小、哈希、清单）；Agent 新增安装/卸载命令并回传结果；批量安装按真实执行状态汇总；面板支持真实文件选择、进度与失败重试；三层契约测试。
  - 若不实现：把“导入/下载/批量安装”标记为不可用，保留元数据管理。

- [x] **TODO-07 WebSSH 与文件传输**
  - 现状（2026-11-12 完成）：面板经服务端 WebSocket 转发到在线 Windows Agent 的真实会话；终端为持久 PowerShell/CMD，文件面板使用真实目录与分块传输，不再是本地模拟。
  - 已完成子项：Agent PTY 风格持久 Shell（PowerShell 行循环/CMD 常驻进程）与文件会话；服务端 `/agent/terminal`、`/agent/files` 及面板 ticket WebSocket 双向转发；终端尺寸夹取、面板断线重连与 128 KiB 回放、输入/输出上限、空闲 15 分钟与最长 60 分钟、单客户端 1 会话/全局 8 会话、会话审计表；文件驱动器/目录浏览、删除、256 KiB 分块、逐块 SHA-256、上传断点续传与下载按偏移续传、512 MiB 单文件上限；面板真实终端、文件队列与失败重试。
  - 证据：`nacho-server/src/services/terminal-sessions.ts`、`file-sessions.ts`、`src/schemas/webssh.ts`、`client/src/Nacho.Agent/TerminalSessionManager.cs`、`FileSessionManager.cs`、`FileTransferStore.cs`、`nacho-panel/lib/webssh.ts`、`webssh-dialog.tsx`、`webssh-files-panel.tsx`。
  - 验证（2026-11-12）：服务端 145 项测试、`tsc --noEmit`、`npm run build`；面板 353 项测试、`tsc --noEmit`、桌面 60 项测试与 `pnpm build`（`NachoPanel-Setup-0.3.22.exe`，223,427,191 字节，SHA-256 `128990eb03143c33de29ebfdc2c89086b0e96df86964f2f636f63120e6e06d4e`）；Agent `dotnet build` Debug/Release 通过，236 项测试全部通过（本会话 `dotnet test` 的 testhost 被宿主进程沙箱拦截，使用同一测试程序集的反射 runner 执行）；真实 Agent 端到端验证 PowerShell 中文输出、`C:\` 目录浏览、上传/下载 SHA-256 一致与删除；桌面与 `390×844` 浏览器验收无页面级横向溢出（截图见 `nacho-server/artifacts/evidence/webssh/`）。
  - 剩余边界：仅在线 Windows Agent；终端为行级会话（每条命令一行，非 ConPTY 原始字节终端）；developer preview 不支持真实会话。

- [x] **TODO-08 AI Mode 真实接入**
  - 现状（已完成，2026-10-30；2026-11-11 复核通过）：Windows 桌面版接入 opencode 1.19.5 sidecar（`--pure`，127.0.0.1 + 随机密码）；面板 `/api/ai/*` 提供 DPAPI 设置、Provider 代理、真实测试、NDJSON 流、MCP broker 与审批；MCP 仅 HTTP，设置页可增删改 URL/Token；技能/插件开关实际过滤工具；危险操作需面板确认或拒绝。
  - 已完成子项：opencode sidecar、DPAPI 设置、Provider 代理、真实连接测试、NDJSON 流、MCP broker/审批、技能/插件工具过滤、桌面专属门禁。
  - 未闭环/边界子项：浏览器与云端面板不支持；MCP 仅 HTTP；`s-task` 只读、`s-report` 由模型汇总、`p-backup` 依赖 wbadmin；不开放 restart-system、manage-local-user、manage-registry、安装包与文件部署；MCP Token 会进入 sidecar 环境（bash 可读，但 Provider Key 与 PANEL_API_KEY 不会）；会话不跨刷新持久化；opencode 版本随桌面版本固定；Electron 启动类测试在无交互桌面会话下不可运行。
  - 证据：`desktop/opencode.lock.json`、`nacho-panel/lib/ai/`、`nacho-panel/app/api/ai/`、`nacho-panel/components/ai-mode/ai-event-reducer.ts`、`nacho-panel/components/settings/ai-config-sync.tsx`。
  - 验证（2026-10-30 当次记录，桌面 0.3.12；当前版本口径 0.3.22）：面板 241 项测试、`tsc --noEmit`、`pnpm build`；桌面非 Electron 测试 29 项、`pnpm build` 生成 `desktop/dist/NachoPanel/NachoPanel-Setup-0.3.12.exe`（约 180MB，含 opencode，SHA-256 `5af43c4ed850a43223bb7a59ae9ead25172103bc02d7ad2a5be6d67556f2524d`）；真实 UI 验证设置测试连接、流式回复、工具审批与拒绝。2026-11-11 复核：当前桌面源码为 0.3.22，AI Mode 路由与运行链路仍存在；本次未重新执行测试、未重新打包，0.3.22 的 EXE 与哈希未更新，不能把 0.3.12 的验证结果直接视为 0.3.22 的产物验证。
  - 发布状态：未发布；当前 0.3.22 只有本地源码/构建链路，GitHub 最新面板 Release 仍为 v0.3.11。

- [ ] **TODO-09 Linux Agent 与 Linux 管理页**
  - 现状（2026-11-11 复核，未完成）：Agent 只有 Windows 实现，制品清单只接受 `win-x64`；面板 Linux 页签的 systemd 服务与 Crontab 为硬编码、按钮无请求；其余 Linux 功能被过滤或占位；macOS 入口仍提示“仅覆盖 Windows 与 Linux 客户端”，与 Linux 尚未实现的现状不一致。
  - 已完成子项：Windows Agent 与 Windows 管理命令；Linux 页签和占位 UI。
  - 未完成子项：Linux Agent（注册、心跳、journal、命令、更新）；Linux 制品清单；Linux systemd/Crontab 真实命令；隐藏 Linux 页签与相关入口或明确产品范围；修正 macOS 误导文案。
  - 证据：`nacho-panel/components/clients/panels.tsx:311`、`nacho-server/src/services/agent-updates.ts:52`、`nacho-panel/components/clients/extensions-panel.tsx:2790`、`:2837`、`:3304`、`:3322`。
  - 完成标准：提供 Linux Agent（注册、心跳、journal、命令、更新）与 Linux 制品清单；面板 Linux 管理接真实命令；或明确产品范围，隐藏 Linux 页签与相关入口，修正 macOS 提示文案。
  - 注：工作量大，建议先做“隐藏/标注”止血，再排期 Agent。

### P2

- [ ] **TODO-10 清理项（非阻塞）**
  - 现状（2026-11-11 复核，未完成）：以下 4 个子项均仍存在。
  - 已完成子项：无。
  - 未完成子项：
    - 遗留命名：`nacho-panel/app/page.tsx:2` 仍导入 `BitcoinCard` / `MarketCapCard`，`nacho-panel/app/layout.tsx:25` 保留 `generator: 'v0.app'`；后续统一改为设备/控制台语义。
    - 过期注释：`nacho-panel/components/logs/logs-view.tsx:158` 仍写“演示数据”，实际已接 `/logs` API。
    - 插件下载服务器地址只存在组件内存（`plugins-context.tsx:114` 的 `useState("")`），未持久化。
    - `extensions-panel.tsx` 的 `matchOS` 在缺少 OS 字段时按 id 哈希“演示”分配（`:2881`），应改为真实字段或明确空态。

### 现存缺陷（非功能待办）

- [ ] **DEF-01 注册限流的客户端 IP 解析**
  - 现状（2026-11-11 复核，未修复）：`clientIp()` 无条件信任 `X-Forwarded-For`，与 `TRUST_PROXY` 无关，可伪造头绕过注册限流并污染日志。
  - 已完成子项：注册失败限流与日志限频框架（`enrollment-guard`）。
  - 未完成子项：仅在 `TRUST_PROXY` 开启且来源为可信代理时解析转发链；取首个非代理地址；IPv6 映射；直连、代理链、伪造头与限流恢复测试。
  - 证据：`nacho-server/src/routes/agent.ts:17`、`nacho-server/src/config.ts:41`。
  - 完成标准：仅在 `TRUST_PROXY` 开启且来源为可信代理时解析转发链，取首个非代理地址；处理 IPv6 映射；测试覆盖直连、代理链、伪造头与限流恢复。
  - 优先级：高，建议先于 TODO-03 修复。

- [ ] **DEF-02 局域网 Agent 地址选择**
  - 现状（2026-11-11 复核，未修复）：局域网模式取第一个非回环 IPv4 写入 Agent 安装信息，多网卡（VPN/Docker/Hyper-V）时可能不可达。
  - 已完成子项：局域网模式切换与 Windows 防火墙放行流程。
  - 未完成子项：可达地址探测或用户选择；安装信息与实际监听地址一致；多网卡与无可用地址测试。
  - 证据：`nacho-panel/lib/local-control-server.ts:101`、`:309`。
  - 完成标准：探测或让用户选择可达地址，安装信息与实际监听地址一致；测试覆盖多网卡与无可用地址。

### Alpha（未来，未排期）

> 以下为未来可能方向，统一依赖账号体系；账号体系完成前不进入实现。

- [ ] **ALPHA-01 账号体系（前置）**
  - 现状（2026-11-11 复核，未开始）：服务端仍只有单一 `PANEL_API_KEY` 与 Agent token，没有账号、角色、会话或密钥哈希表；面板密钥列表仍是本地演示数据，登录凭据仅为 onboarding 本机状态。
  - 已完成子项：无；现有单面板 API Key 与 Agent token 不构成账号体系。
  - 未完成子项：面板注册 ID；管理员分配；角色与鉴权；密钥哈希存储；会话撤销；本机与云端部署初始化路径；对应测试。
  - 面板注册 ID：服务端在面板首次连接（注册）时分发唯一 ID 并持久保存；注册名称重复时在名称后追加数字后缀。
  - 管理员分配：使用面板云端部署时，自动将当前面板写入为管理员；管理员自行脚本部署（未走面板云端部署）时，部署过程输出两串 API Key——管理员 Key 仅显示一次，普通用户 Key 常驻。
  - 角色与鉴权：区分管理员/普通用户；密钥仅存哈希；会话可撤销；本机与云端部署的初始化路径一致可验证。
  - 完成标准：注册 ID 唯一且重启后可恢复；同名后缀、云端部署初始化、脚本部署初始化、角色越权与密钥哈希存储均有测试。

- [ ] **ALPHA-02 双因素认证**（依赖 ALPHA-01）
  - 现状（2026-11-11 复核，未开始）：开关仅前端 state，服务端无账号体系可挂；代码中没有 TOTP、恢复码或服务端校验。
  - 已完成子项：仅 UI 开关。
  - 未完成子项：TOTP 校验、启用/停用、恢复码、失败重试与锁定、绑定/校验/停用/恢复测试。
  - 完成标准：登录时在密码/密钥之外校验 TOTP；支持启用、停用与恢复码；失败重试与锁定；测试覆盖绑定、校验、停用与恢复。

- [ ] **ALPHA-03 面板接入鉴权开关**（沿用名称「启用 API Key 鉴权」；依赖 ALPHA-01）
  - 现状（2026-11-11 复核，未开始）：服务端没有“关闭后拒绝新面板连接”的逻辑，开关只改变前端状态。
  - 已完成子项：仅 UI 开关。
  - 未完成子项：服务端连接门禁、已连接面板白名单、防自锁操作限制、重启后状态保持、关闭/拒绝/重开/恢复测试。
  - 语义（2026-10-30 定）：开关控制服务端是否接受面板以 URL + API Key 建立连接。关闭后，已连接的面板构成唯一允许的设备集合，其他面板即使持有正确的 URL 与 Key 也无法连接；开关仅允许在已连接的面板内或服务端本地操作，避免自锁。
  - 完成标准：关闭后新面板连接被明确拒绝；已连接面板不受影响；仅可从已连接面板或服务端本地关闭；重启后生效状态保持；测试覆盖关闭、拒绝、重开与恢复路径。

- [ ] **ALPHA-04 登出其他会话**（依赖 ALPHA-01）
  - 现状（2026-11-11 复核，未开始）：“全部登出”按钮没有请求处理，服务端也没有多面板会话列表。
  - 已完成子项：仅 UI 按钮。
  - 未完成子项：面板会话列表、注册 ID 识别、目标会话吊销、当前面板保留、多面板注册/同名后缀/吊销/重连测试。
  - 语义：基于 ALPHA-01 的面板注册 ID 列出已连接面板，使除当前面板外的会话立即失效；当前面板保留。
  - 完成标准：可识别每个面板注册 ID 与会话；执行后目标面板立即失去鉴权；当前面板不受影响；测试覆盖多面板注册、同名后缀、吊销与重连。

### 发布与验证（非功能待办）

- [ ] **TODO-11 服务端/Agent 1.1.25 发布与升级源迁移**
  - 现状（2026-11-11 复核，部分完成）：服务端与 Agent 源码版本已到 1.1.25（提交 `0ef2603`），`1.1.24` 源码提交 `bbf2c41` 也已在历史中，且已推送到 `origin/main`。GitHub 最新服务端/Agent Release 仍为 `v1.1.22`；仓库内 `artifacts/windows/latest.json` 仍指向 1.1.21。未发现 1.1.24/1.1.25 的 GitHub 制品、签名索引切换、SSE 通知或升级执行器迁移/回滚演练证据。
  - 已完成子项：服务端/Agent 源码版本推进到 1.1.25 并推送。
  - 未完成子项：固定提交后的双仓 Release；1.1.25 服务端源码包与 Agent EXE；签名索引与 SSE 通知；GitHub 公网回读；现有控制服务与 root 升级执行器迁移；目标主机构建/回滚演练。
  - 完成标准：固定提交、双仓 Release、签名索引、SSE 通知与 GitHub 公网回读全部验证；升级执行器在目标主机完成构建/回滚演练。

- [ ] **TODO-12 面板 0.3.22 安装验证**
  - 现状（2026-11-11 复核，部分完成）：桌面源码版本为 0.3.22（提交 `b5caf47`），但 GitHub 最新面板 Release 仍为 `v0.3.11`；0.3.11 Beta 已发布并完成公网回读，实际安装/升级/回滚仍无仓库内验证证据。0.3.12–0.3.22 为本地迭代版本，尚未形成对应公网 Release。
  - 已完成子项：0.3.11 Beta 发布、公网回读与更新索引切换；0.3.22 本地源码/构建链路。
  - 未完成子项：0.3.22 公网 Release；真实安装、升级、回滚与更新中心展示验证；桌面 3 项真实 Electron 用例的环境限制处理或复跑记录。
  - 完成标准：真实安装、升级、回滚与更新中心展示验证通过；记录 Electron 用例的环境限制或修复测试环境。

---

> 发布记录已剥离至 `PROJECT_RELEASE_HISTORY.md`（非发布或回溯场景无需读取）。
