# 当前待办

> 本文件是唯一当前待办来源。以下「未完成功能待办」为 2026-10-30 基于当前源码的核对结果；历史发布记录已剥离至 `PROJECT_RELEASE_HISTORY.md`。完成一项后勾选并更新对应条目。

## 未完成功能待办（2026-10-30）

**统计口径**：面板界面 + 服务端 API + Agent 执行三层端到端可用。仅界面存在、后端未闭环的也计入。开发者预览模式为有意设计，不计入待办。

**优先级**：P0 = 界面已承诺但后端未兑现，优先处理；P1 = 已明示的演示边界或平台缺口；P2 = 清理项。

**通用完成标准**：涉及命令契约时同步修改 Agent `Models.cs` / `CommandProcessor.cs`、服务端 `src/schemas/commands.ts` 与面板解析器；按各仓 `AGENTS.md` 第 7 节执行分层测试与 Windows EXE 打包。

### P0

- [ ] **TODO-01 计划任务自动调度**
  - 现状：`cron` / `interval` / `time` / `triggerId` 仅作为字段存储；服务端只有离线扫描和 Agent 制品同步两个定时器，唯一执行入口是面板手动调用 `POST /tasks/:id/dispatch`。
  - 证据：`nacho-server/src/services/tasks.ts:127`、`nacho-server/src/index.ts:76`、`nacho-panel/components/tasks/tasks-view.tsx:740`。
  - 完成标准：服务端按任务配置自动触发；支持启用/停用、时区、重启恢复、防重复投递与失败重试；面板显示下次/最近执行时间；测试覆盖 cron 解析、时区、重启补齐与重复投递。
  - 若产品决定不做自动调度：移除 UI 中的 Cron/间隔暗示，把页面改为“任务模板 / 手动任务”。

- [ ] **TODO-02 系统设置持久化与生效（常规 + 通知条件）**
  - 现状：`SettingsView.handleSave()` 仅在 `security.openEnrollment` 变化时调用 `PUT /api/panel/settings`；常规设置与通知条件只存在前端 state，刷新即还原，服务端不读取。
  - 证据：`nacho-panel/components/settings/settings-view.tsx:86`、`nacho-server/src/services/settings.ts:28`。
  - 完成标准：服务端定义设置 schema 与默认值，整包保存/读取并前向兼容未知字段；实际消费并发数、命令超时、重试次数、日志保留、离线阈值、时区、自动清理、CPU/内存/磁盘阈值与静默时段；面板挂载时读取、保存后重启仍生效；测试覆盖往返、默认值、旧数据与非法值。
  - 合并语义：`PUT /settings` 当前为整包替换，而面板只提交 `security.openEnrollment`；实现时必须定义合并语义，禁止单字段提交清空其他设置，并补测试覆盖。
  - 注意：SMTP 密码等敏感字段不得写入日志。

