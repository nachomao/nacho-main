# Nacho

项目已经按运行边界拆分为两个同级目录：

```text
nacho-main/
├─ nacho-panel/   # Next.js 面板
└─ server/        # Node.js 控制服务端与 Windows Agent
```

## 面板

```powershell
cd nacho-panel
pnpm dev
```

面板默认地址为 `http://localhost:3000`。

### Windows 本机一键部署

需要 Node.js 22+、npm、完整的仓库目录，并从 Windows 启动面板。首次进入引导页，或在“设置 → 连接”中选择“本机部署”，面板会自动生成独立密钥、安装锁定依赖、构建服务端、写入本机配置并启动后台进程；无需手动编辑 `.env` 或执行服务端命令。

默认仅监听 `127.0.0.1:8443`。选择“同一局域网”时才会请求 Windows 管理员授权，并仅创建 `Private + LocalSubnet + 指定 TCP 端口` 的入站规则；“登录后自动启动”使用当前 Windows 用户的 `HKCU` 启动项。设置页也可停止、重启、修复或彻底卸载，卸载会清除本机配置、SQLite 数据、日志、依赖和构建产物，但保留仓库源码。

## 服务端

```powershell
cd server
npm run build
npm start
```

服务端的部署、Windows Agent 与制品说明见 [`server/README.md`](server/README.md)。面板说明见 [`nacho-panel/README.md`](nacho-panel/README.md)。
