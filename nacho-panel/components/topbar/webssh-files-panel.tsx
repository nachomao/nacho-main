"use client"

import { useEffect, useRef, useState } from "react"
import {
  Folder,
  FileText,
  FileArchive,
  FileCode,
  Download,
  Trash2,
  UploadCloud,
  ChevronRight,
  ArrowUp,
  RefreshCw,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Client } from "@/components/clients/client-data"

/** 远程文件条目（演示数据） */
type RemoteEntry = {
  name: string
  type: "dir" | "file"
  size?: number
  mtime: string
}

/** 传输任务 */
type TransferItem = {
  id: number
  name: string
  size: number
  dir: "up" | "down"
  progress: number // 0-100
  done: boolean
}

let transferId = 0

/** 模拟的远程目录树：key 为路径（如 "/root" "/root/logs"） */
const MOCK_FS: Record<string, RemoteEntry[]> = {
  "/root": [
    { name: "backups", type: "dir", mtime: "2026-07-08 22:10" },
    { name: "data", type: "dir", mtime: "2026-07-09 03:44" },
    { name: "logs", type: "dir", mtime: "2026-07-10 09:12" },
    { name: "scripts", type: "dir", mtime: "2026-06-30 18:02" },
    { name: "docker-compose.yml", type: "file", size: 2867, mtime: "2026-07-01 14:20" },
    { name: "nacho-agent.conf", type: "file", size: 412, mtime: "2026-06-16 09:20" },
  ],
  "/root/backups": [
    { name: "db-2026-07-08.sql.gz", type: "file", size: 48_234_211, mtime: "2026-07-08 22:10" },
    { name: "db-2026-07-01.sql.gz", type: "file", size: 47_102_887, mtime: "2026-07-01 22:10" },
    { name: "config-backup.tar.gz", type: "file", size: 1_204_855, mtime: "2026-06-28 02:00" },
  ],
  "/root/data": [
    { name: "uploads", type: "dir", mtime: "2026-07-09 03:44" },
    { name: "cache.db", type: "file", size: 8_912_004, mtime: "2026-07-10 08:55" },
  ],
  "/root/data/uploads": [
    { name: "report-q2.pdf", type: "file", size: 3_412_990, mtime: "2026-07-02 11:31" },
  ],
  "/root/logs": [
    { name: "app.log", type: "file", size: 1_820_443, mtime: "2026-07-10 09:12" },
    { name: "nginx-access.log", type: "file", size: 12_038_112, mtime: "2026-07-10 09:12" },
    { name: "nginx-error.log", type: "file", size: 88_204, mtime: "2026-07-09 23:47" },
  ],
  "/root/scripts": [
    { name: "deploy.sh", type: "file", size: 1_204, mtime: "2026-06-30 18:02" },
    { name: "healthcheck.py", type: "file", size: 3_388, mtime: "2026-06-22 10:15" },
  ],
}