- [ ] **TODO-03 前置：HTTPS/TLS 基线与客户端信任策略（阻塞 TODO-03）**
  - 现状事实（2026-10-30 核对）：
    - 服务端只有明文监听，无任何 TLS 配置，HTTPS 只能由反向代理终止；反向代理后生成的下载/安装地址还依赖 `PUBLIC_BASE_URL` 与 `TRUST_PROXY` 才正确。
      `nacho-server/src/index.ts:71`、`nacho-server/src/routes/artifacts.ts:13`
    - Agent 使用默认 `SocketsHttpHandler` 与 `ClientWebSocket`，没有自定义 CA、证书回调或忽略选项；自签名证书、或证书主机名与访问地址（常见为 IP）不匹配时，注册、心跳、取命令与 WS 会全部失败；`serverUrl` 写死在每台机器的 `agent.json`，无法由服务端远程迁移。
      `nacho-server/client/src/Nacho.Agent/AgentApiClient.cs:18`、`:170`、`:180`
    - 面板的部署/管理链路全部硬编码 `http://`（本机健康检查、局域网 Agent 地址、云端部署返回地址）；服务端一旦强制 HTTPS，面板自建的本机实例会立即失联，健康检查、启停、修复、升级全部失效。
      `nacho-panel/lib/local-control-server.ts:305`、`:309`、`nacho-panel/lib/cloud-deployment.ts:489`
    - 面板渲染进程直接 fetch/XHR，证书错误被统一吞成“连接服务端失败”，用户无法分辨证书问题；Electron 主进程没有证书错误处理。
      `nacho-panel/components/server-data-context.tsx:139`、`:150`、`nacho-main/desktop/src/main.cjs:260`
    - 桌面端产品更新传输不接受带子路径的服务端地址，反向代理挂在子路径时会直接失败。
      `nacho-main/desktop/src/updates.cjs:363`
  - 前置完成的定义（以下全部产出后才允许开始 TODO-03）：
    1. 明确结论：HTTPS 采用“反向代理终止 TLS”“服务端内置 TLS”或“明确不支持”，写进本文件与部署文档，UI 文案与结论一致。
    2. 若支持，写清：证书要求（以公共 CA 签发且主机名匹配为基线）、Agent 连接地址必须使用域名而非 IP、私有 CA 与 SPKI 固定的取舍、逐机迁移与回滚顺序、回环地址豁免策略、`PUBLIC_BASE_URL`/`TRUST_PROXY`/`X-Forwarded-Proto` 规范。
    3. 面板增加证书类错误的可诊断文案（自签名、过期、主机名不匹配、证书链缺失），不得继续只报“连接失败”。
    4. 迁移顺序固定为：反向代理同时接受 HTTP/HTTPS → 逐机切换 Agent → 最后强制；重定向仅允许 307/308，`/agent/*` 建议直接返回明确 4xx 而非重定向。
    5. 测试矩阵覆盖：自签名、过期、主机名不匹配、证书链缺失、明文被拒、回环豁免、子路径反向代理。
  - 未完成本前置时：不得实现任何服务端强制 HTTPS 逻辑。

- [ ] **TODO-03 安全策略生效**
  - 前置门禁：必须先完成「TODO-03 前置」；前置未写好、未定稿前，本项任何代码都不允许开始编写。
  - 现状：会话超时、IP 白名单、强制 HTTPS 只改前端 state；双因素、面板接入鉴权、登出其他会话依赖尚不存在的账号体系，已移入 Alpha；API 密钥管理不纳入当前范围（2026-10-30 删除）；登录失败锁定按移除处理；免密注册保持现有默认。
  - 证据：`nacho-panel/components/settings/security-panel.tsx:186`、`:220`、`:230`、`:233`、`nacho-server/src/lib/auth.ts:49`。
  - 完成标准：逐项明确“实现”或“移除开关”。实现项需有服务端/桌面端强制逻辑、测试与错误响应；移除项需从 UI 与类型中删除，避免继续误导。其中「强制 HTTPS」默认按“移除开关 + 部署说明”处理，除非前置结论明确选择实现；「登录失败锁定」直接移除。
  - 依赖：TODO-02 的持久化。
  - 免密注册：保持现有默认（本机安装 `ALLOW_OPEN_ENROLLMENT=true`），本次不调整。
  - **子项 1：会话超时（待办）**
    - 目标：面板无操作超过设定时长后自动锁定，需重新输入本机凭据。当前无服务端会话体系，先以本机锁屏实现；Alpha 账号体系落地后再评估服务端会话强制。
    - 完成标准：设置持久化并在重启后生效；空闲计时覆盖所有主页面与窗口失焦/恢复；锁屏后需重新输入凭据；测试覆盖计时、操作重置、设置变更与刷新恢复。
  - **子项 2：IP 访问白名单（方案已定，2026-10-30）**
    - 产品形态：单一开关 + 统一 IP/CIDR 名单；「内网 / 外网」只作为录入模板与提示，不构成两套匹配规则。外网模板仅接受单个 IP（支持批量粘贴多条），内网模板接受单个 IP 与网段；两者最终落库为同一份规范化名单。
    - 作用域：默认且仅保护 `/api/panel/*` 管理面；不作用于 `/agent/*`、`/agent/ws` 与制品下载，避免 Agent 批量断连。若后续需要保护 Agent 面，必须另设独立名单并在 UI 明确区分。
    - 匹配规则：支持 IPv4/IPv6 单地址与 CIDR；地址规范化（含 `::ffff:` 映射、去重与合并）；回环地址永远放行；禁止空名单启用；禁止 `0.0.0.0/0`、`::/0`；限制条目数与总覆盖地址数。
    - 防自锁：保存/启用前校验当前请求来源 IP 已在名单内，否则拒绝启用；界面展示服务端看到的当前来源 IP 并支持一键加入；提供环境变量或 `napl` 应急关闭通道，并写入部署文档。
    - 代理联动：仅在 `TRUST_PROXY` 开启且请求来自可信代理时解析 `X-Forwarded-For` 链，取第一个非代理地址；与 DEF-01 共用同一套 IP 解析实现。
    - 拒绝诊断：403 响应包含来源 IP 与“被 IP 白名单拒绝”的明确文案，面板识别并展示；拒绝日志按来源限频，避免刷日志。
    - 持久化：写入 TODO-02 的设置存储并定义合并语义；服务启动时加载；设置读取异常时不得静默默认放行，需按显式安全默认处理并记录日志。
    - 测试矩阵：IPv4/IPv6、单 IP/CIDR、回环豁免、空名单拒绝启用、`/0` 拒绝、名单外 403、名单内放行、代理链解析、伪造 XFF、应急关闭、重启后生效。

