"use client"

import { useEffect, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowUp,
  ChevronRight,
  Download,
  FileArchive,
  FileCode,
  FileText,
  Folder,
  HardDrive,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Client } from "@/components/clients/client-data"
import { useServerData } from "@/components/server-data-context"
import {
  buildWebSocketUrl,
  FILE_CHUNK_BYTES,
  FILE_MAX_BYTES,
  formatRemoteTime,
  formatTransferBytes,
  fromBase64,
  isValidSha256,
  joinWindowsPath,
  parentWindowsPath,
  parseFileServerMessage,
  sha256Hex,
  splitWindowsPath,
  toBase64,
  type FileServerMessage,
  type FileSessionResponse,
  type RemoteEntry,
  type RemoteRoot,
} from "@/lib/webssh"

type TransferStatus = "running" | "done" | "failed"
type TransferItem = {
  id: number
  name: string
  size: number
  dir: "up" | "down"
  progress: number
  received: number
  status: TransferStatus
  message: string
  path: string
}

type UploadContext = { file: File; transferId: string; targetPath: string; received: number }
type DownloadContext = {
  itemId: number
  transferId: string
  path: string
  name: string
  size: number
  expectedSha256: string
  received: number
  chunks: Uint8Array[]
  chain: Promise<void>
}

type ConnectionState = "connecting" | "ready" | "closed" | "error"

type PanelActions = {
  refresh: () => void
  list: (path: string) => void
  upload: (files: FileList | null) => void
  download: (entry: RemoteEntry) => void
  remove: (entry: RemoteEntry) => void
  reconnect: () => void
}

let transferSeq = 0

function fileIcon(name: string) {
  if (/\.(gz|tar|zip|7z)$/.test(name)) return FileArchive
  if (/\.(sh|py|js|ts|yml|yaml|conf|ps1)$/.test(name)) return FileCode
  return FileText
}

function requestId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function failureOf(error: unknown): { message: string; code?: string; receivedBytes?: number } {
  if (error instanceof Error) {
    const enriched = error as Error & { code?: string; receivedBytes?: number }
    return { message: error.message, code: enriched.code, receivedBytes: enriched.receivedBytes }
  }
  return { message: "操作失败" }
}

function triggerBrowserDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/**
 * WebSSH 文件传输面板（真实 SFTP 替代链路）：
 * 通过 Agent 文件会话浏览目录、删除文件、分块上传/下载并按 SHA-256 校验。
 * 传输失败可在同一会话内按已确认偏移重试。
 */
