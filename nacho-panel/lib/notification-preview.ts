import type { GroupedNotice, Notice } from "../components/topbar/notifications-drawer"

type PreviewSeed = Pick<Notice, "id" | "title" | "desc" | "detail"> & Partial<Notice>

function notice(seed: PreviewSeed): Notice {
  return {
    type: "health",
    severity: "warning",
    code: "DEMO_NOTICE",
    source: "虚拟演示",
    deviceId: null,
    snoozedUntil: null,
    groupKey: seed.id,
    time: "刚刚",
    read: false,
    ...seed,
  }
}

export function createNotificationPreview(): GroupedNotice[] {
  const healthItems = [
    { name: "设计工作站", metric: "CPU 持续占用 92%", detail: "持续时间：5 分钟\n进程：render-worker.exe\n建议：检查渲染队列和后台任务。" },
    { name: "构建节点", metric: "可用磁盘空间低于 10%", detail: "卷：D:\n可用空间：18.6 GB / 512 GB\n建议：清理过期构建缓存。" },
    { name: "测试笔记本", metric: "内存占用达到 88%", detail: "可用内存：1.9 GB\n建议：检查当前测试进程。" },
    { name: "文件服务器", metric: "磁盘响应时间偏高", detail: "平均响应时间：156 ms\n采样窗口：最近 3 分钟\n建议：检查备份任务与磁盘负载。" },
  ].map((item, index) => notice({
    id: `demo-health-${index + 1}`,
    title: `${item.name} · 健康告警`,
    desc: item.metric,
    detail: `以下为虚拟采样数据，不代表真实设备状态。\n${item.detail}`,
    groupKey: "demo-health-group",
    deviceId: `DEMO-PC-0${index + 1}`,
    time: `${index + 1} 分钟前`,
    code: "DEMO_HEALTH_WARNING",
    read: index === 3,
  }))

  const offlineItems = ["实验室节点 A", "实验室节点 B", "实验室节点 C"].map((name, index) => notice({
    id: `demo-offline-${index + 1}`,
    type: "offline",
    title: `${name} · 心跳中断`,
    desc: `连续 ${index + 3} 次未收到心跳，等待重新连接。`,
    detail: `演示设备：${name}\n最后一次心跳：${index + 3} 分钟前\n模拟原因：测试网络切换。未操作真实设备。`,
    groupKey: "demo-offline-group",
    deviceId: `DEMO-LAB-0${index + 1}`,
    severity: "error",
    code: "DEMO_HEARTBEAT_TIMEOUT",
    time: `${index + 6} 分钟前`,
  }))

  return [
    {
      ...notice({
        id: "demo-single-offline",
        type: "offline",
        title: "办公主机暂时离线",
        desc: "独立卡片 · 点击查看详情的展开与收起过渡。",
        detail: "这是一条虚拟离线通知。\n设备：办公主机 DEMO-DESKTOP\n检测结果：连续 3 次心跳超时\n建议：检查网络连接后重新确认在线状态。\n本次演示不会连接或操作该设备。",
        deviceId: "DEMO-DESKTOP",
        severity: "error",
        code: "DEMO_CLIENT_OFFLINE",
      }),
      count: 1,
    },
    {
      ...notice({
        id: "demo-group-health",
        title: "4 条设备健康告警",
        desc: "堆叠卡片 · 点击观察 4 张子卡片依次渐显。",
        detail: "虚拟健康巡检汇总：CPU、磁盘空间、内存与磁盘响应时间。\n包含 3 条未读和 1 条已读，便于对比不同状态。",
        groupKey: "demo-health-group",
        code: "DEMO_HEALTH_GROUP",
        time: "1 分钟前",
      }),
      count: healthItems.length,
      items: healthItems,
    },
    {
      ...notice({
        id: "demo-single-task",
        type: "task",
        title: "每日备份任务执行失败",
        desc: "长详情卡片 · 查看多行文本展开时的高度变化。",
        detail: "这是一条虚拟任务失败通知。\n任务：每日增量备份\n目标目录：D:\\Nacho\\Backups\\daily\\2026-09-15\n结果：目标目录剩余空间不足\n退出码：112\n处理建议：\n1. 检查备份盘剩余容量。\n2. 清理超过保留周期的旧备份。\n3. 确认目标目录可写后再运行任务。\n此处仅用于检验长文本排版和动画，没有真实任务被执行。",
        severity: "critical",
        code: "DEMO_BACKUP_FAILED",
        time: "5 分钟前",
      }),
      count: 1,
    },
    {
      ...notice({
        id: "demo-group-offline",
        type: "offline",
        title: "3 台实验室设备离线",
        desc: "堆叠卡片 · 可反复展开、收起或标记整组已读。",
        detail: "虚拟网络切换事件，共影响 3 台演示设备。\n所有设备名称、心跳时间与告警均为演示数据。",
        severity: "error",
        groupKey: "demo-offline-group",
        code: "DEMO_NETWORK_GROUP",
        time: "6 分钟前",
      }),
      count: offlineItems.length,
      items: offlineItems,
    },
    {
      ...notice({
        id: "demo-single-read",
        title: "磁盘空间提醒（已读）",
        desc: "已读独立卡片 · 同样支持完整的展开与收起动画。",
        detail: "虚拟设备：归档主机\n可用磁盘空间：14%\n状态：这条演示通知已经标记为已读。",
        code: "DEMO_DISK_WARNING",
        time: "12 分钟前",
        read: true,
      }),
      count: 1,
    },
  ]
}

export type NotificationPreviewAction =
  | { type: "reset" }
  | { type: "clear" }
  | { type: "readAll" }
  | { type: "read"; id: string }
  | { type: "readGroup"; groupKey: string }
  | { type: "snooze"; id: string; until: number }
  | { type: "snoozeGroup"; groupKey: string; until: number }

export function notificationPreviewReducer(notices: GroupedNotice[], action: NotificationPreviewAction): GroupedNotice[] {
  if (action.type === "reset") return createNotificationPreview()
  if (action.type === "clear") return []
  if (action.type === "snooze" || action.type === "snoozeGroup") {
    if (!Number.isFinite(action.until) || action.until <= Date.now()) return notices
    // 演示不调度真实提醒；隐藏后通过重置按钮恢复，不写入服务端或浏览器存储。
    return notices.filter((item) => action.type === "snooze" ? item.id !== action.id : item.groupKey !== action.groupKey)
  }
  return notices.map((item) => {
    const readGroup = action.type === "readAll" || (action.type === "readGroup" && item.groupKey === action.groupKey)
    const items = item.items?.map((child) => readGroup || (action.type === "read" && child.id === action.id) ? { ...child, read: true } : child)
    return {
      ...item,
      read: items ? items.every((child) => child.read) : item.read || readGroup || (action.type === "read" && item.id === action.id),
      ...(items ? { items } : {}),
    }
  })
}