- [ ] **TODO-05 邮件通知发送**
  - 现状：SMTP 表单完整，但服务端无发信实现；`/api/settings/test-email` 只做 TCP 连通性探测，明确不发送邮件。
  - 证据：`nacho-panel/app/api/settings/test-email/route.ts:9`、`nacho-server/package.json`（无邮件依赖）。
  - 完成标准：服务端实现 SMTP 发送（加密、超时、失败重试/队列、敏感信息脱敏）；按通知条件真实触发；测试邮件真实可送达；测试使用本地 SMTP 夹具覆盖成功与失败。
  - 若不实现：移除“启用邮件通知”与 SMTP 表单，保留站内通知。

### P1

- [ ] **TODO-06 插件包真实链路（导入/下载/批量安装）**
  - 现状：服务端只有插件元数据 CRUD；“导入”拖拽区是静态 UI，提交只写元数据；“下载”只按地址生成记录；批量安装仅把状态改为 installed；Agent 无插件安装命令。
  - 证据：`nacho-panel/components/plugins/plugins-view.tsx:172`、`:265`、`nacho-panel/components/plugins/plugins-context.tsx:164`、`nacho-server/src/routes/panel.ts:616`。
  - 完成标准：新增插件包上传/下载与校验（大小、哈希、清单）；Agent 新增安装/卸载命令并回传结果；批量安装按真实执行状态汇总；面板支持真实文件选择、进度与失败重试；三层契约测试。
  - 若不实现：把“导入/下载/批量安装”标记为不可用，保留元数据管理。

- [ ] **TODO-07 WebSSH 与文件传输**
  - 现状：终端为预置命令模拟器；文件面板使用 `MOCK_FS`，上传/下载/删除均为模拟进度，无 PTY/SFTP 通道。
  - 证据：`nacho-panel/components/topbar/webssh-dialog.tsx:56`、`nacho-panel/components/topbar/webssh-files-panel.tsx:41`、`:89`。
  - 完成标准：Agent 提供 PTY 与文件传输命令，服务端提供 WebSocket 流式转发；支持终端尺寸、重连、输出上限、超时、审计与单会话限制；文件传输支持分块、校验与断点/重试；完成桌面与 390×844 视口验证。
  - 若不实现：入口明确标注“演示”，或暂时隐藏。