function formatSize(bytes?: number) {
  if (bytes === undefined) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function fileIcon(name: string) {
  if (/\.(gz|tar|zip|7z)$/.test(name)) return FileArchive
  if (/\.(sh|py|js|ts|yml|yaml|conf)$/.test(name)) return FileCode
  return FileText
}

/**
 * WebSSH 文件传输面板（SFTP 演示）：
 * 远程目录浏览 + 上传（真实文件选择、模拟进度）+ 下载/删除 + 传输队列。
 * 每个客户端的目录状态由父组件按 client.id 缓存（组件内部自管理，卸载即重置）。
 */
export function FilesPanel({ client }: { client: Client }) {
  const [path, setPath] = useState("/root")
  // 本地覆盖层：记录上传新增和删除的文件，让操作有真实反馈
  const [added, setAdded] = useState<Record<string, RemoteEntry[]>>({})
  const [removed, setRemoved] = useState<Record<string, string[]>>({})
  const [transfers, setTransfers] = useState<TransferItem[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const timersRef = useRef<ReturnType<typeof setInterval>[]>([])

  useEffect(() => () => timersRef.current.forEach(clearInterval), [])

  const entries = [...(MOCK_FS[path] ?? []), ...(added[path] ?? [])]
    .filter((e) => !(removed[path] ?? []).includes(e.name))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1))

  const crumbs = path.split("/").filter(Boolean)

  /** 启动一个模拟进度的传输任务 */
  const startTransfer = (name: string, size: number, dir: "up" | "down", onDone?: () => void) => {
    const id = ++transferId
    setTransfers((prev) => [...prev.slice(-4), { id, name, size, dir, progress: 0, done: false }])
    // 大文件走更多步进，速度稳定在 8-25MB/s 左右的观感
    const step = Math.max(6, Math.min(34, Math.round(12_000_000 / Math.max(size, 200_000))))
    const timer = setInterval(() => {
      setTransfers((prev) =>
        prev.map((t) => {
          if (t.id !== id || t.done) return t
          const next = Math.min(100, t.progress + step + Math.random() * 6)
          if (next >= 100) {
            clearInterval(timer)
            onDone?.()
            return { ...t, progress: 100, done: true }
          }
          return { ...t, progress: next }
        }),
      )
    }, 180)
    timersRef.current.push(timer)
  }

  const handleUpload = (files: FileList | null) => {
    if (!files?.length) return
    Array.from(files).forEach((f) => {
      startTransfer(f.name, f.size, "up", () => {
        setAdded((prev) => {
          const cur = prev[path] ?? []
          if (cur.some((e) => e.name === f.name)) return prev
          const entry: RemoteEntry = {
            name: f.name,
            type: "file",
            size: f.size,
            mtime: new Date().toLocaleString("zh-CN", { hour12: false }).slice(0, 16).replace(/\//g, "-"),
          }
          return { ...prev, [path]: [...cur, entry] }
        })
        // 若之前删除过同名文件，恢复显示
        setRemoved((prev) => ({ ...prev, [path]: (prev[path] ?? []).filter((n) => n !== f.name) }))
      })
    })
    if (fileRef.current) fileRef.current.value = ""
  }

  const handleDownload = (e: RemoteEntry) => startTransfer(e.name, e.size ?? 1024, "down")

  const handleDelete = (e: RemoteEntry) =>
    setRemoved((prev) => ({ ...prev, [path]: [...(prev[path] ?? []), e.name] }))

  const handleRefresh = () => {
    setRefreshing(true)
    setTimeout(() => setRefreshing(false), 500)
  }

  const activeTransfers = transfers.filter((t) => !t.done)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 工具栏：面包屑 + 操作 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => setPath(path.split("/").slice(0, -1).join("/") || "/root")}
          disabled={path === "/root"}
          aria-label="上级目录"
          title="上级目录"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35 disabled:hover:bg-transparent"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <nav aria-label="远程路径" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto font-mono text-xs">
          {crumbs.map((c, i) => {
            const p = "/" + crumbs.slice(0, i + 1).join("/")
            const last = i === crumbs.length - 1
            return (
              <span key={p} className="flex shrink-0 items-center gap-0.5">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
                <button
                  type="button"
                  onClick={() => setPath(p)}
                  className={cn(
                    "rounded px-1 py-0.5 transition-colors",
                    last ? "text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {c}
                </button>
              </span>
            )
          })}
        </nav>
        <button
          type="button"
          onClick={handleRefresh}
          aria-label="刷新目录"
          title="刷新目录"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <UploadCloud className="h-3.5 w-3.5" />
          上传
        </button>
        <input ref={fileRef} type="file" multiple className="sr-only" aria-label="选择要上传的文件" onChange={(e) => handleUpload(e.target.files)} />
      </div>

      {/* 文件列表 */}
      <div className="min-h-[280px] flex-1 overflow-y-auto">
        {entries.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground/70">空目录 · 点击右上角「上传」将文件传到 {client.name}</p>
        )}
        <table className="w-full text-sm">
          <tbody>
            {entries.map((e) => {
              const Icon = e.type === "dir" ? Folder : fileIcon(e.name)
              return (
                <tr key={e.name} className="group border-b border-border/40 transition-colors last:border-b-0 hover:bg-surface">
                  <td className="w-full py-0 pl-3">
                    {e.type === "dir" ? (
                      <button
                        type="button"
                        onClick={() => setPath(`${path}/${e.name}`)}
                        className="flex w-full items-center gap-2.5 py-2 text-left"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-primary/80" />
                        <span className="truncate font-medium">{e.name}/</span>
                      </button>
                    ) : (
                      <span className="flex items-center gap-2.5 py-2">
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{e.name}</span>
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 text-right font-mono text-xs text-muted-foreground">
                    {e.type === "file" ? formatSize(e.size) : ""}
                  </td>
                  <td className="hidden whitespace-nowrap px-2 font-mono text-xs text-muted-foreground/70 md:table-cell">
                    {e.mtime}
                  </td>
                  <td className="pr-2">
                    {e.type === "file" && (
                      <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => handleDownload(e)}
                          aria-label={`下载 ${e.name}`}
                          title="下载"
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(e)}
                          aria-label={`删除 ${e.name}`}
                          title="删除"
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-negative"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 传输队列 */}
      {transfers.length > 0 && (
        <div className="shrink-0 border-t border-border px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[11px] font-medium text-muted-foreground">
              传输队列{activeTransfers.length > 0 && ` · ${activeTransfers.length} 进行中`}
            </p>
            <button
              type="button"
              onClick={() => setTransfers((prev) => prev.filter((t) => !t.done))}
              className="flex h-5 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
              清除已完成
            </button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {transfers.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                {t.dir === "up" ? (
                  <UploadCloud className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{t.name}</span>
                <span className="w-32 shrink-0">
                  <span className="block h-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn("block h-full rounded-full transition-all duration-200", t.done ? "bg-positive" : "bg-primary")}
                      style={{ width: `${t.progress}%` }}
                    />
                  </span>
                </span>
                <span className="w-14 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                  {t.done ? "完成" : `${Math.round(t.progress)}%`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