export function FilesPanel({ client }: { client: Client }) {
  const { apiRequest, serverBaseUrl, serverConnection, developerPreview } = useServerData()
  const [connection, setConnection] = useState<ConnectionState>("connecting")
  const [error, setError] = useState<string | null>(null)
  const [path, setPath] = useState("")
  const [roots, setRoots] = useState<RemoteRoot[]>([])
  const [entries, setEntries] = useState<RemoteEntry[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [transfers, setTransfers] = useState<TransferItem[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const actionsRef = useRef<PanelActions | null>(null)
  const retryRef = useRef<Map<number, () => void>>(new Map())

  useEffect(() => {
    if (developerPreview) {
      setConnection("error")
      setError("开发者预览模式使用演示数据，不支持真实文件传输。")
      return
    }
    if (!serverConnection) {
      setConnection("error")
      setError("尚未配置控制服务端连接。")
      return
    }

    let disposed = false
    let sessionId: string | null = null
    let ws: WebSocket | null = null
    let intentional = false
    let ready = false
    let agentAttached = false
    let reconnectAttempts = 0
    let reconnectTimer: number | null = null
    let initialized = false
    let currentPath = ""
    const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>()
    const uploads = new Map<number, UploadContext>()
    const downloads = new Map<string, DownloadContext>()

    const updateTransfer = (itemId: number, patch: Partial<TransferItem>) => {
      if (disposed) return
      setTransfers((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...patch } : item)))
    }

    const addTransferItem = (item: TransferItem) => {
      if (disposed) return
      setTransfers((prev) => [...prev, item].slice(-20))
    }

    const failRunningTransfers = (message: string) => {
      setTransfers((prev) =>
        prev.map((item) =>
          item.status === "running"
            ? { ...item, status: "failed", message }
            : item,
        ),
      )
    }

    const send = (message: Record<string, unknown>): boolean => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false
      try {
        ws.send(JSON.stringify(message))
        return true
      } catch {
        return false
      }
    }

    const rpc = <T,>(message: Record<string, unknown>, timeoutMs = 20_000): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const id = requestId()
        const timer = window.setTimeout(() => {
          pending.delete(id)
          reject(new Error("操作超时，请检查 Agent 会话"))
        }, timeoutMs)
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
        if (!send({ ...message, id })) {
          window.clearTimeout(timer)
          pending.delete(id)
          reject(new Error("文件通道未连接"))
        }
      })

    const settlePending = (id: string, settle: (entry: { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }) => void) => {
      const entry = pending.get(id)
      if (!entry) return
      pending.delete(id)
      window.clearTimeout(entry.timer)
      settle(entry)
    }

    const loadList = async (targetPath: string, quiet = false) => {
      if (!ready || !agentAttached || disposed) return
      if (!quiet) setLoading(true)
      else setRefreshing(true)
      try {
        const result = await rpc<{ path: string; entries: RemoteEntry[]; truncated: boolean }>({ kind: "list", path: targetPath })
        if (disposed) return
        currentPath = result.path
        setPath(result.path)
        setEntries(result.entries)
        setTruncated(result.truncated)
        setError(null)
      } catch (caught) {
        if (!disposed) setError(failureOf(caught).message)
      } finally {
        if (!disposed) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    const initialize = async () => {
      if (initialized || !ready || !agentAttached || disposed) return
      initialized = true
      setLoading(true)
      try {
        const result = await rpc<{ roots: RemoteRoot[] }>({ kind: "roots" }, 15_000)
        if (disposed) return
        setRoots(result.roots)
        const target = currentPath || result.roots[0]?.path
        if (target) await loadList(target)
        else setError("Agent 未返回可用的本地驱动器。")
      } catch (caught) {
        initialized = false
        if (!disposed) setError(failureOf(caught).message)
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    const finishDownload = async (context: DownloadContext) => {
      downloads.delete(context.transferId)
      if (disposed) return
      const blob = new Blob(context.chunks.map((chunk) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer))
      if (blob.size !== context.size) {
        updateTransfer(context.itemId, { status: "failed", message: "下载字节数与声明大小不一致" })
        return
      }
      if (context.size <= 64 * 1024 * 1024 && isValidSha256(context.expectedSha256)) {
        try {
          const actual = await sha256Hex(await blob.arrayBuffer())
          if (actual !== context.expectedSha256) {
            updateTransfer(context.itemId, { status: "failed", message: "整文件 SHA-256 校验失败" })
            return
          }
        } catch {
          updateTransfer(context.itemId, { status: "failed", message: "下载内容校验失败" })
          return
        }
      }
      if (disposed) return
      triggerBrowserDownload(blob, context.name)
      updateTransfer(context.itemId, {
        status: "done",
        progress: 100,
        received: context.size,
        message: context.size <= 64 * 1024 * 1024 ? "完整性与 SHA-256 校验通过" : "分块校验通过",
      })
    }

    const startDownload = (itemId: number, targetPath: string, name: string, transferId: string, offset: number, chunks: Uint8Array[] = []) => {
      const context: DownloadContext = {
        itemId,
        transferId,
        path: targetPath,
        name,
        size: 0,
        expectedSha256: "",
        received: offset,
        chunks,
        chain: Promise.resolve(),
      }
      downloads.set(transferId, context)
      updateTransfer(itemId, { status: "running", progress: 0, received: offset, message: offset > 0 ? "从断点继续下载…" : "" })
      retryRef.current.delete(itemId)
      void rpc<FileServerMessage>({ kind: "download", transferId, path: targetPath, offset }, 30_000).catch((caught: unknown) => {
        const failure = failureOf(caught)
        if (downloads.has(transferId)) {
          updateTransfer(itemId, { status: "failed", message: failure.message })
          retryRef.current.set(itemId, () => startDownload(itemId, targetPath, name, transferId, context.received, context.chunks))
        }
      })
    }

    const handleMessage = (message: FileServerMessage) => {
      switch (message.kind) {
        case "ready":
          ready = true
          sessionId = message.sessionId
          agentAttached = message.agentAttached
          reconnectAttempts = 0
          setConnection("ready")
          setError(null)
          if (agentAttached) void initialize()
          return
        case "agent-connected":
          agentAttached = true
          setConnection("ready")
          void initialize()
          return
        case "closed":
          ready = false
          agentAttached = false
          intentional = true
          setConnection("closed")
          setError(message.error ?? `文件会话已结束（${message.reason}）`)
          failRunningTransfers("会话已结束")
          return
        case "downloadStart": {
          const context = downloads.get(message.transferId)
          if (context) {
            context.size = message.size
            context.name = message.name
            context.expectedSha256 = message.sha256
            updateTransfer(context.itemId, { size: message.size, name: message.name })
          }
          if (message.id) settlePending(message.id, (entry) => entry.resolve(message))
          return
        }
        case "downloadChunk": {
          const context = downloads.get(message.transferId)
          if (!context) return
          context.chain = context.chain.then(async () => {
            if (!downloads.has(message.transferId)) return
            try {
              const chunk = fromBase64(message.data)
              if (message.offset !== context.received) throw new Error("下载分块偏移不连续")
              if (!isValidSha256(message.sha256)) throw new Error("下载分块缺少校验值")
              const digest = await sha256Hex(chunk)
              if (digest !== message.sha256) throw new Error("下载分块 SHA-256 校验失败")
              context.chunks.push(chunk)
              context.received += chunk.length
              updateTransfer(context.itemId, {
                received: context.received,
                progress: context.size > 0 ? Math.min(100, Math.round((context.received / context.size) * 100)) : 0,
              })
            } catch (caught) {
              downloads.delete(context.transferId)
              updateTransfer(context.itemId, { status: "failed", message: failureOf(caught).message })
              retryRef.current.set(context.itemId, () => {
                startDownload(context.itemId, context.path, context.name, context.transferId, context.received, context.chunks)
              })
            }
          })
          return
        }
        case "downloadComplete": {
          const context = downloads.get(message.transferId)
          if (!context) return
          if (message.id) settlePending(message.id, (entry) => entry.resolve(message))
          void context.chain.then(() => finishDownload(context))
          return
        }
        case "error": {
          const failure = new Error(message.message) as Error & { code?: string; receivedBytes?: number }
          failure.code = message.code
          failure.receivedBytes = message.receivedBytes
          if (message.id) settlePending(message.id, (entry) => entry.reject(failure))
          else setError(message.message)
          return
        }
        default:
          if ("id" in message && message.id) {
            settlePending(message.id, (entry) => entry.resolve(message))
          }
          return
      }
    }

    const openSocket = (response: FileSessionResponse) => {
      if (disposed || !serverConnection) return
      sessionId = response.session.id
      const url = buildWebSocketUrl(serverBaseUrl, response.wsPath)
      try {
        ws = new WebSocket(url)
      } catch {
        setConnection("error")
        setError("无法建立文件通道 WebSocket")
        return
      }
      setConnection("connecting")
      ws.onmessage = (event) => {
        if (typeof event.data !== "string") return
        const message = parseFileServerMessage(event.data)
        if (message) handleMessage(message)
      }
      ws.onclose = () => {
        ready = false
        agentAttached = false
        if (intentional || disposed) return
        for (const [id, entry] of pending) {
          window.clearTimeout(entry.timer)
          entry.reject(new Error("文件通道已断开"))
          pending.delete(id)
        }
        setConnection("closed")
        setError("文件通道已断开")
        failRunningTransfers("连接中断，请重试")
        if (sessionId && reconnectAttempts < 2) {
          reconnectAttempts += 1
          reconnectTimer = window.setTimeout(() => {
            if (!disposed && !intentional) void connect(sessionId ?? undefined)
          }, 1000 * reconnectAttempts)
        }
      }
      ws.onerror = () => { /* close 事件处理 */ }
    }

    const connect = async (reconnectId?: string) => {
      if (disposed) return
      setConnection("connecting")
      setError(null)
      initialized = false
      try {
        const response = reconnectId
          ? await apiRequest<FileSessionResponse>(`/files/sessions/${encodeURIComponent(reconnectId)}/reconnect`, { method: "POST" })
          : await apiRequest<FileSessionResponse>(`/clients/${encodeURIComponent(client.id)}/files/sessions`, { method: "POST" })
        if (disposed) return
        openSocket(response)
      } catch (caught) {
        if (reconnectId && !disposed) {
          try {
            const fresh = await apiRequest<FileSessionResponse>(`/clients/${encodeURIComponent(client.id)}/files/sessions`, { method: "POST" })
            if (!disposed) {
              openSocket(fresh)
              return
            }
          } catch { /* 回落到下方错误提示 */ }
        }
        if (!disposed) {
          setConnection("error")
          setError(failureOf(caught).message)
        }
      }
    }

    const runUpload = async (itemId: number, file: File, targetPath: string, transferId: string, startOffset: number) => {
      let offset = startOffset
      let restarted = false
      try {
        while (true) {
          try {
            const opened = await rpc<{ receivedBytes: number }>(
              { kind: "upload", transferId, path: targetPath, size: file.size, offset },
              30_000,
            )
            offset = opened.receivedBytes
            const context = uploads.get(itemId)
            if (context) context.received = offset
            updateTransfer(itemId, {
              status: "running",
              received: offset,
              progress: file.size > 0 ? Math.min(100, Math.round((offset / file.size) * 100)) : 0,
              message: offset > 0 ? "从断点继续上传…" : "",
            })
            while (offset < file.size) {
              const slice = file.slice(offset, Math.min(file.size, offset + FILE_CHUNK_BYTES))
              const bytes = new Uint8Array(await slice.arrayBuffer())
              const digest = await sha256Hex(bytes)
              const ack = await rpc<{ receivedBytes: number }>(
                { kind: "uploadChunk", transferId, offset, data: toBase64(bytes), sha256: digest },
                60_000,
              )
              offset = ack.receivedBytes
              if (uploads.get(itemId)) uploads.get(itemId)!.received = offset
              updateTransfer(itemId, {
                received: offset,
                progress: file.size > 0 ? Math.min(100, Math.round((offset / file.size) * 100)) : 0,
              })
            }
            const completed = await rpc<{ sha256: string; size: number }>(
              { kind: "uploadComplete", transferId, size: file.size },
              60_000,
            )
            updateTransfer(itemId, {
              status: "done",
              progress: 100,
              received: file.size,
              message: isValidSha256(completed.sha256) ? `整文件 SHA-256 ${completed.sha256.slice(0, 12)}…` : "上传完成",
            })
            uploads.delete(itemId)
            retryRef.current.delete(itemId)
            void loadList(currentPath, true)
            return
          } catch (caught) {
            const failure = failureOf(caught)
            const resumable = failure.code === "OFFSET_MISMATCH" || failure.code === "TRANSFER_NOT_OPENED"
            if (!restarted && resumable) {
              restarted = true
              offset = failure.receivedBytes ?? 0
              continue
            }
            throw caught
          }
        }
      } catch (caught) {
        const failure = failureOf(caught)
        updateTransfer(itemId, { status: "failed", message: failure.message })
        retryRef.current.set(itemId, () => {
          const context = uploads.get(itemId)
          void runUpload(itemId, file, targetPath, transferId, context?.received ?? offset)
        })
      }
    }

    const refresh = () => {
      if (currentPath) void loadList(currentPath, true)
    }

    actionsRef.current = {
      refresh,
      list: (targetPath: string) => {
        if (targetPath) void loadList(targetPath)
      },
      upload: (files: FileList | null) => {
        if (!files?.length) return
        for (const file of Array.from(files)) {
          if (file.size > FILE_MAX_BYTES) {
            const itemId = ++transferSeq
            addTransferItem({
              id: itemId,
              name: file.name,
              size: file.size,
              dir: "up",
              progress: 0,
              received: 0,
              status: "failed",
              message: "文件超过 512 MiB 传输上限",
              path: currentPath,
            })
            continue
          }
          const itemId = ++transferSeq
          const transferId = crypto.randomUUID()
          const targetPath = joinWindowsPath(currentPath, file.name)
          uploads.set(itemId, { file, transferId, targetPath, received: 0 })
          addTransferItem({
            id: itemId,
            name: file.name,
            size: file.size,
            dir: "up",
            progress: 0,
            received: 0,
            status: "running",
            message: "",
            path: targetPath,
          })
          void runUpload(itemId, file, targetPath, transferId, 0)
        }
      },
      download: (entry: RemoteEntry) => {
        if (entry.type !== "file") return
        const itemId = ++transferSeq
        const transferId = crypto.randomUUID()
        const targetPath = joinWindowsPath(currentPath, entry.name)
        addTransferItem({
          id: itemId,
          name: entry.name,
          size: entry.size ?? 0,
          dir: "down",
          progress: 0,
          received: 0,
          status: "running",
          message: "",
          path: targetPath,
        })
        startDownload(itemId, targetPath, entry.name, transferId, 0)
      },
      remove: (entry: RemoteEntry) => {
        if (entry.type !== "file") return
        const targetPath = joinWindowsPath(currentPath, entry.name)
        if (!window.confirm(`确定要删除远程文件吗？\n${targetPath}`)) return
        void rpc({ kind: "delete", path: targetPath })
          .then(() => {
            if (!disposed) setEntries((prev) => prev.filter((item) => item.name !== entry.name))
          })
          .catch((caught: unknown) => {
            if (!disposed) setError(failureOf(caught).message)
          })
      },
      reconnect: () => {
        reconnectAttempts = 0
        void connect(sessionId ?? undefined)
      },
    }

    // 开发模式的 StrictMode 会立即卸载并重新挂载效果；延迟建立会话，避免双创建。
    const startTimer = window.setTimeout(() => {
      if (!disposed && !intentional) void connect()
    }, 80)

    return () => {
      disposed = true
      intentional = true
      window.clearTimeout(startTimer)
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      for (const entry of pending.values()) {
        window.clearTimeout(entry.timer)
        entry.reject(new Error("文件会话已关闭"))
      }
      pending.clear()
      downloads.clear()
      uploads.clear()
      try { ws?.close() } catch { /* 已关闭 */ }
      ws = null
      if (sessionId) {
        void apiRequest(`/files/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch(() => {})
      }
      actionsRef.current = null
    }
    // connect/loadList 均为当前副作用内的闭包，依赖只需在会话主体变化时重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiRequest, client.id, developerPreview, serverBaseUrl, serverConnection])

  const crumbs = splitWindowsPath(path)
  const activeTransfers = transfers.filter((item) => item.status === "running")
  const canOperate = connection === "ready" && !loading

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => actionsRef.current?.list(parentWindowsPath(path))}
          disabled={!canOperate || !path || parentWindowsPath(path) === path}
          aria-label="上级目录"
          title="上级目录"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35 disabled:hover:bg-transparent"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <nav aria-label="远程路径" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto font-mono text-xs">
          {crumbs.map((crumb, index) => (
            <span key={crumb.path} className="flex shrink-0 items-center gap-0.5">
              {index > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
              <button
                type="button"
                onClick={() => actionsRef.current?.list(crumb.path)}
                disabled={!canOperate}
                className={cn(
                  "rounded px-1 py-0.5 transition-colors",
                  index === crumbs.length - 1 ? "text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {crumb.name}
              </button>
            </span>
          ))}
          {!path && <span className="text-muted-foreground/60">读取驱动器…</span>}
        </nav>
        {roots.length > 1 && (
          <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
            <HardDrive className="h-3.5 w-3.5" />
            <select
              value={roots.find((root) => path.startsWith(root.path))?.path ?? ""}
              onChange={(event) => actionsRef.current?.list(event.target.value)}
              disabled={!canOperate}
              className="h-7 rounded-lg border border-border bg-surface px-1.5 font-mono text-[11px] text-foreground outline-none focus:ring-1 focus:ring-primary/50"
            >
              {roots.map((root) => (
                <option key={root.path} value={root.path}>{root.label}</option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={() => actionsRef.current?.refresh()}
          disabled={!canOperate}
          aria-label="刷新目录"
          title="刷新目录"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!canOperate || !path}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <UploadCloud className="h-3.5 w-3.5" />
          上传
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="sr-only"
          aria-label="选择要上传的文件"
          onChange={(event) => {
            actionsRef.current?.upload(event.target.files)
            if (fileRef.current) fileRef.current.value = ""
          }}
        />
      </div>

      {connection !== "ready" && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-warning/10 px-3 py-2 text-xs text-warning">
          {connection === "connecting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          <span className="min-w-0 flex-1 truncate">
            {connection === "connecting" ? "正在建立文件会话…" : error || "文件会话不可用"}
          </span>
          {connection !== "connecting" && (
            <button
              type="button"
              onClick={() => actionsRef.current?.reconnect()}
              className="flex shrink-0 items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-medium"
            >
              <RotateCcw className="h-3 w-3" />
              重连
            </button>
          )}
        </div>
      )}
      {connection === "ready" && error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-warning/10 px-3 py-1.5 text-[11px] text-warning">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="关闭提示" className="shrink-0">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="min-h-[280px] flex-1 overflow-y-auto">
        {loading && entries.length === 0 && (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取远程目录…
          </div>
        )}
        {!loading && entries.length === 0 && connection === "ready" && (
          <p className="p-4 text-sm text-muted-foreground/70">空目录 · 点击右上角「上传」将文件传到 {client.name}</p>
        )}
        {entries.length > 0 && (
          <table className="w-full text-sm">
            <tbody>
              {entries.map((entry) => {
                const Icon = entry.type === "dir" ? Folder : fileIcon(entry.name)
                return (
                  <tr key={entry.name} className="group border-b border-border/40 transition-colors last:border-b-0 hover:bg-surface">
                    <td className="w-full py-0 pl-3">
                      {entry.type === "dir" ? (
                        <button
                          type="button"
                          onClick={() => actionsRef.current?.list(joinWindowsPath(path, entry.name))}
                          className="flex w-full items-center gap-2.5 py-2 text-left"
                        >
                          <Icon className="h-4 w-4 shrink-0 text-primary/80" />
                          <span className="truncate font-medium">{entry.name}/</span>
                        </button>
                      ) : (
                        <span className="flex items-center gap-2.5 py-2">
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{entry.name}</span>
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 text-right font-mono text-xs text-muted-foreground">
                      {entry.type === "file" ? formatTransferBytes(entry.size) : ""}
                    </td>
                    <td className="hidden whitespace-nowrap px-2 font-mono text-xs text-muted-foreground/70 md:table-cell">
                      {formatRemoteTime(entry.mtimeUtc)}
                    </td>
                    <td className="pr-2">
                      {entry.type === "file" && (
                        <span className="flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => actionsRef.current?.download(entry)}
                            aria-label={`下载 ${entry.name}`}
                            title="下载"
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => actionsRef.current?.remove(entry)}
                            aria-label={`删除 ${entry.name}`}
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
        )}
        {truncated && (
          <p className="px-3 py-2 text-[11px] text-warning">目录条目超过 2000 项，仅显示前 2000 项。</p>
        )}
      </div>

      {transfers.length > 0 && (
        <div className="shrink-0 border-t border-border px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[11px] font-medium text-muted-foreground">
              传输队列{activeTransfers.length > 0 && ` · ${activeTransfers.length} 进行中`}
            </p>
            <button
              type="button"
              onClick={() => setTransfers((prev) => prev.filter((item) => item.status !== "done"))}
              className="flex h-5 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
              清除已完成
            </button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {transfers.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                {item.dir === "up" ? (
                  <UploadCloud className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={item.message || item.path}>
                  {item.name}
                </span>
                <span className="hidden w-28 shrink-0 text-right font-mono text-[10px] text-muted-foreground/70 sm:block">
                  {formatTransferBytes(item.received)} / {formatTransferBytes(item.size)}
                </span>
                <span className="w-24 shrink-0 sm:w-32">
                  <span className="block h-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn(
                        "block h-full rounded-full transition-all duration-200",
                        item.status === "done" ? "bg-positive" : item.status === "failed" ? "bg-negative" : "bg-primary",
                      )}
                      style={{ width: `${Math.max(2, Math.min(100, item.progress))}%` }}
                    />
                  </span>
                </span>
                <span className="w-14 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                  {item.status === "done" ? "完成" : item.status === "failed" ? "失败" : `${Math.round(item.progress)}%`}
                </span>
                {item.status === "failed" && retryRef.current.has(item.id) && (
                  <button
                    type="button"
                    onClick={() => retryRef.current.get(item.id)?.()}
                    aria-label={`重试 ${item.name}`}
                    title="重试"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
