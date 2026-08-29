/**
 * 输入风险词库：识别 Linux / Windows 常见危险命令与疑似危险操作。
 * 参考社区整理的危险命令清单（如 rm -rf、fork bomb、dd 写盘、diskpart、
 * Remove-Item -Recurse -Force、reg delete 等）。
 *
 * - danger：高危，几乎必然造成破坏或不可逆后果（红色泛光）
 * - warn：疑似危险，需要谨慎确认（黄色泛光）
 */

export type InputRisk = "safe" | "warn" | "danger"

/* ---------- 高危模式（红色） ---------- */
const dangerPatterns: RegExp[] = [
  // Linux：删除根目录 / 递归强删系统路径
  /rm\s+(-[a-z]*[rf][a-z]*\s+)+(\/|\/\*|\/etc|\/usr|\/var|\/boot|\/home|--no-preserve-root)/i,
  /rm\s+-[a-z]*rf|rm\s+-[a-z]*fr/i,
  // fork bomb
  /:\(\)\s*\{\s*:\|\s*:\s*&\s*\}\s*;?\s*:/,
  // dd 直接写块设备 / 格式化 / 抹盘
  /dd\s+.*of=\/dev\/(sd|hd|nvme|vd|mmcblk)/i,
  /mkfs(\.\w+)?\s/i,
  /wipefs|shred\s+.*\/dev\//i,
  // 覆盖块设备
  />\s*\/dev\/(sd|hd|nvme|vd)\w*/i,
  // 权限炸弹
  /chmod\s+(-[a-z]+\s+)*777\s+\/(\s|$)/i,
  /chown\s+(-[a-z]+\s+)*\S+\s+\/(\s|$)/i,
  // 数据库毁灭性操作
  /drop\s+(database|table|schema)/i,
  /truncate\s+table/i,
  /delete\s+from\s+\w+\s*(;|$)(?![\s\S]*where)/i,
  // Windows：格式化 / 删盘 / 递归强删
  /format\s+[a-z]:/i,
  /del\s+(\/[fsq]\s+)*[a-z]:\\/i,
  /rd\s+\/s\s+\/q\s+[a-z]:\\/i,
  /diskpart|clean\s+all/i,
  /Remove-Item\s+.*-Recurse\s+.*-Force/i,
  /reg\s+delete\s+HKLM/i,
  /vssadmin\s+delete\s+shadows/i,
  /bcdedit\s+\/set/i,
  /cipher\s+\/w/i,
  // 中文高危意图
  /删(除|掉)?(整个|全部|所有)?(根目录|系统盘|C盘|c盘|数据库|所有数据|全部数据)/,
  /格式化.{0,6}(磁盘|硬盘|分区|C盘|c盘|系统)/,
  /(清空|抹掉|销毁).{0,6}(数据库|磁盘|硬盘|所有数据)/,
]

/* ---------- 疑似危险模式（黄色） ---------- */
const warnPatterns: RegExp[] = [
  // Linux：删除 / 杀进程 / 关机重启 / 服务停止
  /\brm\s+-/i,
  /\bkill(all)?\s+(-9\s+)?\S+/i,
  /\b(shutdown|reboot|poweroff|halt)\b/i,
  /systemctl\s+(stop|disable|mask)/i,
  /\bumount\b|\bswapoff\b/i,
  /iptables\s+(-F|--flush)/i,
  /ufw\s+disable/i,
  /crontab\s+-r/i,
  /chmod\s+(-[a-z]+\s+)*777/i,
  /curl\s+[^|]*\|\s*(sudo\s+)?(ba)?sh/i,
  /wget\s+[^|]*\|\s*(sudo\s+)?(ba)?sh/i,
  /\bmv\s+\S+\s+\/dev\/null/i,
  // Windows
  /taskkill\s+\/f/i,
  /net\s+stop/i,
  /sc\s+(stop|delete)/i,
  /shutdown\s+\/(s|r|f)/i,
  /Stop-(Service|Computer|Process)/i,
  /Set-ExecutionPolicy/i,
  /netsh\s+advfirewall\s+set\s+\w+\s+state\s+off/i,
  // SQL / 通用
  /\bdelete\s+from\b/i,
  /update\s+\w+\s+set\b/i,
  // 中文疑似危险意图
  /(删除|移除|卸载|停止|停掉|杀掉|终止|关闭)(所有|全部|这个|该)?.{0,8}(文件|目录|进程|服务|容器|日志|备份|防火墙)/,
  /(关机|重启|断电|断网|下线)/,
  /(禁用|关掉|关闭).{0,6}(防火墙|安全|杀毒|监控|告警)/,
  /强制|强删|跳过确认|不要确认|直接执行/,
]

/** 评估一段输入的风险等级 */
export function assessInputRisk(text: string): InputRisk {
  const t = text.trim()
  if (!t) return "safe"
  if (dangerPatterns.some((p) => p.test(t))) return "danger"
  if (warnPatterns.some((p) => p.test(t))) return "warn"
  return "safe"
}