- [x] **TODO-08 AI Mode 真实接入**
  - 现状（已完成，2026-10-30）：Windows 桌面版接入 opencode 1.19.5 sidecar（`--pure`，127.0.0.1 + 随机密码）；面板 `/api/ai/*` 提供 DPAPI 设置、Provider 代理、真实测试、NDJSON 流、MCP broker 与审批；MCP 仅 HTTP，设置页可增删改 URL/Token；技能/插件开关实际过滤工具；危险操作需面板确认或拒绝。
  - 证据：`desktop/opencode.lock.json`、`nacho-panel/lib/ai/`、`nacho-panel/app/api/ai/`、`nacho-panel/components/ai-mode/ai-event-reducer.ts`、`nacho-panel/components/settings/ai-config-sync.tsx`。
  - 验证：面板 241 项测试、`tsc --noEmit`、`pnpm build`；桌面非 Electron 测试 29 项、`pnpm build` 生成 `desktop/dist/NachoPanel/NachoPanel-Setup-0.3.12.exe`（约 180MB，含 opencode，SHA-256 `5af43c4ed850a43223bb7a59ae9ead25172103bc02d7ad2a5be6d67556f2524d`）；真实 UI 验证设置测试连接、流式回复、工具审批与拒绝。
  - 残余限制：浏览器/云端面板不支持（desktop-only）；MCP 仅 HTTP；`s-task` 只读、`s-report` 由模型汇总、`p-backup` 依赖 wbadmin；不开放 restart-system、manage-local-user、manage-registry、安装包与文件部署；MCP Token 会进入 sidecar 环境（bash 可读，但 Provider Key 与 PANEL_API_KEY 不会）；会话不跨刷新持久化；opencode 版本随桌面版本固定，升级需重跑门禁与打包；Electron 启动类桌面测试在无交互桌面会话下不可运行，需在用户桌面复跑。
  - 发布状态：未发布；仅本地构建与验证。

- [ ] **TODO-09 Linux Agent 与 Linux 管理页**
  - 现状：Agent 只有 Windows 实现，制品清单只接受 `win-x64`；面板 Linux 页签的 systemd 服务与 Crontab 为硬编码、按钮无请求；其余 Linux 功能被过滤或占位；macOS 明确不支持。
  - 证据：`nacho-panel/components/clients/panels.tsx:311`、`nacho-server/src/services/agent-updates.ts:52`、`nacho-panel/components/clients/extensions-panel.tsx:2790`、`:2837`、`:3322`。
  - 完成标准：提供 Linux Agent（注册、心跳、journal、命令、更新）与 Linux 制品清单；面板 Linux 管理接真实命令；或明确产品范围，隐藏 Linux 页签与相关入口，修正 macOS 提示文案。
  - 注：工作量大，建议先做“隐藏/标注”止血，再排期 Agent。

### P2

- [ ] **TODO-10 清理项（非阻塞）**
  - 遗留命名：`nacho-panel/app/page.tsx` 仍导入 `BitcoinCard` / `MarketCapCard`，`nacho-panel/app/layout.tsx` 保留 `generator: 'v0.app'`；后续统一改为设备/控制台语义。
  - 过期注释：`nacho-panel/components/logs/logs-view.tsx:158` 仍写“演示数据”，实际已接 `/logs` API。
  - 插件下载服务器地址只存在组件内存，未持久化。
  - `extensions-panel.tsx` 的 `matchOS` 在缺少 OS 字段时按 id 哈希“演示”分配，应改为真实字段或明确空态。

### 现存缺陷（非功能待办）

- [ ] **DEF-01 注册限流的客户端 IP 解析**
  - 现状：`clientIp()` 无条件信任 `X-Forwarded-For`，与 `TRUST_PROXY` 无关，可伪造头绕过注册限流并污染日志。
  - 证据：`nacho-server/src/routes/agent.ts:17`。
  - 完成标准：仅在 `TRUST_PROXY` 开启且来源为可信代理时解析转发链，取首个非代理地址；处理 IPv6 映射；测试覆盖直连、代理链、伪造头与限流恢复。
  - 优先级：高，建议先于 TODO-03 修复。

