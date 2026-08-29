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

## 服务端

```powershell
cd server
npm run build
npm start
```

服务端的部署、Windows Agent 与制品说明见 [`server/README.md`](server/README.md)。面板说明见 [`nacho-panel/README.md`](nacho-panel/README.md)。
