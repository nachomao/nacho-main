import { osLogoPaths, windowsLegacyPath, windowsLegacyViewBox } from "./os-logo-paths"
import type { Client } from "./client-data"

/**
 * 系统品牌标识解析：优先使用 agent 上报的具体系统名（osName），
 * 例如 "Windows 11 Pro"、"ubuntu"、"debian"，据此匹配到对应发行版 logo；
 * 未上报或无法识别时回落到 os 字段对应的通用标识。
 */
export type OsBrand = {
  /** 展示用名称，如 Windows 11 / Ubuntu */
  label: string
  /** 24x24 路径（Windows 旧版为 88x88，viewBox 随之调整） */
  path: string
  viewBox: string
  /** 品牌主色，用于图标底色 */
  color: string
}

const brands = {
  win11: { label: "Windows 11", path: osLogoPaths.win11, viewBox: "0 0 24 24", color: "oklch(0.62 0.17 245)" },
  winLegacy: { label: "Windows", path: windowsLegacyPath, viewBox: windowsLegacyViewBox, color: "oklch(0.62 0.17 245)" },
  macos: { label: "macOS", path: osLogoPaths.macos, viewBox: "0 0 24 24", color: "oklch(0.55 0.01 250)" },
  linux: { label: "Linux", path: osLogoPaths.linux, viewBox: "0 0 24 24", color: "oklch(0.72 0.16 75)" },
  ubuntu: { label: "Ubuntu", path: osLogoPaths.ubuntu, viewBox: "0 0 24 24", color: "oklch(0.62 0.19 38)" },
  debian: { label: "Debian", path: osLogoPaths.debian, viewBox: "0 0 24 24", color: "oklch(0.5 0.19 12)" },
  centos: { label: "CentOS", path: osLogoPaths.centos, viewBox: "0 0 24 24", color: "oklch(0.42 0.2 275)" },
  kali: { label: "Kali Linux", path: osLogoPaths.kali, viewBox: "0 0 24 24", color: "oklch(0.55 0.06 235)" },
  fedora: { label: "Fedora", path: osLogoPaths.fedora, viewBox: "0 0 24 24", color: "oklch(0.62 0.14 245)" },
  arch: { label: "Arch Linux", path: osLogoPaths.arch, viewBox: "0 0 24 24", color: "oklch(0.6 0.15 235)" },
  rhel: { label: "Red Hat", path: osLogoPaths.rhel, viewBox: "0 0 24 24", color: "oklch(0.56 0.23 27)" },
  alpine: { label: "Alpine Linux", path: osLogoPaths.alpine, viewBox: "0 0 24 24", color: "oklch(0.46 0.1 230)" },
  opensuse: { label: "openSUSE", path: osLogoPaths.opensuse, viewBox: "0 0 24 24", color: "oklch(0.63 0.19 140)" },
  rocky: { label: "Rocky Linux", path: osLogoPaths.rocky, viewBox: "0 0 24 24", color: "oklch(0.65 0.16 165)" },
  alma: { label: "AlmaLinux", path: osLogoPaths.alma, viewBox: "0 0 24 24", color: "oklch(0.55 0.15 30)" },
  mint: { label: "Linux Mint", path: osLogoPaths.mint, viewBox: "0 0 24 24", color: "oklch(0.68 0.16 140)" },
  manjaro: { label: "Manjaro", path: osLogoPaths.manjaro, viewBox: "0 0 24 24", color: "oklch(0.68 0.13 175)" },
  deepin: { label: "deepin", path: osLogoPaths.deepin, viewBox: "0 0 24 24", color: "oklch(0.58 0.19 255)" },
  freebsd: { label: "FreeBSD", path: osLogoPaths.freebsd, viewBox: "0 0 24 24", color: "oklch(0.5 0.19 25)" },
} satisfies Record<string, OsBrand>

type BrandKey = keyof typeof brands

/** 发行版关键字 -> 品牌，按出现顺序匹配（长关键字在前，避免误判） */
const distroKeywords: [string, BrandKey][] = [
  ["ubuntu", "ubuntu"],
  ["kubuntu", "ubuntu"],
  ["xubuntu", "ubuntu"],
  ["linuxmint", "mint"],
  ["linux mint", "mint"],
  ["mint", "mint"],
  ["debian", "debian"],
  ["raspbian", "debian"],
  ["almalinux", "alma"],
  ["alma", "alma"],
  ["rocky", "rocky"],
  ["centos", "centos"],
  ["kali", "kali"],
  ["fedora", "fedora"],
  ["manjaro", "manjaro"],
  ["arch", "arch"],
  ["rhel", "rhel"],
  ["red hat", "rhel"],
  ["redhat", "rhel"],
  ["oracle linux", "rhel"],
  ["alpine", "alpine"],
  ["opensuse", "opensuse"],
  ["suse", "opensuse"],
  ["deepin", "deepin"],
  ["uos", "deepin"],
  ["freebsd", "freebsd"],
]

/** 由 os + osName 解析出品牌标识 */
export function resolveOsBrand(os: Client["os"], osName?: string | null): OsBrand {
  const name = (osName ?? "").trim()
  const lower = name.toLowerCase()

  if (os === "Windows") {
    // Windows 11 内部版本号从 22000 起，agent 可直接上报 "Windows 11 ..." 或构建号
    const build = Number(lower.match(/\b(\d{5})\b/)?.[1] ?? 0)
    if (lower.includes("windows 11") || build >= 22000) {
      return { ...brands.win11, label: name || brands.win11.label }
    }
    return { ...brands.winLegacy, label: name || brands.winLegacy.label }
  }

  if (os === "macOS") {
    return { ...brands.macos, label: name || brands.macos.label }
  }

  for (const [keyword, key] of distroKeywords) {
    if (lower.includes(keyword)) {
      return { ...brands[key], label: name || brands[key].label }
    }
  }
  return { ...brands.linux, label: name || brands.linux.label }
}

/** 渲染系统品牌 logo，颜色继承父级 currentColor */
export function OsLogo({ brand, className }: { brand: OsBrand; className?: string }) {
  return (
    <svg
      viewBox={brand.viewBox}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={brand.path} />
    </svg>
  )
}