- [ ] **DEF-02 局域网 Agent 地址选择**
  - 现状：局域网模式取第一个非回环 IPv4 写入 Agent 安装信息，多网卡（VPN/Docker/Hyper-V）时可能不可达。
  - 证据：`nacho-panel/lib/local-control-server.ts:101`、`:308`。
  - 完成标准：探测或让用户选择可达地址，安装信息与实际监听地址一致；测试覆盖多网卡与无可用地址。

### Alpha（未来，未排期）

> 以下为未来可能方向，统一依赖账号体系；账号体系完成前不进入实现。

- [ ] **ALPHA-01 账号体系（前置）**
  - 面板注册 ID：服务端在面板首次连接（注册）时分发唯一 ID 并持久保存；注册名称重复时在名称后追加数字后缀。
  - 管理员分配：使用面板云端部署时，自动将当前面板写入为管理员；管理员自行脚本部署（未走面板云端部署）时，部署过程输出两串 API Key——管理员 Key 仅显示一次，普通用户 Key 常驻。
  - 角色与鉴权：区分管理员/普通用户；密钥仅存哈希；会话可撤销；本机与云端部署的初始化路径一致可验证。
  - 完成标准：注册 ID 唯一且重启后可恢复；同名后缀、云端部署初始化、脚本部署初始化、角色越权与密钥哈希存储均有测试。

- [ ] **ALPHA-02 双因素认证**（依赖 ALPHA-01）
  - 现状：开关仅前端 state，服务端无账号体系可挂。
  - 完成标准：登录时在密码/密钥之外校验 TOTP；支持启用、停用与恢复码；失败重试与锁定；测试覆盖绑定、校验、停用与恢复。

- [ ] **ALPHA-03 面板接入鉴权开关**（沿用名称「启用 API Key 鉴权」；依赖 ALPHA-01）
  - 语义（2026-10-30 定）：开关控制服务端是否接受面板以 URL + API Key 建立连接。关闭后，已连接的面板构成唯一允许的设备集合，其他面板即使持有正确的 URL 与 Key 也无法连接；开关仅允许在已连接的面板内或服务端本地操作，避免自锁。
  - 完成标准：关闭后新面板连接被明确拒绝；已连接面板不受影响；仅可从已连接面板或服务端本地关闭；重启后生效状态保持；测试覆盖关闭、拒绝、重开与恢复路径。

- [ ] **ALPHA-04 登出其他会话**（依赖 ALPHA-01）
  - 语义：基于 ALPHA-01 的面板注册 ID 列出已连接面板，使除当前面板外的会话立即失效；当前面板保留。
  - 完成标准：可识别每个面板注册 ID 与会话；执行后目标面板立即失去鉴权；当前面板不受影响；测试覆盖多面板注册、同名后缀、吊销与重连。

### 发布与验证（非功能待办）

- [ ] **TODO-11 服务端/Agent 1.1.24 发布与升级源迁移**
  - 现状：产品源码提交、推送与新 GitHub 制品发布仍待授权；现有控制服务与 root 升级执行器需迁移并配置更新源。
  - 完成标准：固定提交、双仓 Release、签名索引、SSE 通知与 GitHub 公网回读全部验证；升级执行器在目标主机完成构建/回滚演练。

- [ ] **TODO-12 面板 0.3.11 安装验证**
  - 现状：0.3.11 Beta 已发布并完成公网回读，实际安装仍由用户测试；桌面 3 项真实 Electron 用例受当前环境限制失败。
  - 完成标准：真实安装、升级、回滚与更新中心展示验证通过；记录 Electron 用例的环境限制或修复测试环境。

---

> 发布记录已剥离至 `PROJECT_RELEASE_HISTORY.md`（非发布或回溯场景无需读取）。
