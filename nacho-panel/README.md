# nacho

This is a [Next.js](https://nextjs.org) project bootstrapped with [v0](https://v0.app).

## Built with v0

This repository is linked to a [v0](https://v0.app) project. You can continue developing by visiting the link below -- start new chats to make changes, and v0 will push commits directly to this repo. Every merge to `main` will automatically deploy.

[Continue working on v0 →](https://v0.app/chat/projects/prj_rgpjkUuZ41Rx2Qe6TBhGdbS6vRF2)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Windows 本机控制服务

在 Windows 运行面板后，可从首次引导或“设置 → 连接”选择“本机部署”。界面会检查 Node.js 22+、npm 与同级 `server/` 源码，随后自动执行依赖安装、构建、随机密钥配置和后台启动；默认只开放 `127.0.0.1:8443`，无需管理员权限。

局域网模式会单独请求 UAC，只放行专用 TCP 端口的 `Private + LocalSubnet` 入站流量。登录自启写入当前用户 `HKCU`，不是 Windows Service；设置页可执行启动、停止、重启、修复和彻底卸载。修复会备份并回滚失败的构建和配置，卸载会删除本机数据与运行产物但保留源码。

Windows 的受限日志快照入口位于“客户端管理 → 批量操作 → Windows → 日志采集”。目标 Agent 的 `%ProgramData%\Nacho\agent.json` 必须由管理员显式设置 `"allowLogCollection": true` 才会读取固定 `agent/system/application` 来源；默认值为 `false`，单次窗口最多 24 小时、1000 条和 512 KiB。

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Learn More

To learn more, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [v0 Documentation](https://v0.app/docs) - learn about v0 and how to use it.
