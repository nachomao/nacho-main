"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  AppWindow,
  ArrowLeft,
  CalendarClock,
  CheckCheck,
  ChevronRight,
  CircleStop,
  FolderTree,
  DownloadCloud,
  FileUp,
  FileClock,
  Globe,
  KeyRound,
  Loader2,
  MessageSquare,
  Package,
  Play,
  Plus,
  RotateCw,
  Search,
  Send,
  Server,
  SquareTerminal,
  Terminal,
  Trash2,
  Users,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Select } from "@/components/ui/select"
import type { Client } from "./client-data"
import { statusMeta } from "./client-data"
import { OsLogo, resolveOsBrand } from "./os-logos"
import { useServerData } from "@/components/server-data-context"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { ProcessMobileMenu, ProcessRowContextMenu, type ProcessMenuAction, type ProcessMenuActionOptions } from "@/components/ui/process-action-menu"
import {
  isAbsoluteWindowsExecutablePath,
  isValidProcessId,
  isValidProcessTimeout,
  parseTerminateProcessResult,
  terminalCommandStatuses,
  type CommandStatus,
} from "@/lib/terminate-process"
import {
  isValidRestartDelay,
  isValidRestartReason,
  normalizeRestartReason,
  parseRestartSystemResult,
  type RestartSystemCommand,
} from "@/lib/restart-system"
import {
  dateToUtcInput,
  isValidLogWindow,
  isValidMaxEntries,
  logSources,
  parseCollectLogsResult,
  utcInputToIso,
  type CollectLogsCommand,
  type LogSource,
} from "@/lib/collect-logs"
import {
  isValidShellScript,
  isValidShellTimeout,
  parseRunShellResult,
  type RunShellCommand,
  type ShellKind,
} from "@/lib/run-shell"
import {
  formatByteSize,
  isTerminalPackageBatch,
  parseArgumentLines,
  parsePackageInstallResult,
  parseSuccessExitCodes,
  validatePackageDraft,
  type InstallerType,
  type ManagedPackage,
  type PackageDeploymentBatch,
} from "@/lib/package-deployment"
import {
  filterAndSortServices,
  formatServiceBytes,
  parseWindowsServiceControlResult,
  parseWindowsServiceListResult,
  serviceControlRestrictionText,
  supportsServiceInventory,
  type ServiceControlAction,
  type ServiceListFilter,
  type ServiceSort,
  type WindowsServiceItem,
  type WindowsServiceListResult,
} from "@/lib/windows-service-inventory"
import {
  filterAndSortProcesses,
  formatProcessBytes,
  parseWindowsProcessListResult,
  parseRestartProcessResult,
  parseSetProcessEfficiencyResult,
  processFormSelection,
  processTerminationRestrictionText,
  supportsProcessInventory,
  supportsProcessActions,
  type ProcessSort,
  type WindowsProcessItem,
  type WindowsProcessListResult,
} from "@/lib/windows-process-inventory"
import {
  isRollbackEligible,
  isTerminalFileBatch,
  parseFileDeployResult,
  parseFileRollbackResult,
  validateFileDraft,
  type FileDeployCommand,
  type FileDeploymentBatch,
  type ManagedFile,
} from "@/lib/file-deployment"
import {
  isDeleteConfirmationValid,
  isValidLocalGroupName,
  latestLocalUserList,
  localUserConfirmation,
  localUserPayload,
  parseLocalUserResult,
  terminalLocalUserStatuses,
  type LocalUserAccount,
  type LocalUserCommand,
  type LocalUserWriteAction,
} from "@/lib/local-user-management"
import {
  inverseRegistryPayload,
  isValidRegistrySubKey,
  isValidRegistryValueName,
  latestRegistryCommand,
  parseRegistryEditorValue,
  parseRegistryResult,
  registryBinaryDecodedBytes,
  registryPayload,
  registryValueKinds,
  registryValuePreview,
  terminalRegistryStatuses,
  type RegistryCommand,
  type RegistryHive,
  type RegistryPayload,
  type RegistryResult,
  type RegistryValue,
  type RegistryValueKind,
  type RegistryView,
} from "@/lib/registry-management"
import {
  latestMessageBatch,
  messageConfirmation,
  parseMessagePushResult,
  terminalMessageStatuses,
  unicodeScalarCount,
  validMessageText,
  validMessageTimeout,
  type MessageCommand,
  type MessageSeverity,
} from "@/lib/message-push"
import {
  isValidOpenUrl,
  latestOpenUrlBatch,
  openUrlConfirmation,
  openUrlResultText,
  openUrlValidationError,
  parseOpenUrlResult,
  terminalOpenUrlStatuses,
  type OpenUrlCommand,
} from "@/lib/open-url"

type OS = "windows" | "linux"

type DetailProps = {
  os: OS
  clientId?: string
}

/* ---------- 通用样式 / 小组件 ---------- */

const inputCls =
  "h-11 w-full rounded-xl border border-border bg-surface/60 px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:bg-surface"

/* 标题文字交叉过渡：旧文字模糊渐隐，新文字模糊渐显 */
function MorphText({ text, className }: { text: string; className?: string }) {
  const [current, setCurrent] = useState(text)
  const [previous, setPrevious] = useState<string | null>(null)

  useEffect(() => {
    if (text === current) return
    setPrevious(current)
    setCurrent(text)
    const timer = setTimeout(() => setPrevious(null), 450)
    return () => clearTimeout(timer)
  }, [text, current])

  return (
    <span className="relative inline-block align-top">
      {previous !== null && (
        <span
          key={`prev-${previous}`}
          aria-hidden
          className={cn("absolute left-0 top-0 whitespace-nowrap animate-title-out", className)}
        >
          {previous}
        </span>
      )}
      <span key={`cur-${current}`} className={cn("inline-block animate-title-in", className)}>
        {current}
      </span>
    </span>
  )
}

function Field({
  label,
  icon,
  children,
}: {
  label: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      {children}
    </label>
  )
}

/* 主色执行按钮 */
function PrimaryButton({
  icon,
  children,
  disabled = false,
  onClick,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
    >
      {icon}
      {children}
    </button>
  )
}

type TargetPickerProps = DetailProps & {
  selectedIds?: string[]
  onChange?: (ids: string[]) => void
  multiple?: boolean
  onlineOnly?: boolean
}

/* 目标客户端选择器：可由业务组件受控，单机管理页固定为卡片对应客户端。 */
function TargetPicker({
  os,
  clientId,
  selectedIds,
  onChange,
  multiple = true,
  onlineOnly = true,
}: TargetPickerProps) {
  const { clients } = useServerData()
  const list = clients.filter((c) => (!onlineOnly || c.status === "online") && matchOS(c, os))
  const fixedClient = clientId ? clients.find((client) => client.id === clientId) ?? null : null
  const [internalSelected, setInternalSelected] = useState<string[]>(list[0] ? [list[0].id] : [])
  const selected = selectedIds ?? internalSelected
  const listKey = list.map((client) => client.id).join("|")

  const commit = (next: string[] | ((current: string[]) => string[])) => {
    const resolved = typeof next === "function" ? next(selected) : next
    const normalized = multiple ? Array.from(new Set(resolved)) : resolved.slice(-1)
    if (onChange) onChange(normalized)
    else setInternalSelected(normalized)
  }

  useEffect(() => {
    const validIds = new Set(list.map((client) => client.id))
    const validSelection = selected.filter((id) => validIds.has(id))
    const preferred = clientId && validIds.has(clientId) ? clientId : list[0]?.id
    const next = validSelection.length > 0 ? (multiple ? validSelection : validSelection.slice(0, 1)) : preferred ? [preferred] : []
    if (next.join("|") !== selected.join("|")) commit(next)
  }, [clientId, listKey, multiple, selected.join("|")])

  // 依据当前系统的客户端派生分组（仅显示有成员的分组）
  const groupMap = list.reduce<Record<string, string[]>>((acc, c) => {
    ;(acc[c.group] ??= []).push(c.id)
    return acc
  }, {})
  const groupNames = Object.keys(groupMap)

  const allIds = list.map((c) => c.id)
  const allSelected = allIds.length > 0 && selected.length === allIds.length

  const toggle = (id: string) =>
    commit((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : multiple ? [...prev, id] : [id]))

  const toggleAll = () => commit(allSelected ? [] : allIds)

  const groupState = (name: string): "all" | "some" | "none" => {
    const ids = groupMap[name]
    const hit = ids.filter((id) => selected.includes(id)).length
    if (hit === 0) return "none"
    if (hit === ids.length) return "all"
    return "some"
  }

  const toggleGroup = (name: string) => {
    const ids = groupMap[name]
    commit((prev) =>
      groupState(name) === "all"
        ? prev.filter((id) => !ids.includes(id)) // 整组已选 → 取消
        : Array.from(new Set([...prev, ...ids])), // 否则整组选中
    )
  }

  if (clientId) {
    const status = fixedClient ? statusMeta[fixedClient.status] : null
    return (
      <Field label="目标客户端" icon={<Users className="h-3.5 w-3.5" />}>
        {fixedClient ? (
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/8 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{fixedClient.name}</p>
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {fixedClient.hostname} · {fixedClient.ip}
              </p>
            </div>
            <span className={cn("flex shrink-0 items-center gap-1.5 text-xs font-medium", status?.text)}>
              <span className={cn("h-2 w-2 rounded-full", status?.dot)} />
              {status?.label}
            </span>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border bg-surface/40 px-4 py-3 text-xs text-muted-foreground">
            目标客户端已不在当前列表中
          </p>
        )}
      </Field>
    )
  }

  return (
    <Field
      label={`目标客户端（已选 ${selected.length} / ${list.length}）`}
      icon={<Users className="h-3.5 w-3.5" />}
    >
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface/40 px-4 py-3 text-xs text-muted-foreground">
          暂无 {os === "windows" ? "Windows" : "Linux"} 客户端在线
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* 一键全选 + 按分组选择 */}
          {multiple && <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleAll}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200",
                allSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-primary/50 bg-primary/10 text-primary hover:bg-primary/15",
              )}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {allSelected ? "取消全选" : "全选"}
            </button>

            {groupNames.length > 1 && <span className="h-4 w-px bg-border" />}

            {groupNames.length > 1 &&
              groupNames.map((name) => {
                const state = groupState(name)
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleGroup(name)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200",
                      state === "all"
                        ? "border-primary bg-primary/15 text-primary"
                        : state === "some"
                          ? "border-primary/50 bg-primary/8 text-primary"
                          : "border-border bg-surface/60 text-muted-foreground hover:bg-surface",
                    )}
                  >
                    <FolderTree className="h-3.5 w-3.5" />
                    {name}
                    <span className="text-[10px] opacity-70">
                      {groupMap[name].filter((id) => selected.includes(id)).length}/{groupMap[name].length}
                    </span>
                  </button>
                )
              })}
          </div>}

          {/* 单个客户端 */}
          <div className="flex flex-wrap gap-2">
            {list.map((c) => {
              const on = selected.includes(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition-all duration-200",
                    on
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-surface/60 text-muted-foreground hover:bg-surface",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-primary" : "bg-muted-foreground/50")} />
                  {c.name}
                  <span className="text-[10px] opacity-60">{c.group}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Field>
  )
}

/* ---------- 子功能：批量安装 ---------- */
function BatchInstall({ os, clientId }: DetailProps) {
  const { clients, apiRequest, uploadRequest } = useServerData()
  const { confirm } = useConfirm()
  const [packages, setPackages] = useState<ManagedPackage[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>(clientId ? [clientId] : [])
  const [showUpload, setShowUpload] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [displayName, setDisplayName] = useState("")
  const [version, setVersion] = useState("")
  const [installerType, setInstallerType] = useState<InstallerType>("exe")
  const [argumentsText, setArgumentsText] = useState("")
  const [successCodesText, setSuccessCodesText] = useState("0")
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [timeoutSeconds, setTimeoutSeconds] = useState(1800)
  const [batch, setBatch] = useState<PackageDeploymentBatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const eligibleClientIds = clients.filter((client) => client.status === "online" && matchOS(client, "windows")).map((client) => client.id)
  const eligibleKey = eligibleClientIds.join("|")

  const loadPackages = async () => {
    const next = await apiRequest<ManagedPackage[]>("/managed-artifacts?kind=package")
    setPackages(next)
    setPicked((current) => current.filter((id) => next.some((item) => item.id === id && item.status === "ready")))
  }

  useEffect(() => {
    if (os !== "windows") return
    let active = true
    Promise.all([
      apiRequest<ManagedPackage[]>("/managed-artifacts?kind=package"),
      apiRequest<PackageDeploymentBatch[]>("/deployment-batches?kind=package&limit=1"),
    ]).then(([nextPackages, batches]) => {
      if (!active) return
      setPackages(nextPackages)
      if (batches[0]) setBatch(batches[0])
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "读取软件仓库失败")
    })
    return () => { active = false }
  }, [apiRequest, os])

  useEffect(() => {
    if (clientId) {
      const next = eligibleClientIds.includes(clientId) ? [clientId] : []
      if (next.join("|") !== selectedClientIds.join("|")) setSelectedClientIds(next)
      return
    }
    const valid = selectedClientIds.filter((id) => eligibleClientIds.includes(id))
    const next = valid.length > 0 ? valid : eligibleClientIds[0] ? [eligibleClientIds[0]] : []
    if (next.join("|") !== selectedClientIds.join("|")) setSelectedClientIds(next)
  }, [clientId, eligibleKey, selectedClientIds.join("|")])

  useEffect(() => {
    if (!batch || isTerminalPackageBatch(batch)) return
    const timer = window.setInterval(() => {
      apiRequest<PackageDeploymentBatch>(`/deployment-batches/${encodeURIComponent(batch.id)}`)
        .then(setBatch)
        .catch((caught) => setError(caught instanceof Error ? caught.message : "刷新部署批次失败"))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [apiRequest, batch?.id, batch?.status])

  if (os !== "windows") {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-5 text-sm text-muted-foreground">
        本计划仅实现 Windows MSI/EXE 软件仓库与批量安装；Linux 包管理保持现状。
      </div>
    )
  }

  const toggle = (id: string) => setPicked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const argumentsList = parseArgumentLines(argumentsText)
  const successExitCodes = parseSuccessExitCodes(successCodesText)
  const uploadValidation = validatePackageDraft({ file: uploadFile, displayName, version, installerType, arguments: argumentsList, successExitCodes })

  const onFileChange = (file: File | null) => {
    setUploadFile(file)
    if (!file) return
    if (!displayName) setDisplayName(file.name.replace(/\.(msi|exe)$/i, ""))
    if (file.name.toLowerCase().endsWith(".msi")) {
      setInstallerType("msi")
      setSuccessCodesText("0, 3010")
    } else if (file.name.toLowerCase().endsWith(".exe")) {
      setInstallerType("exe")
      setSuccessCodesText("0")
    }
  }

  const upload = async () => {
    if (uploadValidation || !uploadFile || uploading) {
      if (uploadValidation) setError(uploadValidation)
      return
    }
    setUploading(true)
    setUploadProgress(0)
    setError(null)
    let draftId: string | null = null
    try {
      const created = await apiRequest<ManagedPackage>("/managed-artifacts", {
        method: "POST",
        body: JSON.stringify({
          kind: "package",
          displayName: displayName.trim(),
          version: version.trim(),
          originalFileName: uploadFile.name,
          sizeBytes: uploadFile.size,
          installerType,
          arguments: argumentsList,
          successExitCodes,
        }),
      })
      draftId = created.id
      await uploadRequest<ManagedPackage>(`/managed-artifacts/${encodeURIComponent(created.id)}/content`, uploadFile, setUploadProgress)
      await loadPackages()
      setShowUpload(false)
      setUploadFile(null)
      setDisplayName("")
      setVersion("")
      setArgumentsText("")
      setSuccessCodesText("0")
    } catch (caught) {
      if (draftId) await apiRequest(`/managed-artifacts/${encodeURIComponent(draftId)}`, { method: "DELETE" }).catch(() => undefined)
      setError(caught instanceof Error ? caught.message : "上传安装包失败")
    } finally {
      setUploading(false)
    }
  }

  const removePackage = async (artifact: ManagedPackage) => {
    if (!(await confirm({
      title: `从软件仓库删除“${artifact.displayName}”？`,
      description: "存在活动部署时服务端会阻止删除。",
      confirmLabel: "删除",
      tone: "danger",
    }))) return
    setError(null)
    try {
      await apiRequest(`/managed-artifacts/${encodeURIComponent(artifact.id)}`, { method: "DELETE" })
      await loadPackages()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除安装包失败")
    }
  }

  const submit = async () => {
    if (submitting || picked.length === 0 || selectedClientIds.length === 0 || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 60 || timeoutSeconds > 7200) return
    const commandCount = picked.length * selectedClientIds.length
    const names = packages.filter((item) => picked.includes(item.id)).map((item) => item.displayName).join("、")
    const targetNames = clients.filter((client) => selectedClientIds.includes(client.id)).map((client) => client.name).join("、")
    if (!(await confirm({
      title: `创建 ${commandCount} 条批量安装命令？`,
      description: "安装过程不会主动重启系统。",
      body: `安装包：${names}\n目标客户端：${targetNames}\n命令数量：${picked.length} 个包 × ${selectedClientIds.length} 台 = ${commandCount} 条\n单条超时：${timeoutSeconds} 秒`,
      confirmLabel: "开始安装",
      tone: "warning",
    }))) return
    setSubmitting(true)
    setError(null)
    try {
      const created = await apiRequest<PackageDeploymentBatch>("/package-deployments", {
        method: "POST",
        body: JSON.stringify({ artifactIds: picked, clientIds: selectedClientIds, timeoutSeconds }),
      })
      setBatch(created)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建批量安装失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Package className="h-3.5 w-3.5" />软件仓库</span>
        <button type="button" onClick={() => setShowUpload((value) => !value)} className="flex h-9 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary">
          <Plus className="h-3.5 w-3.5" />{showUpload ? "收起上传" : "上传安装包"}
        </button>
      </div>

      {showUpload && (
        <div className="grid gap-3 rounded-2xl border border-border bg-surface/40 p-4 sm:grid-cols-2">
          <Field label="MSI / EXE 文件" icon={<FileUp className="h-3.5 w-3.5" />}>
            <input type="file" accept=".msi,.exe" disabled={uploading} onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary" />
          </Field>
          <Field label="展示名"><input className={inputCls} value={displayName} maxLength={120} disabled={uploading} onChange={(event) => setDisplayName(event.target.value)} /></Field>
          <Field label="版本"><input className={cn(inputCls, "font-mono")} value={version} maxLength={64} disabled={uploading} onChange={(event) => setVersion(event.target.value)} placeholder="例如 1.0.0" /></Field>
          <Field label="安装器类型">
            <select className={inputCls} value={installerType} disabled={uploading} onChange={(event) => { const next = event.target.value as InstallerType; setInstallerType(next); setSuccessCodesText(next === "msi" ? "0, 3010" : "0") }}>
              <option value="msi">MSI</option><option value="exe">EXE</option>
            </select>
          </Field>
          <Field label={installerType === "msi" ? "MSI 属性（每行 PROPERTY=value）" : "EXE 参数（每行一个）"}>
            <textarea className="min-h-24 w-full rounded-xl border border-border bg-surface/60 px-4 py-3 font-mono text-xs outline-none focus:border-primary/60" value={argumentsText} disabled={uploading} onChange={(event) => setArgumentsText(event.target.value)} />
          </Field>
          <Field label="成功退出码（逗号分隔）"><input className={cn(inputCls, "font-mono")} value={successCodesText} disabled={uploading} onChange={(event) => setSuccessCodesText(event.target.value)} /></Field>
          <div className="flex items-center gap-3 sm:col-span-2">
            <PrimaryButton disabled={uploading || Boolean(uploadValidation)} onClick={() => void upload()} icon={uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}>
              {uploading ? `上传中 ${uploadProgress}%` : "创建并上传"}
            </PrimaryButton>
            {uploadFile && <span className="text-xs text-muted-foreground">{uploadFile.name} · {formatByteSize(uploadFile.size)}</span>}
          </div>
          {uploading && <div className="h-1.5 overflow-hidden rounded-full bg-muted sm:col-span-2"><div className="h-full bg-primary transition-[width]" style={{ width: `${uploadProgress}%` }} /></div>}
        </div>
      )}

      <Field label={`选择安装包（已选 ${picked.length} / ${packages.filter((item) => item.status === "ready").length}）`} icon={<Package className="h-3.5 w-3.5" />}>
        {packages.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-surface/40 px-4 py-5 text-center text-xs text-muted-foreground">软件仓库为空，请先上传 MSI 或 EXE。</p>
        ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {packages.map((item) => {
            const on = picked.includes(item.id)
            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-2 rounded-2xl border px-3 py-3 transition-all duration-200",
                  on ? "border-primary bg-primary/10" : "border-border bg-surface/60 hover:bg-surface",
                )}
              >
                <button type="button" disabled={item.status !== "ready"} onClick={() => toggle(item.id)} className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left disabled:opacity-50">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{item.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{item.version || "未标版本"}</span> · {formatByteSize(item.sizeBytes)} · {item.installerType.toUpperCase()}
                  </p>
                  <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{item.status === "ready" ? `SHA-256 ${item.sha256?.slice(0, 12)}…` : item.status}</p>
                </div>
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-md border",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {on && <Play className="h-3 w-3 rotate-0" />}
                </span>
                </button>
                <button type="button" aria-label={`删除安装包 ${item.displayName}`} disabled={uploading} onClick={() => void removePackage(item)} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            )
          })}
        </div>
        )}
      </Field>

      <Field label="安装超时（秒，60–7200）"><input type="number" min={60} max={7200} className={cn(inputCls, "font-mono")} value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} /></Field>

      <TargetPicker os="windows" clientId={clientId} selectedIds={selectedClientIds} onChange={setSelectedClientIds} multiple onlineOnly />

      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-xs text-destructive">{error}</p>}

      {batch && (
        <div className="space-y-3 rounded-2xl border border-border bg-surface/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-sm font-semibold">部署批次 {batch.id}</p><p className="text-xs text-muted-foreground">共 {batch.totalItems} 条命令 · 状态 {batch.status}</p></div>
            <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">{Object.entries(batch.counts).map(([status, count]) => <span key={status} className="rounded-full bg-muted px-2 py-1">{status} {count}</span>)}</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {batch.items.map((item) => {
              const result = parsePackageInstallResult(item.command?.result ?? null)
              return (
                <div key={item.id} className="rounded-xl border border-border bg-background/50 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{item.client?.name ?? item.clientId}</span><span className="font-mono text-[10px] text-muted-foreground">{item.command?.status ?? "missing"}</span></div>
                  <p className="mt-1 truncate text-muted-foreground">{item.artifact?.displayName ?? item.artifactId}</p>
                  <p className="mt-2 font-mono text-[10px] text-muted-foreground">命令 {item.commandId}</p>
                  {result && <div className="mt-2 space-y-1 text-[11px] text-muted-foreground"><p>阶段 {result.phase} · 下载 {formatByteSize(result.downloadedBytes)} · 哈希 {result.hashVerified ? "通过" : "未完成"}</p><p>退出码 {result.exitCode ?? "—"} · 耗时 {result.durationMs} ms · 超时 {result.timedOut ? "是" : "否"}</p>{result.rebootRequired && <p className="font-medium text-amber-600">安装成功，客户端需要重启</p>}{result.error && <p className="text-destructive">{result.error}</p>}</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="mt-auto flex justify-end gap-3 border-t border-border pt-4">
        <PrimaryButton disabled={submitting || picked.length === 0 || selectedClientIds.length === 0 || timeoutSeconds < 60 || timeoutSeconds > 7200} onClick={() => void submit()} icon={submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}>
          {submitting ? "创建中…" : `开始批量安装（${picked.length * selectedClientIds.length}）`}
        </PrimaryButton>
      </div>
    </div>
  )
}

/* ---------- 子功能：文件下发 ---------- */
function FileDeploy({ os, clientId }: DetailProps) {
  const { clients, apiRequest, uploadRequest } = useServerData()
  const { confirm } = useConfirm()
  const [file, setFile] = useState<File | null>(null)
  const [displayName, setDisplayName] = useState("")
  const [destinationPath, setDestinationPath] = useState("C:\\Deploy\\")
  const [conflictPolicy, setConflictPolicy] = useState<"fail" | "replace">("fail")
  const [createDirectories, setCreateDirectories] = useState(false)
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>(clientId ? [clientId] : [])
  const [dragActive, setDragActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [batch, setBatch] = useState<FileDeploymentBatch | null>(null)
  const [rollbackCommands, setRollbackCommands] = useState<Record<string, FileDeployCommand>>({})
  const [rollingBack, setRollingBack] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const eligibleClientIds = clients.filter((client) => client.status === "online" && matchOS(client, "windows")).map((client) => client.id)
  const eligibleKey = eligibleClientIds.join("|")

  useEffect(() => {
    if (os !== "windows") return
    let active = true
    apiRequest<FileDeploymentBatch[]>("/deployment-batches?kind=file&limit=1")
      .then((batches) => { if (active && batches[0]) setBatch(batches[0]) })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "读取文件部署历史失败") })
    return () => { active = false }
  }, [apiRequest, os])

  useEffect(() => {
    if (clientId) {
      const next = eligibleClientIds.includes(clientId) ? [clientId] : []
      if (next.join("|") !== selectedClientIds.join("|")) setSelectedClientIds(next)
      return
    }
    const valid = selectedClientIds.filter((id) => eligibleClientIds.includes(id))
    const next = valid.length > 0 ? valid : eligibleClientIds[0] ? [eligibleClientIds[0]] : []
    if (next.join("|") !== selectedClientIds.join("|")) setSelectedClientIds(next)
  }, [clientId, eligibleKey, selectedClientIds.join("|")])

  const refreshBatch = async () => {
    if (!batch) return
    setBatch(await apiRequest<FileDeploymentBatch>("/deployment-batches/" + encodeURIComponent(batch.id)))
  }

  useEffect(() => {
    if (!batch || isTerminalFileBatch(batch)) return
    const timer = window.setInterval(() => {
      apiRequest<FileDeploymentBatch>("/deployment-batches/" + encodeURIComponent(batch.id))
        .then(setBatch)
        .catch((caught) => setError(caught instanceof Error ? caught.message : "刷新文件部署批次失败"))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [apiRequest, batch?.id, batch?.status])

  const rollbackKey = Object.values(rollbackCommands).map((command) => command.id + ":" + command.status).join("|")
  useEffect(() => {
    const activeCommands = Object.values(rollbackCommands).filter((command) => !terminalCommandStatuses.includes(command.status))
    if (activeCommands.length === 0) return
    const poll = async () => {
      const ids = Array.from(new Set(activeCommands.map((command) => command.clientId)))
      const lists = await Promise.all(ids.map((id) => apiRequest<FileDeployCommand[]>("/commands?clientId=" + encodeURIComponent(id))))
      const byId = new Map(lists.flat().map((command) => [command.id, command]))
      setRollbackCommands((current) => Object.fromEntries(Object.entries(current).map(([originalId, command]) => [originalId, byId.get(command.id) ?? command])))
    }
    void poll().catch((caught) => setError(caught instanceof Error ? caught.message : "刷新回滚命令失败"))
    const timer = window.setInterval(() => void poll().catch((caught) => setError(caught instanceof Error ? caught.message : "刷新回滚命令失败")), 1000)
    return () => window.clearInterval(timer)
  }, [apiRequest, rollbackKey])

  if (os !== "windows") {
    return <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-5 text-sm text-muted-foreground">文件下发仅支持受管理的 Windows 客户端。</div>
  }

  const chooseFile = (next: File | null) => {
    setFile(next)
    if (!next) return
    setDisplayName(next.name)
    setDestinationPath((current) => current.endsWith("\\") ? current + next.name : current)
    setError(null)
  }
  const validation = validateFileDraft(file, displayName, destinationPath)

  const submit = async () => {
    if (submitting || validation || !file || selectedClientIds.length === 0) {
      if (validation) setError(validation)
      return
    }
    const targetNames = clients.filter((client) => selectedClientIds.includes(client.id)).map((client) => client.name).join("、")
    const policyText = conflictPolicy === "replace" ? "\n目标已存在时，旧文件会进入受保护备份并允许回滚。" : "\n目标已存在时命令会失败，不覆盖旧文件。"
    if (!(await confirm({
      title: `下发文件“${file.name}”到 ${selectedClientIds.length} 台客户端？`,
      description: policyText.trim(),
      body: `目标客户端：${targetNames}\n目标路径：${destinationPath}`,
      confirmLabel: "开始下发",
      tone: "warning",
    }))) return
    setSubmitting(true)
    setUploadProgress(0)
    setError(null)
    let artifactId: string | null = null
    try {
      const artifact = await apiRequest<ManagedFile>("/managed-artifacts", {
        method: "POST",
        body: JSON.stringify({ kind: "file", displayName: displayName.trim(), version: "", originalFileName: file.name, sizeBytes: file.size }),
      })
      artifactId = artifact.id
      const ready = await uploadRequest<ManagedFile>("/managed-artifacts/" + encodeURIComponent(artifact.id) + "/content", file, setUploadProgress)
      const created = await apiRequest<FileDeploymentBatch>("/file-deployments", {
        method: "POST",
        body: JSON.stringify({ artifactId: ready.id, clientIds: selectedClientIds, destinationPath, conflictPolicy, createDirectories }),
      })
      setBatch(created)
      setRollbackCommands({})
    } catch (caught) {
      if (artifactId) await apiRequest("/managed-artifacts/" + encodeURIComponent(artifactId), { method: "DELETE" }).catch(() => undefined)
      setError(caught instanceof Error ? caught.message : "文件下发创建失败")
    } finally {
      setSubmitting(false)
    }
  }

  const rollback = async (item: FileDeploymentBatch["items"][number]) => {
    if (!item.command || rollingBack) return
    if (!(await confirm({
      title: `回滚 ${item.client?.name ?? item.clientId} 上被替换的文件？`,
      description: "当前文件哈希发生变化时，Agent 会拒绝回滚。",
      body: `来源命令：${item.commandId}`,
      confirmLabel: "回滚",
      tone: "warning",
    }))) return
    setRollingBack(item.commandId)
    setError(null)
    try {
      const command = await apiRequest<FileDeployCommand>("/clients/" + encodeURIComponent(item.clientId) + "/file-deployments/" + encodeURIComponent(item.commandId) + "/rollback", { method: "POST" })
      setRollbackCommands((current) => ({ ...current, [item.commandId]: command }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建文件回滚失败")
    } finally {
      setRollingBack(null)
    }
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <Field label="上传文件" icon={<FileUp className="h-3.5 w-3.5" />}>
        <label
          className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-surface/40 py-7 text-center transition-colors hover:border-primary/50 hover:bg-surface/60", dragActive ? "border-primary bg-primary/8" : "border-border", submitting && "pointer-events-none opacity-60")}
          onDragEnter={(event) => { event.preventDefault(); setDragActive(true) }}
          onDragOver={(event) => { event.preventDefault(); setDragActive(true) }}
          onDragLeave={(event) => { event.preventDefault(); setDragActive(false) }}
          onDrop={(event) => { event.preventDefault(); setDragActive(false); chooseFile(event.dataTransfer.files?.[0] ?? null) }}
        >
          <input type="file" className="sr-only" disabled={submitting} onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <FileUp className="h-6 w-6" />
          </span>
          <p className="max-w-full break-all px-4 text-sm font-medium">{file?.name ?? "选择或拖放文件"}</p>
          <p className="text-xs text-muted-foreground">{file ? formatByteSize(file.size) + " · 最大 512 MiB" : "单个文件最大 512 MiB"}</p>
        </label>
      </Field>

      <Field label="展示名"><input className={inputCls} value={displayName} maxLength={120} disabled={submitting} onChange={(event) => setDisplayName(event.target.value)} /></Field>
      <Field label="下发目标路径">
        <input
          className={cn(inputCls, "font-mono")}
          placeholder="C:\Deploy\config.json"
          value={destinationPath}
          disabled={submitting}
          onChange={(event) => setDestinationPath(event.target.value)}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="冲突策略">
          <SegmentedControl value={conflictPolicy} onChange={(value) => setConflictPolicy(value as "fail" | "replace")} options={[{ id: "fail", label: "存在即失败" }, { id: "replace", label: "备份并替换" }]} />
        </Field>
        <Field label="目录处理">
          <label className="flex h-11 items-center gap-3 rounded-xl border border-border bg-surface/60 px-4 text-sm">
            <input type="checkbox" checked={createDirectories} disabled={submitting} onChange={(event) => setCreateDirectories(event.target.checked)} />
            创建缺失的父目录
          </label>
        </Field>
      </div>

      <TargetPicker os="windows" clientId={clientId} selectedIds={selectedClientIds} onChange={setSelectedClientIds} multiple onlineOnly />

      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-xs text-destructive">{error}</p>}

      {batch && (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-sm font-semibold">文件批次 {batch.id}</p><p className="text-xs text-muted-foreground">{batch.totalItems} 台客户端 · {batch.status}</p></div>
            <button type="button" title="刷新批次" aria-label="刷新文件部署批次" onClick={() => void refreshBatch().catch((caught) => setError(caught instanceof Error ? caught.message : "刷新失败"))} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><RotateCw className="h-4 w-4" /></button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {batch.items.map((item) => {
              const result = parseFileDeployResult(item.command?.result ?? null)
              const rollbackCommand = rollbackCommands[item.commandId]
              const rollbackResult = parseFileRollbackResult(rollbackCommand?.result ?? null)
              return (
                <div key={item.id} className="min-w-0 rounded-xl border border-border bg-background/50 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{item.client?.name ?? item.clientId}</span><span className="font-mono text-[10px] text-muted-foreground">{item.command?.status ?? "missing"}</span></div>
                  <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">命令 {item.commandId}</p>
                  {result && <div className="mt-2 space-y-1 text-[11px] text-muted-foreground"><p className="break-all">{result.destinationPath}</p><p>阶段 {result.phase} · 下载 {formatByteSize(result.downloadedBytes)} · 哈希 {result.hashVerified ? "通过" : "未完成"}</p><p>替换 {result.replaced ? "是" : "否"} · 备份 {result.backupValid ? "有效" : "无"} · 耗时 {result.durationMs} ms</p>{result.finalSha256 && <p className="truncate font-mono">最终 SHA-256 {result.finalSha256}</p>}{result.backupValid && result.backupPath && <p className="break-all font-mono">备份 {result.backupPath}</p>}{result.error && <p className="text-destructive">{result.error}</p>}</div>}
                  {isRollbackEligible(result, item.command) && !rollbackCommand && <button type="button" disabled={rollingBack === item.commandId} onClick={() => void rollback(item)} className="mt-3 flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium hover:bg-muted disabled:opacity-50"><RotateCw className={cn("h-3.5 w-3.5", rollingBack === item.commandId && "animate-spin")} />回滚</button>}
                  {rollbackCommand && <div className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground"><p>回滚命令 <span className="font-mono">{rollbackCommand.id}</span> · {rollbackCommand.status}</p>{rollbackResult && <p className={rollbackResult.error ? "text-destructive" : "text-foreground"}>{rollbackResult.error ?? "已恢复 SHA-256 " + rollbackResult.restoredSha256}</p>}</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="mt-auto flex justify-end gap-3 border-t border-border pt-4">
        <PrimaryButton disabled={submitting || Boolean(validation) || selectedClientIds.length === 0} onClick={() => void submit()} icon={submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}>
          {submitting ? "上传中 " + uploadProgress + "%" : "下发文件（" + selectedClientIds.length + "）"}
        </PrimaryButton>
      </div>
    </div>
  )
}

/* ---------- 子功能：命令执行 ---------- */
function CommandRun({ os, clientId: fixedClientId }: DetailProps) {
  const { clients, apiRequest } = useServerData()
  const { confirm } = useConfirm()
  const [shell, setShell] = useState<ShellKind>("powershell")
  const [script, setScript] = useState("Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion")
  const [timeoutSeconds, setTimeoutSeconds] = useState(300)
  const [selectedIds, setSelectedIds] = useState<string[]>(fixedClientId ? [fixedClientId] : [])
  const [commands, setCommands] = useState<RunShellCommand[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeKey = commands.map((command) => `${command.id}:${command.status}`).join("|")

  useEffect(() => {
    if (os !== "windows") return
    let active = true
    void apiRequest<RunShellCommand[]>("/commands").then((history) => {
      if (!active || commands.length > 0) return
      const recent = history.filter((command) => command.type === "run-shell")
      const latest = recent[0]
      if (!latest) return
      const batch = recent.filter((command) => Math.abs(command.createdAt - latest.createdAt) <= 2_000)
      setCommands(batch)
      if (!fixedClientId) {
        const online = new Set(clients.filter((client) => client.os === "Windows" && client.status === "online").map((client) => client.id))
        setSelectedIds(batch.map((command) => command.clientId).filter((id) => online.has(id)))
      }
    }).catch(() => undefined)
    return () => { active = false }
  }, [apiRequest, fixedClientId, os])

  useEffect(() => {
    if (commands.length === 0 || commands.every((command) => terminalCommandStatuses.includes(command.status))) return
    let active = true
    const poll = async () => {
      try {
        const clientIds = Array.from(new Set(commands.map((command) => command.clientId)))
        const lists = await Promise.all(clientIds.map((id) => apiRequest<RunShellCommand[]>(`/commands?clientId=${encodeURIComponent(id)}`)))
        const byId = new Map(lists.flat().map((command) => [command.id, command]))
        if (active) setCommands((current) => current.map((command) => byId.get(command.id) ?? command))
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "命令状态查询失败")
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [activeKey, apiRequest])

  if (os !== "windows") {
    return <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">当前阶段仅接入 Windows CMD / PowerShell 执行链路。</p>
  }

  const valid = selectedIds.length > 0 && isValidShellScript(script) && isValidShellTimeout(timeoutSeconds)
  const targetNames = selectedIds.map((id) => clients.find((client) => client.id === id)?.name ?? id)

  async function submit() {
    if (!valid || submitting) return
    if (!(await confirm({
      title: `向 ${targetNames.length} 台客户端下发命令？`,
      description: "脚本会在目标机器上以 Agent 服务身份执行。",
      body: `Shell：${shell}\n目标客户端：${targetNames.join("、")}\n超时：${timeoutSeconds} 秒`,
      confirmLabel: "下发命令",
      tone: "warning",
    }))) return
    setSubmitting(true)
    setError(null)
    setCommands([])
    try {
      const response = await apiRequest<{ commands: RunShellCommand[] }>("/commands/batch", {
        method: "POST",
        body: JSON.stringify({ clientIds: selectedIds, type: "run-shell", payload: { shell, script, timeoutSeconds } }),
      })
      setCommands(response.commands)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "命令下发失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <Field label="执行环境" icon={<SquareTerminal className="h-3.5 w-3.5" />}>
        <SegmentedControl
          fill
          value={shell}
          onChange={setShell}
          options={[{ id: "cmd", label: "CMD" }, { id: "powershell", label: "PowerShell" }]}
        />
      </Field>

      <Field label={`命令内容（${[...script].length}/32768）`} icon={<SquareTerminal className="h-3.5 w-3.5" />}>
        <textarea
          className={cn(inputCls, "h-28 resize-none py-3 font-mono leading-relaxed")}
          placeholder={shell === "cmd" ? "例如：ipconfig /all" : "例如：Get-ComputerInfo"}
          value={script}
          onChange={(event) => setScript(event.target.value)}
        />
      </Field>

      <Field label="超时（秒）">
        <input type="number" min={1} max={900} step={1} value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} className={cn(inputCls, "max-w-40 font-mono")} />
      </Field>

      <TargetPicker os="windows" clientId={fixedClientId} selectedIds={selectedIds} onChange={setSelectedIds} multiple={!fixedClientId} onlineOnly />

      {(commands.length > 0 || error) && (
        <section className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-surface/60 p-4" aria-live="polite">
          {commands.map((command) => {
            const result = parseRunShellResult(command.result)
            const client = clients.find((item) => item.id === command.clientId)
            return (
              <div key={command.id} className="min-w-0 rounded-xl border border-border bg-background/45 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">{client?.name ?? command.clientId}</p>
                  <span className="font-mono text-muted-foreground">{command.status}</span>
                </div>
                <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{command.id}</p>
                {result && (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <span>Shell：<b className="font-mono">{result.shell}</b></span>
                    <span>退出码：<b className="font-mono">{result.exitCode ?? "-"}</b></span>
                    <span>耗时：<b className="font-mono">{result.durationMs} ms</b></span>
                    <span>截断：<b>{result.truncated ? "是" : "否"}</b></span>
                  </div>
                )}
                {result?.stdout && <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 font-mono text-xs text-foreground">{result.stdout}</pre>}
                {result?.stderr && <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-negative/8 p-3 font-mono text-xs text-negative">{result.stderr}</pre>}
                {result?.error && <p className="mt-3 break-words text-negative">{result.error}</p>}
                {command.result && !result && <p className="mt-3 text-negative">Agent 返回了未通过字段校验的结果。</p>}
              </div>
            )
          })}
          {error && <p className="text-sm text-negative">{error}</p>}
        </section>
      )}

      <div className="mt-auto flex justify-end gap-3 border-t border-border pt-4">
        <button type="button" onClick={() => void submit()} disabled={!valid || submitting} className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-50">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          执行命令
        </button>
      </div>
    </div>
  )
}

/* ---------- 子功能：消息推送 ---------- */
function MessagePush({ os, clientId }: DetailProps) {
  const { clients, apiRequest } = useServerData()
  const { confirm } = useConfirm()
  const [title, setTitle] = useState("")
  const [message, setMessage] = useState("")
  const [severity, setSeverity] = useState<MessageSeverity>("info")
  const [timeoutSeconds, setTimeoutSeconds] = useState(60)
  const [selectedIds, setSelectedIds] = useState<string[]>(clientId ? [clientId] : [])
  const [commands, setCommands] = useState<MessageCommand[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = commands.some((command) => !terminalMessageStatuses.includes(command.status as (typeof terminalMessageStatuses)[number]))
  const titleCount = unicodeScalarCount(title)
  const messageCount = unicodeScalarCount(message)
  const valid = validMessageText(title, 128, false) && validMessageText(message, 2000, true) && validMessageTimeout(timeoutSeconds) && selectedIds.length > 0

  useEffect(() => {
    if (os !== "windows") return
    let mounted = true
    void apiRequest<MessageCommand[]>("/commands").then((history) => {
      if (mounted) setCommands(latestMessageBatch(history.filter((item) => item.type === "show-message")))
    }).catch((caught) => mounted && setError(caught instanceof Error ? caught.message : "恢复消息推送历史失败"))
    return () => { mounted = false }
  }, [apiRequest, os])

  useEffect(() => {
    if (!active) return
    let mounted = true
    const poll = async () => {
      try {
        const history = await apiRequest<MessageCommand[]>("/commands")
        const byId = new Map(history.map((command) => [command.id, command]))
        if (mounted) setCommands((current) => current.map((command) => byId.get(command.id) ?? command))
      } catch (caught) { if (mounted) setError(caught instanceof Error ? caught.message : "刷新消息状态失败") }
    }
    void poll(); const timer = window.setInterval(() => void poll(), 1000)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [active, apiRequest])

  const submit = async () => {
    if (!valid || submitting || active) return
    const targets = clients.filter((client) => selectedIds.includes(client.id))
    if (!(await confirm({
      title: `向 ${targets.length} 台客户端推送弹窗通知？`,
      body: messageConfirmation(title, message, severity, timeoutSeconds, targets.map((client) => client.name)),
      confirmLabel: "推送",
    }))) return
    setSubmitting(true); setError(null)
    try {
      const response = await apiRequest<{ commands: MessageCommand[] }>("/commands/batch", { method: "POST", body: JSON.stringify({ clientIds: selectedIds, type: "show-message", payload: { title, message, severity, timeoutSeconds } }) })
      setCommands(response.commands)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "创建消息推送失败") }
    finally { setSubmitting(false) }
  }

  if (os !== "windows") return <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">消息推送仅支持 Windows 活动用户会话。</p>

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <Field label="消息标题" icon={<MessageSquare className="h-3.5 w-3.5" />}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputCls} placeholder="例如：系统维护通知" />
        <span className={cn("text-right text-[11px]", titleCount > 128 ? "text-negative" : "text-muted-foreground")}>{titleCount} / 128 Unicode 标量</span>
      </Field>

      <Field label="消息内容">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className={cn(inputCls, "h-24 resize-none py-3 leading-relaxed")}
          placeholder="输入要推送给客户端的内容"
        />
        <span className={cn("text-right text-[11px]", messageCount > 2000 ? "text-negative" : "text-muted-foreground")}>{messageCount} / 2000 Unicode 标量</span>
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
      <Field label="级别">
        <div className="flex gap-2">
          {([['info','信息'],['warning','警告'],['error','错误']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSeverity(value)}
              className={cn(
                "h-11 flex-1 rounded-xl border text-sm font-medium transition-all duration-200",
                severity === value
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-surface/60 text-muted-foreground hover:bg-surface",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="显示超时（5–300 秒）"><input type="number" min={5} max={300} value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} className={cn(inputCls,"font-mono")} /></Field>
      </div>

      <TargetPicker os="windows" clientId={clientId} selectedIds={selectedIds} onChange={setSelectedIds} multiple={!clientId} onlineOnly />
      {error && <div role="alert" className="rounded-xl border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative">{error}</div>}

      {commands.length > 0 && <div className="flex flex-col gap-2"><p className="text-xs font-medium text-muted-foreground">逐客户端投递结果</p>{commands.map((command) => { const result=parseMessagePushResult(command.result); const client=clients.find((item)=>item.id===command.clientId); return <div key={command.id} className="rounded-xl border border-border bg-surface/50 p-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span>{client?.name ?? command.clientId}</span><span className="font-mono">{command.status}</span></div><p className="mt-1 font-mono text-muted-foreground">{command.id}</p>{result && <p className="mt-2 text-muted-foreground">投递：{result.deliveryStatus} · Session {result.sessionId ?? "—"} · 响应 {result.responseCode ?? "—"} · 超时 {result.timedOut ? "是" : "否"} · {result.durationMs} ms</p>}{result?.error && <p className="mt-1 text-negative">{result.error.code}: {result.error.message}</p>}</div>})}</div>}

      <div className="mt-auto flex justify-end gap-3 border-t border-border pt-4">
        <PrimaryButton disabled={!valid || submitting || active} onClick={() => void submit()} icon={submitting || active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}>{submitting ? "创建中…" : active ? "投递中…" : `推送消息（${selectedIds.length}）`}</PrimaryButton>
      </div>
    </div>
  )
}

/* ---------- 子功能：用户管理 ---------- */
function UserManage({ os, clientId }: DetailProps) {
  const { clients, apiRequest } = useServerData()
  const { confirm, promptText } = useConfirm()
  const [selectedIds, setSelectedIds] = useState<string[]>(clientId ? [clientId] : [])
  const [accounts, setAccounts] = useState<LocalUserAccount[]>([])
  const [command, setCommand] = useState<LocalUserCommand | null>(null)
  const [search, setSearch] = useState("")
  const [groupName, setGroupName] = useState("")
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoRefreshed = useRef(new Set<string>())
  const targetId = selectedIds[0] ?? null
  const selectedClient = clients.find((client) => client.id === targetId) ?? null
  const busy = submitting || Boolean(command && !terminalLocalUserStatuses.includes(command.status as (typeof terminalLocalUserStatuses)[number]))

  const issueList = useCallback(async () => {
    if (!targetId) return null
    setLoading(true)
    setError(null)
    try {
      const fresh = await apiRequest<Client>(`/clients/${encodeURIComponent(targetId)}`)
      if (fresh.os !== "Windows" || fresh.status !== "online") throw new Error("目标 Windows 客户端当前不在线")
      const created = await apiRequest<LocalUserCommand>(`/clients/${encodeURIComponent(targetId)}/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "manage-local-user", payload: localUserPayload("list") }),
      })
      setCommand(created)
      return created
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "查询本地账户失败")
      return null
    } finally {
      setLoading(false)
    }
  }, [apiRequest, targetId])

  useEffect(() => {
    if (os !== "windows" || !targetId) {
      setAccounts([])
      setCommand(null)
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    void apiRequest<LocalUserCommand[]>(`/commands?clientId=${encodeURIComponent(targetId)}`)
      .then(async (history) => {
        if (!active) return
        const latest = latestLocalUserList(history.filter((item) => item.type === "manage-local-user"))
        if (!latest) {
          setLoading(false)
          await issueList()
          return
        }
        setCommand(latest)
        const result = parseLocalUserResult(latest.result)
        if (result?.action === "list" && !result.error) setAccounts(result.accounts)
        else setError(result?.error?.message ?? "最近的账户列表结果格式无效")
      })
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : "恢复账户列表失败"))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [apiRequest, issueList, os, targetId])

  useEffect(() => {
    if (!command || terminalLocalUserStatuses.includes(command.status as (typeof terminalLocalUserStatuses)[number])) return
    let active = true
    const poll = async () => {
      try {
        const history = await apiRequest<LocalUserCommand[]>(`/commands?clientId=${encodeURIComponent(command.clientId)}`)
        const next = history.find((item) => item.id === command.id)
        if (active && next) setCommand(next)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "刷新用户管理命令失败")
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [apiRequest, command])

  useEffect(() => {
    if (!command || !terminalLocalUserStatuses.includes(command.status as (typeof terminalLocalUserStatuses)[number])) return
    const result = parseLocalUserResult(command.result)
    if (!result) {
      if (command.status !== "canceled") setError("用户管理命令返回了无效的结构化结果")
      return
    }
    if (result.error) setError(`${result.error.code}: ${result.error.message}`)
    if (result.action === "list" && !result.error) {
      setAccounts(result.accounts)
      setError(null)
      return
    }
    if (command.status === "success" && result.action !== "list" && !result.error && !autoRefreshed.current.has(command.id)) {
      autoRefreshed.current.add(command.id)
      void issueList()
    }
  }, [command, issueList])

  const runWrite = async (action: LocalUserWriteAction, account: LocalUserAccount) => {
    if (!targetId || !selectedClient || busy || account.builtIn) return
    const requiresGroup = action === "add-to-group" || action === "remove-from-group"
    const normalizedGroup = groupName.trim()
    if (requiresGroup && !isValidLocalGroupName(normalizedGroup)) {
      setError("请先输入有效的本地组名")
      return
    }
    if (action === "delete") {
      const confirmation = await promptText({
        title: `删除本地账户“${account.userName}”？`,
        description: "删除后不可撤销。请输入完整账户名以确认。",
        body: `客户端：${selectedClient.name}`,
        label: "账户名",
        placeholder: account.userName,
        requireValue: account.userName,
        confirmLabel: "删除账户",
        tone: "danger",
      })
      if (confirmation === null) return
      if (!isDeleteConfirmationValid(account.userName, confirmation)) {
        setError("删除确认与完整账户名不匹配")
        return
      }
    } else if (!(await confirm({
      title: `确认对“${account.userName}”执行该操作？`,
      body: localUserConfirmation(action, selectedClient.name, account.userName, requiresGroup ? normalizedGroup : null),
      confirmLabel: "执行",
      tone: "warning",
    }))) return
    setSubmitting(true)
    setError(null)
    try {
      const fresh = await apiRequest<Client>(`/clients/${encodeURIComponent(targetId)}`)
      if (fresh.os !== "Windows" || fresh.status !== "online") throw new Error("目标 Windows 客户端当前不在线")
      const created = await apiRequest<LocalUserCommand>(`/clients/${encodeURIComponent(targetId)}/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "manage-local-user", payload: localUserPayload(action, account.userName, requiresGroup ? normalizedGroup : null) }),
      })
      setCommand(created)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交用户管理命令失败")
    } finally {
      setSubmitting(false)
    }
  }

  const visibleAccounts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return needle ? accounts.filter((account) => `${account.userName}\n${account.sid}\n${account.groups.join("\n")}`.toLocaleLowerCase().includes(needle)) : accounts
  }, [accounts, search])

  if (os !== "windows") return <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">本阶段用户管理仅支持 Windows 本地账户。</p>
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <TargetPicker os="windows" clientId={clientId} selectedIds={selectedIds} onChange={setSelectedIds} multiple={false} onlineOnly />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex h-10 max-w-[240px] flex-1 items-center gap-2 rounded-full border border-border bg-surface/60 px-3.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索账户、SID 或组" className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60" />
        </div>
        <div className="flex min-w-[220px] flex-1 gap-2 sm:max-w-[430px]">
          <input value={groupName} onChange={(event) => setGroupName(event.target.value)} className={cn(inputCls, "min-w-0 font-mono")} placeholder="本地组名（加入/移出）" />
          <PrimaryButton disabled={!targetId || busy} onClick={() => void issueList()} icon={<RotateCw className={cn("h-4 w-4", (loading || busy) && "animate-spin")} />}>刷新</PrimaryButton>
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative">{error}</div>}
      {command && <p className="text-xs text-muted-foreground">命令 <span className="font-mono">{command.id}</span> · {command.status}{command.payload.action !== "list" ? ` · ${command.payload.action}` : ""}</p>}

      <div className="flex flex-col gap-2">
        {(loading && accounts.length === 0) && <div className="flex items-center gap-2 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在读取真实本地账户…</div>}
        {!loading && targetId && visibleAccounts.length === 0 && <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">{search ? "没有匹配的本地账户" : "客户端返回了空账户列表"}</p>}
        {!targetId && <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">请选择一台在线 Windows 客户端</p>}
        {visibleAccounts.map((account) => (
          <div
            key={account.sid}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-surface/60 px-4 py-3.5 transition-colors hover:bg-surface sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Users className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <div className="min-w-0 leading-tight">
                <p className="truncate font-mono text-sm font-medium">{account.userName}{account.builtIn && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 font-sans text-[10px] text-muted-foreground">内置账户</span>}</p>
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{account.sid}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{account.groups.length ? account.groups.join(" · ") : "未加入本地组"}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                  account.enabled ? "bg-primary/12 text-primary" : "bg-surface text-muted-foreground",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", account.enabled ? "bg-primary" : "bg-muted-foreground/50")} />
                {account.enabled ? "已启用" : "已禁用"}
              </span>
              <button type="button" disabled={busy || account.builtIn} onClick={() => void runWrite(account.enabled ? "disable" : "enable", account)} className="h-8 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-40">{account.enabled ? "禁用" : "启用"}</button>
              <button type="button" disabled={busy || account.builtIn || !isValidLocalGroupName(groupName.trim())} onClick={() => void runWrite("add-to-group", account)} className="h-8 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-40">加入组</button>
              <button type="button" disabled={busy || account.builtIn || !isValidLocalGroupName(groupName.trim())} onClick={() => void runWrite("remove-from-group", account)} className="h-8 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-40">移出组</button>
              <button type="button" aria-label={`删除用户 ${account.userName}`} disabled={busy || account.builtIn} onClick={() => void runWrite("delete", account)} className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-negative disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- 子功能：打开网页（Windows） ---------- */
// 常用地址由服务端配置提供，面板不再内置模拟数据
const urlPresets: string[] = []

function OpenWebpage({ os, clientId }: DetailProps) {
  const { clients, apiRequest } = useServerData()
  const { confirm } = useConfirm()
  const [url, setUrl] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>(clientId ? [clientId] : [])
  const [commands, setCommands] = useState<OpenUrlCommand[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = commands.some((command) => !terminalOpenUrlStatuses.includes(command.status as (typeof terminalOpenUrlStatuses)[number]))
  const validationError = url.length > 0 ? openUrlValidationError(url) : null
  const valid = isValidOpenUrl(url) && selectedIds.length > 0

  useEffect(() => {
    if (os !== "windows") return
    let mounted = true
    void apiRequest<OpenUrlCommand[]>("/commands").then((history) => {
      if (!mounted) return
      const latest = latestOpenUrlBatch(history.filter((item) => item.type === "open-url"))
      setCommands(latest)
      if (latest[0]) setUrl(latest[0].payload.url)
    }).catch((caught) => mounted && setError(caught instanceof Error ? caught.message : "恢复打开网页历史失败"))
    return () => { mounted = false }
  }, [apiRequest, os])

  useEffect(() => {
    if (!active) return
    let mounted = true
    const poll = async () => {
      try {
        const history = await apiRequest<OpenUrlCommand[]>("/commands")
        const byId = new Map(history.map((command) => [command.id, command]))
        if (mounted) setCommands((current) => current.map((command) => byId.get(command.id) ?? command))
      } catch (caught) { if (mounted) setError(caught instanceof Error ? caught.message : "刷新浏览器启动状态失败") }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [active, apiRequest])

  const submit = async () => {
    if (!valid || submitting || active) return
    const targetNames = clients.filter((client) => selectedIds.includes(client.id)).map((client) => client.name)
    if (!(await confirm({
      title: `在 ${targetNames.length} 台客户端浏览器打开该地址？`,
      body: openUrlConfirmation(url, targetNames),
      confirmLabel: "打开",
    }))) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await apiRequest<{ commands: OpenUrlCommand[] }>("/commands/batch", {
        method: "POST",
        body: JSON.stringify({ clientIds: selectedIds, type: "open-url", payload: { url } }),
      })
      setCommands(response.commands)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "创建打开网页命令失败") }
    finally { setSubmitting(false) }
  }

  if (os !== "windows") return <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">打开网页仅支持 Windows 活动用户会话。</p>

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <Field label="网页地址" icon={<Globe className="h-3.5 w-3.5" />}>
        <input value={url} onChange={(event) => setUrl(event.target.value)} className={cn(inputCls, "font-mono")} placeholder="https://example.com" maxLength={2049} aria-invalid={Boolean(validationError)} />
        <div className="flex items-center justify-between gap-3 text-[11px]"><span className={validationError ? "text-negative" : "text-muted-foreground"}>{validationError ?? "仅支持不含用户信息的绝对 HTTP/HTTPS 地址"}</span><span className={url.length > 2048 ? "text-negative" : "text-muted-foreground"}>{url.length} / 2048</span></div>
      </Field>

      {urlPresets.length > 0 && <Field label="常用地址">
        <div className="flex flex-wrap gap-2">
          {urlPresets.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUrl(u)}
              className="rounded-full border border-border bg-surface/60 px-3 py-2 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              {u}
            </button>
          ))}
        </div>
      </Field>}

      <TargetPicker os="windows" clientId={clientId} selectedIds={selectedIds} onChange={setSelectedIds} multiple={!clientId} onlineOnly />
      {error && <div role="alert" className="rounded-xl border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative">{error}</div>}

      {commands.length > 0 && <div className="flex flex-col gap-2"><p className="text-xs font-medium text-muted-foreground">逐客户端启动结果</p>{commands.map((command) => {
        const result = parseOpenUrlResult(command.result)
        const client = clients.find((item) => item.id === command.clientId)
        return <div key={command.id} className="rounded-xl border border-border bg-surface/50 p-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span>{client?.name ?? command.clientId}</span><span className="font-mono">{command.status}</span></div><p className="mt-1 break-all font-mono text-muted-foreground">{command.id}</p>{result && <><p className="mt-2 font-medium text-foreground">{openUrlResultText(result)}</p><p className="mt-1 text-muted-foreground">Session {result.sessionId ?? "—"} · 进程 {result.processStarted ? "已创建" : "未创建"} · PID {result.pid ?? "—"} · {result.durationMs} ms</p></>}{result?.error && <p className="mt-1 break-words text-negative">{result.error.code}: {result.error.message}</p>}</div>
      })}</div>}

      <div className="mt-auto flex justify-end gap-3 border-t border-border pt-4">
        <PrimaryButton disabled={!valid || submitting || active} onClick={() => void submit()} icon={submitting || active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}>{submitting ? "创建中…" : active ? "启动中…" : `启动浏览器请求（${selectedIds.length}）`}</PrimaryButton>
      </div>
    </div>
  )
}

/* ---------- 子功能：注册表（Windows） ---------- */
function Registry({ os, clientId }: DetailProps) {
  const { clients, apiRequest } = useServerData()
  const { confirm } = useConfirm()
  const [selectedIds, setSelectedIds] = useState<string[]>(clientId ? [clientId] : [])
  const [hive, setHive] = useState<RegistryHive>("HKLM")
  const [view, setView] = useState<RegistryView>("registry64")
  const [subKey, setSubKey] = useState("")
  const [values, setValues] = useState<RegistryValue[]>([])
  const [valueName, setValueName] = useState("")
  const [valueKind, setValueKind] = useState<RegistryValueKind>("string")
  const [editorValue, setEditorValue] = useState("")
  const [command, setCommand] = useState<RegistryCommand | null>(null)
  const [lastMutation, setLastMutation] = useState<RegistryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refreshedMutations = useRef(new Set<string>())
  const targetId = selectedIds[0] ?? null
  const selectedClient = clients.find((client) => client.id === targetId) ?? null
  const terminal = command ? terminalRegistryStatuses.includes(command.status as (typeof terminalRegistryStatuses)[number]) : true
  const busy = submitting || !terminal

  const sendPayload = useCallback(async (payload: RegistryPayload) => {
    if (!targetId) return null
    setSubmitting(true)
    setError(null)
    try {
      const fresh = await apiRequest<Client>(`/clients/${encodeURIComponent(targetId)}`)
      if (fresh.os !== "Windows" || fresh.status !== "online") throw new Error("目标 Windows 客户端当前不在线")
      const created = await apiRequest<RegistryCommand>(`/clients/${encodeURIComponent(targetId)}/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "manage-registry", payload }),
      })
      setCommand(created)
      return created
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交注册表命令失败")
      return null
    } finally {
      setSubmitting(false)
    }
  }, [apiRequest, targetId])

  const refreshValues = useCallback(async (nextHive = hive, nextView = view, nextSubKey = subKey) => {
    try {
      const payload = registryPayload("list", nextHive, nextView, nextSubKey)
      setLoading(true)
      return await sendPayload(payload)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "注册表路径无效")
      return null
    } finally {
      setLoading(false)
    }
  }, [hive, sendPayload, subKey, view])

  useEffect(() => {
    if (os !== "windows" || !targetId) {
      setValues([])
      setCommand(null)
      return
    }
    let active = true
    setLoading(true)
    void apiRequest<RegistryCommand[]>(`/commands?clientId=${encodeURIComponent(targetId)}`)
      .then((history) => {
        if (!active) return
        const latest = latestRegistryCommand(history.filter((item) => item.type === "manage-registry"))
        if (!latest) return
        setCommand(latest)
        setHive(latest.payload.hive)
        setView(latest.payload.view)
        setSubKey(latest.payload.subKey)
        const result = parseRegistryResult(latest.result)
        if (!result) { setError("最近的注册表结果格式无效"); return }
        if (result.action === "list" && result.values) setValues(result.values)
        if (result.action === "set" || result.action === "delete") setLastMutation(result)
        if (result.error) setError(`${result.error.code}: ${result.error.message}`)
      })
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : "恢复注册表命令失败"))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [apiRequest, os, targetId])

  useEffect(() => {
    if (!command || terminal) return
    let active = true
    const poll = async () => {
      try {
        const history = await apiRequest<RegistryCommand[]>(`/commands?clientId=${encodeURIComponent(command.clientId)}`)
        const next = history.find((item) => item.id === command.id)
        if (active && next) setCommand(next)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "刷新注册表命令失败")
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [apiRequest, command, terminal])

  useEffect(() => {
    if (!command || !terminal) return
    const result = parseRegistryResult(command.result)
    if (!result) {
      if (command.status !== "canceled") setError("注册表命令返回了无效的结构化结果")
      return
    }
    if (result.error) { setError(`${result.error.code}: ${result.error.message}`); return }
    if (result.action === "list") { setValues(result.values ?? []); setError(null); return }
    if (result.action === "get" && result.current) {
      selectValue(result.current)
      return
    }
    if (result.action === "set" || result.action === "delete") {
      setLastMutation(result)
      if (command.status === "success" && !refreshedMutations.current.has(command.id)) {
        refreshedMutations.current.add(command.id)
        void refreshValues(result.hive, result.view, result.subKey)
      }
    }
  }, [command, refreshValues, terminal])

  const selectValue = (value: RegistryValue) => {
    setValueName(value.valueName)
    setValueKind(value.valueKind)
    setEditorValue(value.valueKind === "multiString" ? (value.value as string[]).join("\n") : String(value.value))
  }

  const runSet = async () => {
    if (!selectedClient || busy) return
    try {
      const parsed = parseRegistryEditorValue(valueKind, editorValue)
      const payload = registryPayload("set", hive, view, subKey, valueName, valueKind, parsed)
      if (!(await confirm({
        title: "设置注册表值？",
        description: "写操作会记录逆向动作，可在下方回滚。",
        body: `客户端：${selectedClient.name}\n路径：${hive}\\${subKey}\n视图：${view}\n值名：${valueName || "（默认）"}\n类型：${valueKind}`,
        confirmLabel: "写入",
        tone: "warning",
      }))) return
      await sendPayload(payload)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "注册表值格式无效") }
  }

  const runDelete = async () => {
    if (!selectedClient || busy) return
    try {
      const payload = registryPayload("delete", hive, view, subKey, valueName)
      if (!(await confirm({
        title: "删除该注册表值？",
        description: "仅删除值本身，不会删除所在键。",
        body: `客户端：${selectedClient.name}\n路径：${hive}\\${subKey}\n值名：${valueName || "（默认）"}`,
        confirmLabel: "删除",
        tone: "danger",
      }))) return
      await sendPayload(payload)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "删除参数无效") }
  }

  const rollback = async () => {
    if (!lastMutation || busy) return
    const inverse = inverseRegistryPayload(lastMutation)
    if (!inverse) { setError("最近写操作没有可执行的逆向回滚"); return }
    if (!(await confirm({
      title: "回滚上次注册表写操作？",
      body: `逆向动作：${inverse.action}\n路径：${inverse.hive}\\${inverse.subKey}\n值名：${inverse.valueName || "（默认）"}`,
      confirmLabel: "回滚",
      tone: "warning",
    }))) return
    await sendPayload(inverse)
  }

  const binaryBytes = valueKind === "binary" ? registryBinaryDecodedBytes(editorValue.trim()) : null
  const validPath = isValidRegistrySubKey(subKey)
  const validName = isValidRegistryValueName(valueName)
  const rollbackPayload = lastMutation ? inverseRegistryPayload(lastMutation) : null

  if (os !== "windows") return <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">注册表管理仅支持 Windows 客户端。</p>
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <TargetPicker os="windows" clientId={clientId} selectedIds={selectedIds} onChange={setSelectedIds} multiple={false} onlineOnly />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[110px_130px_minmax(0,1fr)_auto] sm:items-end">
        <Field label="Hive"><select value={hive} onChange={(event) => setHive(event.target.value as RegistryHive)} className={inputCls}><option value="HKLM">HKLM</option><option value="HKU">HKU</option></select></Field>
        <Field label="View"><select value={view} onChange={(event) => setView(event.target.value as RegistryView)} className={inputCls}><option value="registry64">64 位</option><option value="registry32">32 位</option></select></Field>
        <Field label="注册表子路径" icon={<KeyRound className="h-3.5 w-3.5" />}><input value={subKey} onChange={(event) => setSubKey(event.target.value)} className={cn(inputCls, "font-mono")} placeholder="SOFTWARE\\Vendor\\Product" /></Field>
        <PrimaryButton disabled={!targetId || !validPath || busy} onClick={() => void refreshValues()} icon={<RotateCw className={cn("h-4 w-4", (loading || busy) && "animate-spin")} />}>读取</PrimaryButton>
      </div>

      {error && <div role="alert" className="rounded-xl border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative">{error}</div>}
      {command && <p className="text-xs text-muted-foreground">命令 <span className="font-mono">{command.id}</span> · {command.status} · {command.payload.action}</p>}

      <Field label="键值列表">
        <div className="overflow-x-auto rounded-2xl border border-border">
          <div className="min-w-[680px]">
          <div className="grid grid-cols-[1.2fr_1fr_2fr_90px] gap-2 bg-surface px-4 py-2.5 text-xs font-medium text-muted-foreground">
            <span>名称</span>
            <span>类型</span>
            <span>数据</span>
            <span>字节</span>
          </div>
          {values.length === 0 && <p className="px-4 py-5 text-sm text-muted-foreground">{loading ? "正在读取真实注册表值…" : "当前键没有值，或尚未读取。"}</p>}
          {values.map((registryValue, index) => <button type="button" key={`${registryValue.valueName}:${registryValue.valueKind}`} onClick={() => selectValue(registryValue)} className={cn("grid w-full grid-cols-[1.2fr_1fr_2fr_90px] gap-2 px-4 py-3 text-left text-xs transition-colors hover:bg-surface/60", index !== values.length - 1 && "border-b border-border")}><span className="truncate font-mono font-medium text-foreground">{registryValue.valueName || "（默认）"}</span><span className="truncate text-muted-foreground">{registryValue.valueKind}</span><span className="truncate font-mono text-muted-foreground" title={registryValuePreview(registryValue)}>{registryValuePreview(registryValue)}</span><span className="font-mono text-muted-foreground">{registryValue.sizeBytes}</span></button>)}
          </div>
        </div>
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
        <Field label="值名称（空值代表默认值）"><input value={valueName} onChange={(event) => setValueName(event.target.value)} className={cn(inputCls, "font-mono")} placeholder="ValueName" /></Field>
        <Field label="值类型"><select value={valueKind} onChange={(event) => setValueKind(event.target.value as RegistryValueKind)} className={inputCls}>{registryValueKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></Field>
      </div>
      <Field label={valueKind === "multiString" ? "数据（每行一个字符串）" : valueKind === "binary" ? `数据（规范 Base64${binaryBytes === null ? "" : `，解码 ${binaryBytes} 字节`}）` : "数据"}>
        <textarea value={editorValue} onChange={(event) => setEditorValue(event.target.value)} className={cn(inputCls, "min-h-24 resize-y py-3 font-mono")} placeholder={valueKind === "binary" ? "AAECAw==" : valueKind === "multiString" ? "line one\nline two" : "值"} />
      </Field>

      {lastMutation && <div className="rounded-2xl border border-border bg-surface/50 p-4 text-xs"><p className="font-medium text-foreground">最近写操作：{lastMutation.action} · changed:{String(lastMutation.changed)}</p><p className="mt-2 break-all font-mono text-muted-foreground">旧值：{registryValuePreview(lastMutation.previous)}</p><p className="mt-1 break-all font-mono text-muted-foreground">新值：{registryValuePreview(lastMutation.current)}</p></div>}

      <div className="mt-auto flex flex-wrap justify-end gap-3 border-t border-border pt-4">
        <button type="button" disabled={!rollbackPayload || busy} onClick={() => void rollback()} className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-40"><RotateCw className="h-4 w-4" />回滚上次操作</button>
        <button type="button" disabled={!targetId || !validPath || !validName || busy} onClick={() => void runDelete()} className="flex h-11 items-center gap-2 rounded-xl border border-negative/40 px-4 text-sm font-medium text-negative hover:bg-negative/10 disabled:opacity-40"><Trash2 className="h-4 w-4" />删除值</button>
        <PrimaryButton disabled={!targetId || !validPath || !validName || busy} onClick={() => void runSet()} icon={<Plus className="h-4 w-4" />}>设置值</PrimaryButton>
      </div>
    </div>
  )
}

/* ---------- 子功能：Windows 服务清单与控制 ---------- */
type ServiceAction = ServiceControlAction
type ServiceCommand = {
  id: string
  clientId: string
  status: CommandStatus
  result: string | null
}
const serviceActions: { id: ServiceAction; label: string }[] = [
  { id: "query", label: "查询" },
  { id: "start", label: "启动" },
  { id: "stop", label: "停止" },
  { id: "restart", label: "重启" },
]

type TerminateProcessCommand = {
  id: string
  clientId: string
  type: string
  status: CommandStatus
  result: string | null
}

type ProcessInventoryViewProps = {
  inventory: WindowsProcessListResult
  processes: WindowsProcessItem[]
  search: string
  sort: ProcessSort
  selectedProcessId: number | null
  actionsSupported: boolean
  busyProcessId: number | null
  busyAction: ProcessMenuAction | null
  onSearch: (value: string) => void
  onSort: (value: ProcessSort) => void
  onSelect: (process: WindowsProcessItem) => void
  onAction: (process: WindowsProcessItem, action: ProcessMenuAction, options?: ProcessMenuActionOptions) => void
}

function ProcessInventoryView({ inventory, processes, search, sort, selectedProcessId, actionsSupported, busyProcessId, busyAction, onSearch, onSort, onSelect, onAction }: ProcessInventoryViewProps) {
  const capturedAt = new Date(inventory.capturedAtUtc).toLocaleString("zh-CN")
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-surface/45 p-3 sm:p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div><p className="text-sm font-semibold text-foreground">进程快照 · {inventory.returned} 项</p><p className="mt-1 text-xs text-muted-foreground">采集于 {capturedAt} · 采样 {inventory.sampleDurationMs} ms · 点击任意进程回填终止参数</p></div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索进程名、PID 或路径" className={cn(inputCls, "pl-9")} /></div>
          <Select value={sort} onChange={(value) => onSort(value as ProcessSort)} options={[{ value: "cpu", label: "CPU 降序" }, { value: "memory", label: "内存降序" }, { value: "name", label: "名称排序" }, { value: "pid", label: "PID 排序" }]} />
        </div>
      </div>
      {processes.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">当前搜索条件下没有进程。</div> : (
        <>
          <div className="mt-4 hidden overflow-x-auto rounded-xl border border-border md:block">
            <table className="w-full min-w-[1050px] table-fixed text-left text-xs">
              <thead className="bg-background/60 text-muted-foreground"><tr><th className="w-[17%] p-3">进程</th><th className="w-20 p-3">PID</th><th className="w-20 p-3">CPU</th><th className="w-24 p-3">工作集</th><th className="w-24 p-3">专用内存</th><th className="w-20 p-3">状态</th><th className="w-[27%] p-3">映像路径</th><th className="p-3">终止校验</th></tr></thead>
              <tbody>{processes.map((process) => {
                const restriction = processTerminationRestrictionText(process)
                const choose = () => onSelect(process)
                const trigger = <tr role="button" tabIndex={0} aria-label={`选择进程 ${process.processName} PID ${process.processId}`} onClick={choose} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose() } else if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: rect.left + Math.min(rect.width / 2, 160), clientY: rect.top + rect.height / 2 })) } }} className={cn("cursor-pointer border-t border-border align-top outline-none hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary", selectedProcessId === process.processId && "bg-primary/10")}><td className="break-all p-3 font-mono font-medium text-foreground">{process.processName}</td><td className="p-3 font-mono">{process.processId}</td><td className="p-3 font-mono">{process.resources?.cpuPercent == null ? "—" : `${process.resources.cpuPercent.toFixed(2)}%`}</td><td className="p-3 font-mono">{formatProcessBytes(process.resources?.workingSetBytes)}</td><td className="p-3 font-mono">{formatProcessBytes(process.resources?.privateMemoryBytes)}</td><td className="p-3 text-positive">{process.efficiencyMode ? "效能" : "—"}</td><td className="break-all p-3 font-mono text-muted-foreground" title={process.executablePath ?? ""}>{process.executablePath ?? "—"}</td><td className="p-3">{process.canTerminate ? <span className="text-positive">策略允许</span> : <span className="text-warning">{restriction}</span>}</td></tr>
                return <ProcessRowContextMenu key={process.processId} trigger={trigger} process={process} supported={actionsSupported} busyAction={busyProcessId === process.processId ? busyAction : null} onAction={(action, options) => onAction(process, action, options)} />
              })}</tbody>
            </table>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:hidden">{processes.map((process) => {
            const restriction = processTerminationRestrictionText(process)
            return <div key={process.processId} role="button" tabIndex={0} onClick={() => onSelect(process)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(process) } }} className={cn("min-w-0 rounded-xl border border-border bg-background/40 p-3 text-left", selectedProcessId === process.processId && "border-primary bg-primary/10")}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-all font-mono text-sm font-semibold">{process.processName}</p><p className="mt-1 font-mono text-xs text-muted-foreground">PID {process.processId}{process.efficiencyMode ? " · 效能模式" : ""}</p></div><ProcessMobileMenu process={process} supported={actionsSupported} busyAction={busyProcessId === process.processId ? busyAction : null} onAction={(action, options) => onAction(process, action, options)} /></div><p className="mt-2 break-all font-mono text-xs text-muted-foreground">{process.executablePath ?? "映像路径不可读"}</p><div className="mt-3 grid grid-cols-3 gap-2 text-xs"><span>CPU <b className="font-mono">{process.resources?.cpuPercent == null ? "—" : `${process.resources.cpuPercent.toFixed(2)}%`}</b></span><span>工作集 <b className="font-mono">{formatProcessBytes(process.resources?.workingSetBytes)}</b></span><span>专用 <b className="font-mono">{formatProcessBytes(process.resources?.privateMemoryBytes)}</b></span></div><p className={cn("mt-2 text-xs", process.canTerminate ? "text-positive" : "text-warning")}>{process.canTerminate ? "目标 Agent 策略允许终止" : restriction}</p></div>
          })}</div>
        </>
      )}
    </section>
  )
}

function WindowsProcessTerminate({ clientId: fixedClientId }: DetailProps) {
  const { clients, apiRequest } = useServerData()
  const { confirm } = useConfirm()
  const windowsClients = clients.filter((client) => client.os === "Windows")
  const [clientId, setClientId] = useState(fixedClientId ?? windowsClients[0]?.id ?? "")
  const [processId, setProcessId] = useState("")
  const [expectedPath, setExpectedPath] = useState("")
  const [killProcessTree, setKillProcessTree] = useState(true)
  const [timeoutSeconds, setTimeoutSeconds] = useState(30)
  const [inventoryCommand, setInventoryCommand] = useState<TerminateProcessCommand | null>(null)
  const [command, setCommand] = useState<TerminateProcessCommand | null>(null)
  const [actionCommand, setActionCommand] = useState<TerminateProcessCommand | null>(null)
  const [inventory, setInventory] = useState<WindowsProcessListResult | null>(null)
  const [processSearch, setProcessSearch] = useState("")
  const [processSort, setProcessSort] = useState<ProcessSort>("cpu")
  const [selectedProcessId, setSelectedProcessId] = useState<number | null>(null)
  const [selectionWarning, setSelectionWarning] = useState<string | null>(null)
  const [listing, setListing] = useState(false)
  const [busyProcessId, setBusyProcessId] = useState<number | null>(null)
  const [busyAction, setBusyAction] = useState<ProcessMenuAction | null>(null)
  const [pendingSelectPid, setPendingSelectPid] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [inventoryError, setInventoryError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const windowsClientKey = windowsClients.map((client) => client.id).join("|")
  const refreshedActionId = useRef<string | null>(null)

  useEffect(() => {
    if (fixedClientId) {
      if (clientId !== fixedClientId) setClientId(fixedClientId)
      return
    }
    if (windowsClients.some((client) => client.id === clientId)) return
    setClientId(windowsClients[0]?.id ?? "")
  }, [clientId, fixedClientId, windowsClientKey])

  useEffect(() => {
    setInventory(null)
    setInventoryCommand(null)
    setCommand(null)
    setActionCommand(null)
    setProcessId("")
    setExpectedPath("")
    setSelectedProcessId(null)
    setSelectionWarning(null)
    setInventoryError(null)
    setError(null)
    setListing(false)
    setBusyProcessId(null)
    setBusyAction(null)
    setPendingSelectPid(null)
  }, [clientId])

  useEffect(() => {
    if (!inventoryCommand || terminalCommandStatuses.includes(inventoryCommand.status)) return
    let active = true
    const poll = async () => {
      try {
        const commands = await apiRequest<TerminateProcessCommand[]>(`/commands?clientId=${encodeURIComponent(inventoryCommand.clientId)}`)
        const next = commands.find((item) => item.id === inventoryCommand.id)
        if (active && next) setInventoryCommand(next)
      } catch (caught) {
        if (active) setInventoryError(caught instanceof Error ? caught.message : "进程清单命令状态查询失败")
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [apiRequest, inventoryCommand?.clientId, inventoryCommand?.id, inventoryCommand?.status])

  useEffect(() => {
    if (!command || terminalCommandStatuses.includes(command.status)) return
    let active = true
    const poll = async () => {
      try {
        const commands = await apiRequest<TerminateProcessCommand[]>(`/commands?clientId=${encodeURIComponent(command.clientId)}`)
        const next = commands.find((item) => item.id === command.id)
        if (active && next) setCommand(next)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "命令状态查询失败")
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [apiRequest, command?.clientId, command?.id, command?.status])

  useEffect(() => {
    if (!actionCommand || terminalCommandStatuses.includes(actionCommand.status)) return
    let active = true
    const poll = async () => {
      try {
        const commands = await apiRequest<TerminateProcessCommand[]>(`/commands?clientId=${encodeURIComponent(actionCommand.clientId)}`)
        const next = commands.find((item) => item.id === actionCommand.id)
        if (active && next) setActionCommand(next)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "进程操作状态查询失败")
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [apiRequest, actionCommand?.clientId, actionCommand?.id, actionCommand?.status])

  const selectedClient = windowsClients.find((client) => client.id === clientId)
  const inventorySupported = Boolean(selectedClient && supportsProcessInventory(selectedClient.version))
  const actionsSupported = Boolean(selectedClient && supportsProcessActions(selectedClient.version))
  const listResult = parseWindowsProcessListResult(inventoryCommand?.result ?? null)
  const visibleProcesses = useMemo(
    () => filterAndSortProcesses(inventory?.processes ?? [], processSearch, processSort),
    [inventory, processSearch, processSort],
  )
  const normalizedPath = expectedPath.trim()
  const valid = Boolean(
    selectedClient &&
    isValidProcessId(processId) &&
    isAbsoluteWindowsExecutablePath(normalizedPath) &&
    isValidProcessTimeout(timeoutSeconds),
  )
  const parsedResult = parseTerminateProcessResult(command?.result ?? null)
  const actionTerminateResult = actionCommand?.type === "terminate-process" ? parseTerminateProcessResult(actionCommand.result) : null
  const actionRestartResult = actionCommand?.type === "restart-process" ? parseRestartProcessResult(actionCommand.result) : null
  const actionEfficiencyResult = actionCommand?.type === "set-process-efficiency" ? parseSetProcessEfficiencyResult(actionCommand.result) : null

  useEffect(() => {
    if (!inventoryCommand || !terminalCommandStatuses.includes(inventoryCommand.status)) return
    setListing(false)
    if (listResult) {
      setInventory(listResult)
      if (listResult.error) setInventoryError(listResult.error)
      if (pendingSelectPid !== null) {
        const replacement = listResult.processes.find((process) => process.processId === pendingSelectPid)
        if (replacement) selectProcess(replacement)
        setPendingSelectPid(null)
      } else if (selectedProcessId !== null && !listResult.processes.some((process) => process.processId === selectedProcessId)) {
        setSelectedProcessId(null)
      }
    } else if (inventoryCommand.result) {
      setInventoryError("Agent 返回了未通过完整字段校验的进程清单")
    }
  }, [inventoryCommand?.id, inventoryCommand?.status, inventoryCommand?.result])

  useEffect(() => {
    if (!actionCommand || !terminalCommandStatuses.includes(actionCommand.status) || refreshedActionId.current === actionCommand.id) return
    refreshedActionId.current = actionCommand.id
    setBusyProcessId(null)
    setBusyAction(null)
    if (actionCommand.status === "success" && actionRestartResult?.newProcessId) setPendingSelectPid(actionRestartResult.newProcessId)
    void fetchProcesses()
  }, [actionCommand?.id, actionCommand?.status, actionCommand?.result])

  async function fetchProcesses() {
    if (!selectedClient || !inventorySupported || selectedClient.status !== "online" || listing) return
    setListing(true)
    setInventoryError(null)
    try {
      const freshClient = await apiRequest<Client>(`/clients/${encodeURIComponent(selectedClient.id)}`)
      if (freshClient.os !== "Windows" || freshClient.status !== "online") throw new Error(`客户端 ${freshClient.name} 当前离线，无法获取进程`)
      const created = await apiRequest<TerminateProcessCommand>(`/clients/${encodeURIComponent(freshClient.id)}/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "list-processes", payload: {} }),
      })
      setInventoryCommand(created)
    } catch (caught) {
      setListing(false)
      setInventoryError(caught instanceof Error ? caught.message : "进程清单获取失败")
    }
  }

  function selectProcess(process: WindowsProcessItem) {
    const selection = processFormSelection(process)
    setProcessId(selection.processId)
    setExpectedPath(selection.expectedPath)
    setSelectionWarning(selection.warning)
    setSelectedProcessId(process.processId)
  }

  async function runProcessAction(process: WindowsProcessItem, action: ProcessMenuAction, options: ProcessMenuActionOptions = {}) {
    if (!selectedClient || !actionsSupported || busyAction || !process.executablePath || !process.startedAtUtc) return
    const identity = { processId: process.processId, expectedPath: process.executablePath, expectedStartedAtUtc: process.startedAtUtc }
    if (action === "terminate" && !options.confirmedByMenu) {
      if (!(await confirm({ title: `终止进程 ${process.processName}？`, description: "只终止当前 PID，不终止完整进程树。", body: `客户端：${selectedClient.name}\nPID：${process.processId}\n路径：${process.executablePath}`, confirmLabel: "终止进程", tone: "danger" }))) return
    } else if (action === "restart" && !options.confirmedByMenu) {
      if (!(await confirm({ title: `重启进程 ${process.processName}？`, description: "Agent 将终止原进程树，并在原活动用户会话中使用原启动参数重新启动。", body: `客户端：${selectedClient.name}\nPID：${process.processId}\n路径：${process.executablePath}`, confirmLabel: "重启进程", tone: "warning" }))) return
    } else if (options.enabled && !(await confirm({ title: `为 ${process.processName} 启用效能模式？`, description: "将启用 Windows EcoQoS 并降低该 PID 的进程优先级。", body: `客户端：${selectedClient.name}\nPID：${process.processId}`, confirmLabel: "启用效能模式", tone: "warning" }))) return

    setBusyProcessId(process.processId)
    setBusyAction(action)
    setError(null)
    setActionCommand(null)
    selectProcess(process)
    try {
      const body = action === "terminate"
        ? { type: "terminate-process", payload: { ...identity, timeoutSeconds, killProcessTree: false } }
        : action === "restart"
          ? { type: "restart-process", payload: { ...identity, timeoutSeconds } }
          : { type: "set-process-efficiency", payload: { ...identity, enabled: Boolean(options.enabled) } }
      const created = await apiRequest<TerminateProcessCommand>(`/clients/${encodeURIComponent(selectedClient.id)}/commands`, { method: "POST", body: JSON.stringify(body) })
      setActionCommand(created)
    } catch (caught) {
      setBusyProcessId(null)
      setBusyAction(null)
      setError(caught instanceof Error ? caught.message : "进程操作命令下发失败")
    }
  }

  async function submit() {
    if (!selectedClient || !valid || submitting) return
    setSubmitting(true)
    setError(null)
    setCommand(null)
    try {
      const freshClient = await apiRequest<Client>(`/clients/${encodeURIComponent(selectedClient.id)}`)
      if (freshClient.os !== "Windows") throw new Error("只能向 Windows 客户端下发进程终止命令")
      if (freshClient.status !== "online") throw new Error(`客户端 ${freshClient.name} 当前离线，命令尚未下发`)
      const numericProcessId = Number(processId)
      if (!(await confirm({
        title: `终止 ${freshClient.name} 上的进程 ${numericProcessId}？`,
        description: "Agent 会校验预期路径后再终止，路径不匹配时命令失败。",
        body: `目标客户端：${freshClient.name}\nPID：${numericProcessId}\n预期路径：${normalizedPath}\n终止进程树：${killProcessTree ? "是" : "否"}\n超时：${timeoutSeconds} 秒`,
        confirmLabel: "终止进程",
        tone: "danger",
      }))) return
      const created = await apiRequest<TerminateProcessCommand>(`/clients/${encodeURIComponent(freshClient.id)}/commands`, {
        method: "POST",
        body: JSON.stringify({
          type: "terminate-process",
          payload: { processId: numericProcessId, expectedPath: normalizedPath, timeoutSeconds, killProcessTree },
        }),
      })
      setCommand(created)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "进程终止命令下发失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col gap-5 overflow-auto pr-1">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Field label="目标 Windows 客户端" icon={<AppWindow className="h-3.5 w-3.5" />}>
          <Select
            value={clientId}
            onChange={setClientId}
            disabled={Boolean(fixedClientId)}
            placeholder="选择客户端"
            options={windowsClients.map((client) => ({ value: client.id, label: `${client.name} · ${client.status} · ${client.version}` }))}
          />
        </Field>
        <Field label="进程 ID（PID）" icon={<CircleStop className="h-3.5 w-3.5" />}>
          <input
            inputMode="numeric"
            className={cn(inputCls, "font-mono")}
            value={processId}
            onChange={(event) => { setProcessId(event.target.value); setSelectedProcessId(null); setSelectionWarning(null) }}
            placeholder="1234"
          />
        </Field>
        <div className="flex items-end"><button type="button" onClick={() => void fetchProcesses()} disabled={!selectedClient || selectedClient.status !== "online" || !inventorySupported || listing || Boolean(inventoryCommand && !terminalCommandStatuses.includes(inventoryCommand.status))} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:pointer-events-none disabled:opacity-50 xl:w-auto">{listing || inventoryCommand && !terminalCommandStatuses.includes(inventoryCommand.status) ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}{inventory ? "刷新进程" : "获取进程"}</button></div>
      </div>

      {selectedClient && !inventorySupported && <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">进程清单需要 Agent 1.1.19 或更高版本；当前 {selectedClient.version || "版本未知"} 仍可手工填写 PID 与映像路径。</p>}
      {inventory?.truncated && <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">结果已按 480 KiB 上限截断：显示 {inventory.returned} / {inventory.total} 项。</p>}
      {inventoryError && <div role="alert" className="rounded-xl border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative">{inventoryError}</div>}
      {inventory && <ProcessInventoryView inventory={inventory} processes={visibleProcesses} search={processSearch} sort={processSort} selectedProcessId={selectedProcessId} actionsSupported={actionsSupported} busyProcessId={busyProcessId} busyAction={busyAction} onSearch={setProcessSearch} onSort={setProcessSort} onSelect={selectProcess} onAction={(process, action, options) => void runProcessAction(process, action, options)} />}

      {actionCommand && <section className="rounded-2xl border border-border bg-surface/60 p-4" aria-live="polite"><div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-muted-foreground">右键操作</p><p className="mt-1 font-mono">{actionCommand.type}</p></div><div><p className="text-muted-foreground">命令状态</p><p className="mt-1 font-mono">{actionCommand.status}</p></div>{actionRestartResult && <><div><p className="text-muted-foreground">原 PID</p><p className="mt-1 font-mono">{actionRestartResult.originalProcessId}</p></div><div><p className="text-muted-foreground">新 PID</p><p className="mt-1 font-mono">{actionRestartResult.newProcessId ?? "—"}</p></div></>}{actionEfficiencyResult && <><div><p className="text-muted-foreground">请求状态</p><p className="mt-1 font-mono">{actionEfficiencyResult.requestedEnabled ? "启用" : "关闭"}</p></div><div><p className="text-muted-foreground">最终状态</p><p className="mt-1 font-mono">{actionEfficiencyResult.finalEnabled == null ? "—" : actionEfficiencyResult.finalEnabled ? "已启用" : "已关闭"}</p></div></>}{actionTerminateResult && <div><p className="text-muted-foreground">最终状态</p><p className="mt-1 font-mono">{actionTerminateResult.finalStatus}</p></div>}</div>{(actionRestartResult?.error || actionEfficiencyResult?.error || actionTerminateResult?.error) && <p className="mt-3 text-sm text-negative">{actionRestartResult?.error || actionEfficiencyResult?.error || actionTerminateResult?.error}</p>}</section>}

      <Field label="预期绝对映像路径">
        <input
          className={cn(inputCls, "font-mono")}
          value={expectedPath}
          onChange={(event) => { setExpectedPath(event.target.value); setSelectedProcessId(null); setSelectionWarning(null) }}
          placeholder="C:\\Program Files\\Example\\worker.exe"
        />
      </Field>
      {selectionWarning && <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">{selectionWarning}；提交后仍由 Agent 执行最终身份与路径校验。</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="超时（秒）">
          <input
            type="number"
            min={1}
            max={120}
            step={1}
            value={timeoutSeconds}
            onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
            className={cn(inputCls, "font-mono")}
          />
        </Field>
        <Field label="终止范围">
          <button
            type="button"
            role="switch"
            aria-checked={killProcessTree}
            onClick={() => setKillProcessTree((current) => !current)}
            className={cn(
              "flex h-11 items-center justify-between rounded-xl border px-4 text-sm transition-colors",
              killProcessTree ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface/60 text-muted-foreground",
            )}
          >
            <span>终止完整进程树</span>
            <span className={cn("h-5 w-9 rounded-full p-0.5 transition-colors", killProcessTree ? "bg-primary" : "bg-muted")}>
              <span className={cn("block h-4 w-4 rounded-full bg-white transition-transform", killProcessTree && "translate-x-4")} />
            </span>
          </button>
        </Field>
      </div>

      {(command || error) && (
        <div className="rounded-2xl border border-border bg-surface/60 p-4">
          {command && (
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-muted-foreground">命令 ID</p><p className="mt-1 break-all font-mono text-foreground">{command.id}</p></div>
              <div><p className="text-muted-foreground">状态</p><p className="mt-1 font-mono text-foreground">{command.status}</p></div>
              <div><p className="text-muted-foreground">PID</p><p className="mt-1 font-mono text-foreground">{parsedResult?.processId ?? (processId || "-")}</p></div>
              <div><p className="text-muted-foreground">终止进程树</p><p className="mt-1 font-mono text-foreground">{parsedResult ? (parsedResult.killProcessTree ? "是" : "否") : "-"}</p></div>
              {parsedResult && (
                <>
                  <div className="sm:col-span-2"><p className="text-muted-foreground">预期路径</p><p className="mt-1 break-all font-mono text-foreground">{parsedResult.expectedPath}</p></div>
                  <div className="sm:col-span-2"><p className="text-muted-foreground">实际路径</p><p className="mt-1 break-all font-mono text-foreground">{parsedResult.actualPath ?? "-"}</p></div>
                  <div><p className="text-muted-foreground">初始状态</p><p className="mt-1 font-mono text-foreground">{parsedResult.initialStatus}</p></div>
                  <div><p className="text-muted-foreground">最终状态</p><p className="mt-1 font-mono text-foreground">{parsedResult.finalStatus}</p></div>
                  <div><p className="text-muted-foreground">耗时</p><p className="mt-1 font-mono text-foreground">{parsedResult.durationMs} ms</p></div>
                  <div><p className="text-muted-foreground">超时</p><p className="mt-1 font-mono text-foreground">{parsedResult.timedOut ? "是" : "否"}</p></div>
                </>
              )}
            </div>
          )}
          {(error || parsedResult?.error) && <p className="mt-3 break-words text-sm text-negative">{error || parsedResult?.error}</p>}
        </div>
      )}

      <div className="mt-auto flex justify-end border-t border-border pt-4">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!valid || submitting}
          className="flex h-11 items-center gap-2 rounded-xl bg-negative px-5 text-sm font-semibold text-white transition-transform duration-200 hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleStop className="h-4 w-4" />}
          终止进程
        </button>
      </div>
    </div>
  )
}

function WindowsSystemRestart({ clientId: fixedClientId }: DetailProps) {
  const { clients, apiRequest } = useServerData()
  const windowsClients = clients.filter(
    (client) => client.os === "Windows" && (fixedClientId ? client.id === fixedClientId : client.status === "online"),
  )
  const [clientId, setClientId] = useState(fixedClientId ?? windowsClients[0]?.id ?? "")
  const [delaySeconds, setDelaySeconds] = useState(30)
  const [reason, setReason] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [command, setCommand] = useState<RestartSystemCommand | null>(null)
  const [error, setError] = useState<string | null>(null)
  const clientKey = windowsClients.map((client) => client.id).join("|")

  useEffect(() => {
    if (fixedClientId) {
      if (clientId !== fixedClientId) setClientId(fixedClientId)
      return
    }
    if (windowsClients.some((client) => client.id === clientId)) return
    setClientId(windowsClients[0]?.id ?? "")
    setConfirming(false)
  }, [clientId, clientKey, fixedClientId])

  useEffect(() => {
    if (!confirming) return
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) setConfirming(false)
    }
    window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [confirming, submitting])

  useEffect(() => {
    if (!command || terminalCommandStatuses.includes(command.status)) return
    let active = true
    const poll = async () => {
      try {
        const commands = await apiRequest<RestartSystemCommand[]>(`/commands?clientId=${encodeURIComponent(command.clientId)}`)
        const next = commands.find((item) => item.id === command.id)
        if (active && next) setCommand(next)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "命令状态查询失败")
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [apiRequest, command?.clientId, command?.id, command?.status])

  const selectedClient = windowsClients.find((client) => client.id === clientId)
  const normalizedReason = normalizeRestartReason(reason)
  const valid = Boolean(selectedClient && isValidRestartDelay(delaySeconds) && isValidRestartReason(reason))
  const parsedResult = parseRestartSystemResult(command?.result ?? null)
  const reasonLength = [...reason.trim()].length

  async function confirmRestart() {
    if (!selectedClient || !valid || submitting) return
    setSubmitting(true)
    setError(null)
    setCommand(null)
    try {
      const freshClient = await apiRequest<Client>(`/clients/${encodeURIComponent(selectedClient.id)}`)
      if (freshClient.os !== "Windows") throw new Error("只能向 Windows 客户端下发系统重启命令")
      if (freshClient.status !== "online") throw new Error(`客户端 ${freshClient.name} 当前离线，系统重启命令尚未下发`)
      const created = await apiRequest<RestartSystemCommand>(`/clients/${encodeURIComponent(freshClient.id)}/commands`, {
        method: "POST",
        body: JSON.stringify({
          type: "restart-system",
          payload: { delaySeconds, ...(normalizedReason ? { reason: normalizedReason } : {}) },
        }),
      })
      setCommand(created)
      setConfirming(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "系统重启命令下发失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <div className="rounded-2xl border border-negative/35 bg-negative/8 p-4 text-sm text-foreground">
        <p className="font-semibold text-negative">高风险操作：设备将重启</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Agent 仅在本机策略明确开启后执行，并在设备重新启动、启动标识变化后才报告成功。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={fixedClientId ? "目标 Windows 客户端" : "在线 Windows 客户端"} icon={<AppWindow className="h-3.5 w-3.5" />}>
          <Select
            value={clientId}
            onChange={setClientId}
            disabled={Boolean(fixedClientId)}
            placeholder="选择在线客户端"
            options={windowsClients.map((client) => ({ value: client.id, label: `${client.name} · ${client.status}` }))}
          />
        </Field>
        <Field label="延迟（秒）" icon={<CalendarClock className="h-3.5 w-3.5" />}>
          <input
            type="number"
            min={0}
            max={300}
            step={1}
            value={delaySeconds}
            onChange={(event) => setDelaySeconds(Number(event.target.value))}
            className={cn(inputCls, "font-mono")}
          />
        </Field>
      </div>

      <Field label={`原因（可选，${reasonLength}/256）`}>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          placeholder="例如：Nacho administrator requested restart"
          className={cn(inputCls, "h-auto min-h-24 resize-y py-3")}
        />
      </Field>

      {!isValidRestartReason(reason) && (
        <p className="text-xs text-negative">原因最多 256 个可打印字符，且不得包含换行或控制字符。</p>
      )}

      {(command || error) && (
        <div className="rounded-2xl border border-border bg-surface/60 p-4">
          {command && (
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-muted-foreground">命令 ID</p><p className="mt-1 break-all font-mono text-foreground">{command.id}</p></div>
              <div><p className="text-muted-foreground">状态</p><p className="mt-1 font-mono text-foreground">{command.status}</p></div>
              <div><p className="text-muted-foreground">跨重启阶段</p><p className="mt-1 font-mono text-foreground">{parsedResult?.phase ?? (command.status === "running" ? "等待阶段报告" : "-")}</p></div>
              <div><p className="text-muted-foreground">已核实重启</p><p className="mt-1 font-mono text-foreground">{parsedResult ? (parsedResult.verifiedAfterRestart ? "是" : "否") : "-"}</p></div>
              <div><p className="text-muted-foreground">延迟</p><p className="mt-1 font-mono text-foreground">{parsedResult?.delaySeconds ?? delaySeconds} 秒</p></div>
              <div><p className="text-muted-foreground">耗时</p><p className="mt-1 font-mono text-foreground">{parsedResult ? `${parsedResult.durationMs} ms` : "-"}</p></div>
              <div className="sm:col-span-2"><p className="text-muted-foreground">请求时间</p><p className="mt-1 break-all font-mono text-foreground">{parsedResult?.requestedAt ?? "-"}</p></div>
              <div className="sm:col-span-2"><p className="text-muted-foreground">前一启动标识</p><p className="mt-1 break-all font-mono text-foreground">{parsedResult?.previousBootId ?? "-"}</p></div>
              <div className="sm:col-span-2"><p className="text-muted-foreground">当前启动标识</p><p className="mt-1 break-all font-mono text-foreground">{parsedResult?.currentBootId ?? "-"}</p></div>
              <div className="sm:col-span-4"><p className="text-muted-foreground">原因</p><p className="mt-1 break-words text-foreground">{parsedResult?.reason ?? normalizedReason ?? "未填写"}</p></div>
            </div>
          )}
          {(error || parsedResult?.error) && <p className="mt-3 break-words text-sm text-negative">{error || parsedResult?.error}</p>}
          {command?.result && !parsedResult && <p className="mt-3 text-xs text-negative">Agent 返回了无法解析的结构化结果。</p>}
        </div>
      )}

      <div className="mt-auto flex justify-end border-t border-border pt-4">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={!valid || submitting}
          className="flex h-11 items-center gap-2 rounded-xl bg-negative px-5 text-sm font-semibold text-white transition-transform duration-200 hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
        >
          <RotateCw className="h-4 w-4" />
          检查并重启
        </button>
      </div>

      {confirming && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" role="presentation">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="restart-confirm-title"
            aria-describedby="restart-confirm-description"
            className="w-full max-w-lg rounded-3xl border border-negative/40 bg-card p-6 shadow-2xl"
          >
            <h3 id="restart-confirm-title" className="text-lg font-semibold text-negative">确认系统重启</h3>
            <p id="restart-confirm-description" className="mt-2 text-sm text-muted-foreground">
              设备将重启，未保存的交互式工作可能丢失；最终成功必须由重启后的 Agent 核实。
            </p>
            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 rounded-2xl bg-surface/70 p-4 text-sm">
              <dt className="text-muted-foreground">目标客户端</dt><dd className="break-all font-mono text-foreground">{selectedClient.name}</dd>
              <dt className="text-muted-foreground">延迟</dt><dd className="font-mono text-foreground">{delaySeconds} 秒</dd>
              <dt className="text-muted-foreground">原因</dt><dd className="break-words text-foreground">{normalizedReason ?? "未填写"}</dd>
            </dl>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" autoFocus disabled={submitting} onClick={() => setConfirming(false)} className="h-11 rounded-xl border border-border px-5 text-sm font-medium text-foreground disabled:opacity-50">取消</button>
              <button type="button" disabled={submitting} onClick={() => void confirmRestart()} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-negative px-5 text-sm font-semibold text-white disabled:opacity-50">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                确认，设备将重启
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const logSourceLabels: Record<LogSource, string> = {
  agent: "Agent 诊断",
  system: "Windows System",
  application: "Windows Application",
}

function LogMessage({ message }: { message: string }) {
  if (message.length <= 180) return <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-5">{message || "（空消息）"}</pre>
  return (
    <details className="group max-w-xl">
      <summary className="cursor-pointer break-words text-xs leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {message.slice(0, 180)}… <span className="text-primary group-open:hidden">展开</span><span className="hidden text-primary group-open:inline">收起</span>
      </summary>
      <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-background/50 p-2 font-sans text-xs leading-5">{message}</pre>
    </details>
  )
}

function WindowsLogCollection({ clientId: fixedClientId }: DetailProps) {
  const { clients, apiRequest } = useServerData()
  const windowsClients = clients.filter(
    (client) => client.os === "Windows" && (fixedClientId ? client.id === fixedClientId : client.status === "online"),
  )
  const now = Date.now()
  const [clientId, setClientId] = useState(fixedClientId ?? windowsClients[0]?.id ?? "")
  const [sources, setSources] = useState<LogSource[]>([...logSources])
  const [sinceInput, setSinceInput] = useState(() => dateToUtcInput(new Date(now - 61 * 60 * 1000)))
  const [untilInput, setUntilInput] = useState(() => dateToUtcInput(new Date(now - 60 * 1000)))
  const [maxEntries, setMaxEntries] = useState(200)
  const [command, setCommand] = useState<CollectLogsCommand | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clientKey = windowsClients.map((client) => client.id).join("|")

  useEffect(() => {
    if (fixedClientId) {
      if (clientId !== fixedClientId) setClientId(fixedClientId)
      return
    }
    if (windowsClients.some((client) => client.id === clientId)) return
    setClientId(windowsClients[0]?.id ?? "")
  }, [clientId, clientKey, fixedClientId])

  useEffect(() => {
    if (!command || terminalCommandStatuses.includes(command.status)) return
    let active = true
    const poll = async () => {
      try {
        const commands = await apiRequest<CollectLogsCommand[]>(`/commands?clientId=${encodeURIComponent(command.clientId)}`)
        const next = commands.find((item) => item.id === command.id)
        if (active && next) setCommand(next)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "命令状态查询失败")
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [apiRequest, command?.clientId, command?.id, command?.status])

  const selectedClient = windowsClients.find((client) => client.id === clientId)
  const sinceUtc = utcInputToIso(sinceInput)
  const untilUtc = utcInputToIso(untilInput)
  const windowValid = isValidLogWindow(sinceUtc, untilUtc)
  const valid = Boolean(selectedClient && sources.length > 0 && windowValid && isValidMaxEntries(maxEntries))
  const parsedResult = parseCollectLogsResult(command?.result ?? null)

  function toggleSource(source: LogSource) {
    setSources((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source])
  }

  async function submit() {
    if (!selectedClient || !valid || !sinceUtc || !untilUtc || submitting) return
    setSubmitting(true)
    setError(null)
    setCommand(null)
    try {
      const freshClient = await apiRequest<Client>(`/clients/${encodeURIComponent(selectedClient.id)}`)
      if (freshClient.os !== "Windows") throw new Error("只能向 Windows 客户端下发日志采集命令")
      if (freshClient.status !== "online") throw new Error(`客户端 ${freshClient.name} 当前离线，日志采集命令尚未下发`)
      const created = await apiRequest<CollectLogsCommand>(`/clients/${encodeURIComponent(freshClient.id)}/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "collect-logs", payload: { sources, sinceUtc, untilUtc, maxEntries } }),
      })
      setCommand(created)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "日志采集命令下发失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full min-w-0 max-w-full flex-col gap-5 overflow-auto pr-1">
      <div className="rounded-2xl border border-primary/25 bg-primary/7 p-4 text-sm text-foreground">
        <p className="font-semibold text-primary">只读受限快照</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          仅采集固定 Agent、System 与 Application 来源；目标 Agent 的 allowLogCollection 本机策略会给出最终允许或拒绝反馈。
        </p>
      </div>

      <Field label={fixedClientId ? "目标 Windows 客户端" : "在线 Windows 客户端"} icon={<AppWindow className="h-3.5 w-3.5" />}>
        <Select
          value={clientId}
          onChange={setClientId}
          disabled={Boolean(fixedClientId)}
          placeholder="选择在线客户端"
          options={windowsClients.map((client) => ({ value: client.id, label: `${client.name} · ${client.status}` }))}
        />
      </Field>

      <fieldset className="min-w-0">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">允许的日志来源</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {logSources.map((source) => {
            const selected = sources.includes(source)
            return (
              <button
                key={source}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleSource(source)}
                className={cn(
                  "min-w-0 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  selected ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface/60 text-muted-foreground",
                )}
              >
                <span className="block break-words font-medium">{logSourceLabels[source]}</span>
                <span className="mt-0.5 block font-mono opacity-70">{source}</span>
              </button>
            )
          })}
        </div>
        {sources.length === 0 && <p className="mt-2 text-xs text-negative">至少选择一个固定来源。</p>}
      </fieldset>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Field label="开始时间（UTC）" icon={<CalendarClock className="h-3.5 w-3.5" />}>
          <input type="datetime-local" step={60} value={sinceInput} onChange={(event) => setSinceInput(event.target.value)} className={cn(inputCls, "font-mono")} />
        </Field>
        <Field label="结束时间（UTC）" icon={<CalendarClock className="h-3.5 w-3.5" />}>
          <input type="datetime-local" step={60} value={untilInput} onChange={(event) => setUntilInput(event.target.value)} className={cn(inputCls, "font-mono")} />
        </Field>
        <Field label="最大条数（1–1000）">
          <input type="number" min={1} max={1000} step={1} value={maxEntries} onChange={(event) => setMaxEntries(Number(event.target.value))} className={cn(inputCls, "font-mono")} />
        </Field>
      </div>
      {!windowValid && <p className="text-xs text-negative">UTC 时间必须有效、开始早于结束、跨度不超过 24 小时，且结束时间不得位于未来。</p>}

      {(command || error) && (
        <section className="min-w-0 max-w-full rounded-2xl border border-border bg-surface/60 p-4" aria-live="polite">
          {command && (
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-muted-foreground">命令 ID</p><p className="mt-1 break-all font-mono text-foreground">{command.id}</p></div>
              <div><p className="text-muted-foreground">状态</p><p className="mt-1 font-mono text-foreground">{command.status}</p></div>
              <div><p className="text-muted-foreground">截断</p><p className="mt-1 font-mono text-foreground">{parsedResult ? (parsedResult.truncated ? "是" : "否") : "-"}</p></div>
              <div><p className="text-muted-foreground">耗时</p><p className="mt-1 font-mono text-foreground">{parsedResult ? `${parsedResult.durationMs} ms` : "-"}</p></div>
            </div>
          )}
          {parsedResult && (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {parsedResult.sources.map((source) => (
                  <span key={source} className="rounded-full bg-background/60 px-3 py-1 text-xs text-muted-foreground">
                    {logSourceLabels[source]} <strong className="font-mono text-foreground">{parsedResult.countsBySource[source]}</strong>
                  </span>
                ))}
              </div>
              {parsedResult.error && <p className="mt-3 break-words text-sm text-negative">{parsedResult.error}</p>}
              <div className="mt-4 max-w-full overflow-x-auto rounded-xl border border-border" tabIndex={0} aria-label="采集到的日志表格，可横向滚动">
                {parsedResult.entries.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">所选时间窗口内没有可显示的日志。</div>
                ) : (
                  <table className="min-w-[760px] w-full table-fixed text-left text-xs">
                    <thead className="bg-background/60 text-muted-foreground">
                      <tr><th className="w-40 p-3">UTC 时间</th><th className="w-24 p-3">来源</th><th className="w-24 p-3">级别 / ID</th><th className="w-36 p-3">提供程序</th><th className="p-3">消息</th></tr>
                    </thead>
                    <tbody>
                      {parsedResult.entries.map((entry, index) => (
                        <tr key={`${entry.timestampUtc}-${entry.source}-${entry.eventId ?? "none"}-${index}`} className="border-t border-border align-top">
                          <td className="break-all p-3 font-mono text-muted-foreground">{entry.timestampUtc}</td>
                          <td className="break-words p-3 font-mono">{entry.source}</td>
                          <td className="break-words p-3">{entry.level ?? "-"}<br /><span className="font-mono text-muted-foreground">{entry.eventId ?? "-"}</span></td>
                          <td className="break-words p-3">{entry.provider ?? "-"}</td>
                          <td className="p-3"><LogMessage message={entry.message} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
          {error && <p className="mt-3 break-words text-sm text-negative">{error}</p>}
          {command?.result && !parsedResult && <p className="mt-3 text-xs text-negative">Agent 返回了未通过完整字段校验的结构化结果。</p>}
        </section>
      )}

      <div className="mt-auto flex justify-end border-t border-border pt-4">
        <button type="button" onClick={() => void submit()} disabled={!valid || submitting} className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-50">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileClock className="h-4 w-4" />}
          采集日志快照
        </button>
      </div>
    </div>
  )
}

function WindowsServiceManage({ clientId: fixedClientId }: DetailProps) {
  const { clients, apiRequest } = useServerData()
  const { confirm } = useConfirm()
  const windowsClients = clients.filter((client) => client.os === "Windows")
  const [clientId, setClientId] = useState(fixedClientId ?? windowsClients[0]?.id ?? "")
  const [serviceName, setServiceName] = useState("")
  const [action, setAction] = useState<ServiceAction>("query")
  const [timeoutSeconds, setTimeoutSeconds] = useState(30)
  const [inventoryCommand, setInventoryCommand] = useState<ServiceCommand | null>(null)
  const [controlCommand, setControlCommand] = useState<ServiceCommand | null>(null)
  const [inventory, setInventory] = useState<WindowsServiceListResult | null>(null)
  const [filter, setFilter] = useState<ServiceListFilter>("running")
  const [sort, setSort] = useState<ServiceSort>("cpu")
  const [search, setSearch] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [listing, setListing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refreshedControlId = useRef<string | null>(null)
  const windowsClientKey = windowsClients.map((client) => client.id).join("|")

  useEffect(() => {
    if (fixedClientId) {
      if (clientId !== fixedClientId) setClientId(fixedClientId)
      return
    }
    if (windowsClients.some((client) => client.id === clientId)) return
    setClientId(windowsClients[0]?.id ?? "")
  }, [clientId, fixedClientId, windowsClientKey])

  useEffect(() => {
    setInventory(null)
    setInventoryCommand(null)
    setControlCommand(null)
    setServiceName("")
    setError(null)
  }, [clientId])

  function pollCommand(command: ServiceCommand | null, update: (value: ServiceCommand) => void) {
    if (!command || terminalCommandStatuses.includes(command.status)) return
    let active = true
    const poll = async () => {
      try {
        const commands = await apiRequest<ServiceCommand[]>(`/commands?clientId=${encodeURIComponent(command.clientId)}`)
        const next = commands.find((item) => item.id === command.id)
        if (active && next) update(next)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "命令状态查询失败")
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }

  useEffect(() => {
    return pollCommand(inventoryCommand, setInventoryCommand)
  }, [apiRequest, inventoryCommand?.clientId, inventoryCommand?.id, inventoryCommand?.status])
  useEffect(() => {
    return pollCommand(controlCommand, setControlCommand)
  }, [apiRequest, controlCommand?.clientId, controlCommand?.id, controlCommand?.status])

  const selectedClient = windowsClients.find((client) => client.id === clientId)
  const inventorySupported = Boolean(selectedClient && supportsServiceInventory(selectedClient.version))
  const listResult = parseWindowsServiceListResult(inventoryCommand?.result ?? null)
  const controlResult = parseWindowsServiceControlResult(controlCommand?.result ?? null)
  const visibleServices = useMemo(
    () => filterAndSortServices(inventory?.services ?? [], filter, search, sort),
    [filter, inventory, search, sort],
  )
  const selectedService = inventory?.services.find((service) => service.serviceName === serviceName) ?? null
  const mutationAllowed = action === "query" || !inventorySupported || Boolean(selectedService?.canControl)

  useEffect(() => {
    if (!listResult) return
    setInventory(listResult)
    setListing(false)
    if (listResult.error) setError(listResult.error)
  }, [inventoryCommand?.id, inventoryCommand?.status, inventoryCommand?.result])

  const fetchServices = useCallback(async () => {
    if (!selectedClient || !inventorySupported || selectedClient.status !== "online" || listing) return
    setListing(true)
    setError(null)
    try {
      const created = await apiRequest<ServiceCommand>(`/clients/${encodeURIComponent(selectedClient.id)}/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "manage-service", payload: { action: "list" } }),
      })
      setInventoryCommand(created)
    } catch (caught) {
      setListing(false)
      setError(caught instanceof Error ? caught.message : "服务清单获取失败")
    }
  }, [apiRequest, inventorySupported, listing, selectedClient])

  useEffect(() => {
    if (!controlCommand || !terminalCommandStatuses.includes(controlCommand.status)) return
    if (refreshedControlId.current === controlCommand.id) return
    refreshedControlId.current = controlCommand.id
    void fetchServices()
  }, [controlCommand?.id, controlCommand?.status, fetchServices])

  async function submit() {
    const normalizedName = serviceName.trim()
    if (!selectedClient || !normalizedName || timeoutSeconds < 1 || timeoutSeconds > 120 || !mutationAllowed) return
    if (selectedClient.status !== "online") {
      setError(`客户端 ${selectedClient.name} 当前离线，命令尚未下发`)
      return
    }
    if (!(await confirm({
      title: `对服务“${normalizedName}”执行 ${action}？`,
      body: `目标客户端：${selectedClient.name}\n服务名称：${normalizedName}\n操作：${action}\n超时：${timeoutSeconds} 秒`,
      confirmLabel: "执行",
      tone: action === "stop" || action === "restart" ? "warning" : "default",
    }))) return
    setSubmitting(true)
    setError(null)
    setControlCommand(null)
    try {
      const created = await apiRequest<ServiceCommand>(`/clients/${encodeURIComponent(selectedClient.id)}/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "manage-service", payload: { serviceName: normalizedName, action, timeoutSeconds } }),
      })
      setControlCommand(created)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "服务控制命令下发失败")
    } finally {
      setSubmitting(false)
    }
  }

  function selectService(service: WindowsServiceItem) {
    setServiceName(service.serviceName)
    if (!service.canControl && action !== "query") setAction("query")
  }

  const restriction = selectedService ? serviceControlRestrictionText(selectedService) : null
  const capturedAt = inventory ? new Date(inventory.capturedAtUtc).toLocaleString("zh-CN") : null

  return (
    <div className="flex h-full min-w-0 flex-col gap-5 overflow-auto pr-1">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <Field label="目标 Windows 客户端" icon={<AppWindow className="h-3.5 w-3.5" />}>
          <Select value={clientId} onChange={setClientId} disabled={Boolean(fixedClientId)} placeholder="选择客户端" options={windowsClients.map((client) => ({ value: client.id, label: `${client.name} · ${client.status} · ${client.version}` }))} />
        </Field>
        <div className="flex items-end">
          <button type="button" onClick={() => void fetchServices()} disabled={!selectedClient || selectedClient.status !== "online" || !inventorySupported || listing} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:pointer-events-none disabled:opacity-50 lg:w-auto">
            {listing || inventoryCommand && !terminalCommandStatuses.includes(inventoryCommand.status) ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            {inventory ? "刷新服务" : "获取服务"}
          </button>
        </div>
      </div>

      {selectedClient && !inventorySupported && <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">服务清单需要 Agent 1.1.18 或更高版本；当前 {selectedClient.version || "版本未知"} 仍可使用原有单项查询与控制。</p>}
      {inventory?.truncated && <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">结果已按 480 KiB 上限截断：显示 {inventory.returned} / {inventory.total} 项。</p>}

      {inventory && (
        <section className="min-w-0 rounded-2xl border border-border bg-surface/45 p-3 sm:p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div><p className="text-sm font-semibold text-foreground">服务快照 · {inventory.returned} 项</p><p className="mt-1 text-xs text-muted-foreground">采集于 {capturedAt} · 采样 {inventory.sampleDurationMs} ms；共享 PID 显示宿主进程总占用。</p></div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 sm:w-56"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索服务名或显示名称" className={cn(inputCls, "pl-9")} /></div>
              <Select value={filter} onChange={(value) => setFilter(value as ServiceListFilter)} options={[{ value: "running", label: "运行中" }, { value: "all", label: "全部" }, { value: "stopped", label: "已停止" }]} />
              <Select value={sort} onChange={(value) => setSort(value as ServiceSort)} options={[{ value: "cpu", label: "CPU 降序" }, { value: "memory", label: "内存降序" }, { value: "name", label: "名称排序" }]} />
            </div>
          </div>

          {visibleServices.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">当前筛选条件下没有服务。</div> : (
            <>
              <div className="mt-4 hidden overflow-x-auto rounded-xl border border-border md:block">
                <table className="w-full min-w-[900px] table-fixed text-left text-xs">
                  <thead className="bg-background/60 text-muted-foreground"><tr><th className="w-[28%] p-3">服务</th><th className="w-24 p-3">状态</th><th className="w-24 p-3">PID</th><th className="w-24 p-3">CPU</th><th className="w-28 p-3">工作集</th><th className="w-28 p-3">专用内存</th><th className="p-3">控制</th></tr></thead>
                  <tbody>{visibleServices.map((service) => <tr key={service.serviceName} onClick={() => selectService(service)} className={cn("cursor-pointer border-t border-border align-top hover:bg-primary/5", service.serviceName === serviceName && "bg-primary/10")}><td className="p-3"><p className="break-all font-mono font-medium text-foreground">{service.serviceName}</p><p className="mt-1 break-words text-muted-foreground">{service.displayName}</p>{service.sharedProcess && <p className="mt-1 text-warning">共享宿主 · {service.sharedServiceCount} 项服务</p>}</td><td className="p-3 font-mono">{service.status}</td><td className="p-3 font-mono">{service.processId ?? "—"}</td><td className="p-3 font-mono">{service.resources?.cpuPercent === null || service.resources?.cpuPercent === undefined ? "—" : `${service.resources.cpuPercent.toFixed(2)}%`}</td><td className="p-3 font-mono">{formatServiceBytes(service.resources?.workingSetBytes)}</td><td className="p-3 font-mono">{formatServiceBytes(service.resources?.privateMemoryBytes)}</td><td className="p-3">{service.canControl ? <span className="text-positive">可控制</span> : <span className="text-muted-foreground">{serviceControlRestrictionText(service)}</span>}</td></tr>)}</tbody>
                </table>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:hidden">{visibleServices.map((service) => <button key={service.serviceName} type="button" onClick={() => selectService(service)} className={cn("min-w-0 rounded-xl border border-border bg-background/40 p-3 text-left", service.serviceName === serviceName && "border-primary bg-primary/10")}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-all font-mono text-sm font-semibold">{service.serviceName}</p><p className="mt-1 break-words text-xs text-muted-foreground">{service.displayName}</p></div><span className="shrink-0 font-mono text-xs">{service.status}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><span>PID <b className="font-mono">{service.processId ?? "—"}</b></span><span>CPU <b className="font-mono">{service.resources?.cpuPercent == null ? "—" : `${service.resources.cpuPercent.toFixed(2)}%`}</b></span><span>工作集 <b className="font-mono">{formatServiceBytes(service.resources?.workingSetBytes)}</b></span><span>专用 <b className="font-mono">{formatServiceBytes(service.resources?.privateMemoryBytes)}</b></span></div>{service.sharedProcess && <p className="mt-2 text-xs text-warning">共享宿主进程 · {service.sharedServiceCount} 项服务</p>}<p className="mt-2 text-xs text-muted-foreground">{service.canControl ? "可执行启停与重启" : serviceControlRestrictionText(service)}</p></button>)}</div>
            </>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-border bg-surface/60 p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
          <Field label="已选服务" icon={<Server className="h-3.5 w-3.5" />}><input className={cn(inputCls, "font-mono")} value={serviceName} onChange={(event) => setServiceName(event.target.value)} placeholder="从清单选择，或输入服务名" /></Field>
          <Field label="超时（秒）"><input type="number" min={1} max={120} step={1} value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} className={cn(inputCls, "font-mono")} /></Field>
        </div>
        <Field label="操作"><div className="mt-2"><SegmentedControl fill value={action} onChange={setAction} options={serviceActions} /></div></Field>
        {restriction && <p className="mt-3 text-xs text-warning">{restriction}；仍可执行只读查询。</p>}
        <div className="mt-4 flex justify-end"><button type="button" onClick={() => void submit()} disabled={!selectedClient || !serviceName.trim() || timeoutSeconds < 1 || timeoutSeconds > 120 || submitting || !mutationAllowed} className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:pointer-events-none disabled:opacity-50">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}执行操作</button></div>
      </section>

      {(controlCommand || error) && <div className="rounded-2xl border border-border bg-surface/60 p-4" aria-live="polite">{controlCommand && <div className="grid grid-cols-2 gap-3 text-xs lg:grid-cols-4"><div><p className="text-muted-foreground">命令</p><p className="mt-1 break-all font-mono">{controlCommand.id}</p></div><div><p className="text-muted-foreground">状态</p><p className="mt-1 font-mono">{controlCommand.status}</p></div><div><p className="text-muted-foreground">初始状态</p><p className="mt-1 font-mono">{controlResult?.initialStatus ?? "—"}</p></div><div><p className="text-muted-foreground">最终状态</p><p className="mt-1 font-mono">{controlResult?.finalStatus ?? "—"}</p></div></div>}{(error || controlResult?.error) && <p className="mt-3 break-words text-sm text-negative">{error || controlResult?.error}</p>}</div>}
    </div>
  )
}
const services = [
  { name: "nginx.service", desc: "A high performance web server", running: true },
  { name: "docker.service", desc: "Docker Application Container Engine", running: true },
  { name: "sshd.service", desc: "OpenSSH server daemon", running: true },
  { name: "mysql.service", desc: "MySQL Community Server", running: false },
]

function ServiceManage({ os, clientId }: DetailProps) {
  if (os === "windows") return <WindowsServiceManage os={os} clientId={clientId} />
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <Field label="systemd 服务列表" icon={<Server className="h-3.5 w-3.5" />}>
        <div className="flex flex-col gap-2">
          {services.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface/60 px-4 py-3.5 transition-colors hover:bg-surface"
            >
              <div className="min-w-0 leading-tight">
                <p className="truncate font-mono text-sm font-medium text-foreground">{s.name}</p>
                <p className="truncate text-xs text-muted-foreground">{s.desc}</p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                    s.running ? "bg-primary/12 text-primary" : "bg-surface text-muted-foreground",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", s.running ? "bg-primary" : "bg-muted-foreground/50")} />
                  {s.running ? "active" : "inactive"}
                </span>
                <button className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground">
                  {s.running ? "停止" : "启动"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </Field>

      <TargetPicker os={os} clientId={clientId} />
    </div>
  )
}

/* ---------- 子功能：计划任务（Linux Cron） ---------- */
const cronJobs = [
  { schedule: "0 3 * * *", cmd: "/usr/local/bin/backup.sh", note: "每日 03:00 备份" },
  { schedule: "*/10 * * * *", cmd: "curl -s http://localhost/health", note: "每 10 分钟健康检查" },
  { schedule: "0 0 * * 0", cmd: "apt-get update && apt-get -y upgrade", note: "每周日更新系统" },
]

function CronManage({ os, clientId }: DetailProps) {
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto pr-1">
      <Field label="Crontab 定时任务" icon={<CalendarClock className="h-3.5 w-3.5" />}>
        <div className="flex flex-col gap-2">
          {cronJobs.map((j) => (
            <div
              key={j.cmd}
              className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface/60 px-4 py-3.5 transition-colors hover:bg-surface"
            >
              <div className="min-w-0 leading-tight">
                <p className="truncate font-mono text-sm font-medium text-foreground">{j.cmd}</p>
                <p className="truncate text-xs text-muted-foreground">
                  <span className="font-mono text-primary">{j.schedule}</span> · {j.note}
                </p>
              </div>
              <button
                aria-label="删除任务"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-negative"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </Field>

      <TargetPicker os={os} clientId={clientId} />

      <div className="mt-auto flex justify-end gap-3 border-t border-border pt-4">
        <PrimaryButton icon={<Plus className="h-4 w-4" />}>新建定时任务</PrimaryButton>
      </div>
    </div>
  )
}

/* ---------- 系统类型 & 工具清单 ---------- */
/* 依据客户端信息粗略判断所属系统（无字段时按平均分配以便演示） */
function matchOS(c: Client, os: OS): boolean {
  const raw = `${(c as Record<string, unknown>).os ?? ""} ${(c as Record<string, unknown>).system ?? ""} ${
    (c as Record<string, unknown>).platform ?? ""
  }`.toLowerCase()
  if (raw.includes("win")) return os === "windows"
  if (raw.includes("linux") || raw.includes("ubuntu") || raw.includes("centos") || raw.includes("debian"))
    return os === "linux"
  // 无系统字段时用 id 的哈希稳定分配，保证两个分组都有数据
  const hash = c.id.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0)
  return (hash % 2 === 0) === (os === "windows")
}

type Tool = {
  id: string
  title: string
  desc: string
  icon: LucideIcon
  tint: string
  Detail: (props: DetailProps) => React.ReactElement
}

const windowsTools: Tool[] = [
  { id: "service", title: "服务控制", desc: "获取服务清单、查看占用并执行启停或重启", icon: Server, tint: "oklch(0.72 0.16 60)", Detail: ServiceManage },
  { id: "terminate-process", title: "进程终止", desc: "按 PID 与允许路径安全终止本机进程", icon: CircleStop, tint: "oklch(0.65 0.2 25)", Detail: WindowsProcessTerminate },
  { id: "restart-system", title: "系统重启", desc: "经本机策略确认后重启 Windows 并跨启动核验", icon: RotateCw, tint: "oklch(0.62 0.22 25)", Detail: WindowsSystemRestart },
  { id: "collect-logs", title: "日志采集", desc: "采集受限来源的本机诊断与 Windows 事件快照", icon: FileClock, tint: "oklch(0.5 0.15 200)", Detail: WindowsLogCollection },
  { id: "batch-install", title: "批量安装", desc: "向多台客户端一键部署软件包", icon: DownloadCloud, tint: "oklch(0.82 0.19 145)", Detail: BatchInstall },
  { id: "file-deploy", title: "文件下发", desc: "分发文件到指定目录", icon: FileUp, tint: "oklch(0.5 0.15 200)", Detail: FileDeploy },
  { id: "command", title: "命令执行", desc: "远程运行 CMD / PowerShell", icon: SquareTerminal, tint: "oklch(0.72 0.16 60)", Detail: CommandRun },
  { id: "message", title: "消息推送", desc: "向客户端发送弹窗通知", icon: MessageSquare, tint: "oklch(0.82 0.19 145)", Detail: MessagePush },
  { id: "users", title: "用户管理", desc: "管理系统账户与权限", icon: Users, tint: "oklch(0.5 0.15 200)", Detail: UserManage },
  { id: "webpage", title: "打开网页", desc: "在客户端浏览器打开地址", icon: Globe, tint: "oklch(0.72 0.16 60)", Detail: OpenWebpage },
  { id: "registry", title: "注册表", desc: "查看与编辑注册表键值", icon: KeyRound, tint: "oklch(0.82 0.19 145)", Detail: Registry },
]

const linuxTools: Tool[] = [
  { id: "batch-install", title: "批量安装", desc: "通过 apt / yum 批量装包", icon: DownloadCloud, tint: "oklch(0.82 0.19 145)", Detail: BatchInstall },
  { id: "file-deploy", title: "文件下发", desc: "分发文件到指定目录", icon: FileUp, tint: "oklch(0.5 0.15 200)", Detail: FileDeploy },
  { id: "command", title: "命令执行", desc: "远程运行 Shell 命令", icon: SquareTerminal, tint: "oklch(0.72 0.16 60)", Detail: CommandRun },
  { id: "message", title: "消息推送", desc: "向客户端发送广播通知", icon: MessageSquare, tint: "oklch(0.82 0.19 145)", Detail: MessagePush },
  { id: "users", title: "用户管理", desc: "管理系统账户与权限", icon: Users, tint: "oklch(0.5 0.15 200)", Detail: UserManage },
  { id: "service", title: "服务管理", desc: "管理 systemd 服务状态", icon: Server, tint: "oklch(0.72 0.16 60)", Detail: ServiceManage },
  { id: "cron", title: "计划任务", desc: "编辑 Crontab 定时任务", icon: CalendarClock, tint: "oklch(0.82 0.19 145)", Detail: CronManage },
]

const osTabs: { id: OS; label: string; icon: LucideIcon }[] = [
  { id: "windows", label: "Windows", icon: AppWindow },
  { id: "linux", label: "Linux", icon: Terminal },
]

/* ---------- 单机管理中心（与批量操作的三列大卡片刻意区分） ---------- */

/* 功能按用途分区，单机模式下以分区列表呈现 */
const clientToolSections: { label: string; hint: string; ids: string[] }[] = [
  { label: "运行与进程", hint: "服务、进程与重启", ids: ["service", "terminate-process", "restart-system", "command", "cron"] },
  { label: "文件与部署", hint: "装包与下发", ids: ["batch-install", "file-deploy"] },
  { label: "系统与账户", hint: "账户、注册表与诊断", ids: ["users", "registry", "collect-logs", "message", "webpage"] },
]

/* 单机列表里颜色只承载一个含义：该操作是否会中断业务。
   其余功能一律中性，避免无语义的彩虹色轮转。 */
const disruptiveToolIds = new Set(["restart-system", "terminate-process"])

function formatUptime(seconds: number) {
  if (seconds <= 0) return "—"
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  if (d > 0) return `${d} 天 ${h} 小时`
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`
}

function MetricBar({ label, value }: { label: string; value: number }) {
  /* 水位正常时保持中性：颜色只用来提示越界，三条常态蓝条既噪声大又无信息量。
     阈值色使用 warning/negative 语义令牌，不再硬编码 #dce02d。 */
  const level = value >= 85 ? "bg-negative" : value >= 65 ? "bg-warning" : "bg-primary/70"
  const alerting = value >= 65
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            value >= 85 ? "text-negative" : alerting ? "text-warning" : "text-foreground",
          )}
        >
          {Math.round(value)}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-background/60">
        <div className={cn("h-full rounded-full transition-[width] duration-500", level)} style={{ width: `${Math.min(100, Math.max(2, value))}%` }} />
      </div>
    </div>
  )
}

/* 左侧设备档案：单机管理独有的身份区，批量操作没有 */
function DeviceProfile({ client }: { client: Client }) {
  const s = statusMeta[client.status]
  const brand = resolveOsBrand(client.os, client.osName)
  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: "主机名", value: client.hostname, mono: true },
    { label: "IP 地址", value: client.ip, mono: true },
    { label: "分组", value: client.group || "未分组" },
    { label: "版本", value: client.version, mono: true },
  ]

  return (
    <aside className="flex shrink-0 flex-col gap-4 self-start rounded-2xl border border-border bg-surface/40 p-4 lg:w-64 xl:w-72">
      <div className="flex items-center gap-3">
        {/* 与客户端列表卡保持一致：品牌实色块不再叠加状态光晕，状态由下方文字指示器表达 */}
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: brand.color }}
          title={brand.label}
        >
          <OsLogo brand={brand} className="h-6 w-6 text-white" />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold">{client.name}</p>
          <span className={cn("mt-1 flex items-center gap-1.5 text-xs font-medium", s.text)}>
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", s.dot)} />
            <span className="truncate">
              {s.label} · {brand.label}
            </span>
          </span>
        </div>
      </div>

      <dl className="flex flex-col gap-2 border-t border-border pt-3 text-xs">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className={cn("min-w-0 truncate text-foreground", r.mono && "font-mono")}>{r.value}</dd>
          </div>
        ))}
      </dl>

      {client.metrics ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <MetricBar label="CPU" value={client.metrics.cpu} />
          <MetricBar label="内存" value={client.metrics.memory} />
          <MetricBar label="磁盘" value={client.metrics.disk} />
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            运行 {formatUptime(client.metrics.uptime)}
          </p>
        </div>
      ) : (
        <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">暂无实时指标数据</p>
      )}

      {client.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
          {client.tags.map((tag) => (
            <span key={tag} className="rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}
    </aside>
  )
}

/* 单机功能列表：分区标题 + 左侧色条的紧凑行，与批量操作的实心图标大卡片区分 */
function ClientToolHub({
  client,
  tools,
  onOpen,
}: {
  client: Client
  tools: Tool[]
  onOpen: (id: string) => void
}) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  const used = new Set<string>()
  const sections = clientToolSections
    .map((sec) => {
      const items = sec.ids.map((id) => byId.get(id)).filter((t): t is Tool => Boolean(t))
      items.forEach((t) => used.add(t.id))
      return { ...sec, items }
    })
    .filter((sec) => sec.items.length > 0)
  const rest = tools.filter((t) => !used.has(t.id))
  if (rest.length > 0) sections.push({ label: "其他功能", hint: "扩展命令", items: rest, ids: [] })

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-auto pr-1 lg:flex-row">
      <DeviceProfile client={client} />

      <div className="flex min-w-0 flex-1 flex-col gap-5">
        {sections.map((sec) => (
          <section key={sec.label} className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2.5">
              {/* 主色短竖标：为纵向长列表提供分区节奏，替代原先每张卡的左侧色条 */}
              <span aria-hidden className="h-3.5 w-[3px] shrink-0 rounded-full bg-primary" />
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">{sec.label}</h3>
              <span className="hidden text-[11px] text-muted-foreground/70 sm:inline">{sec.hint}</span>
              <span className="h-px flex-1 bg-border" />
              <span className="font-mono text-[11px] text-muted-foreground/70">{sec.items.length}</span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sec.items.map((t) => {
                const Icon = t.icon
                const disruptive = disruptiveToolIds.has(t.id)
                return (
                  <button
                    key={t.id}
                    onClick={() => onOpen(t.id)}
                    className={cn(
                      "group flex items-center gap-3 rounded-xl border bg-surface/40 px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2",
                      disruptive
                        ? "border-negative/25 hover:border-negative/50 hover:bg-negative/[0.06] focus-visible:ring-negative"
                        : "border-border/70 hover:border-primary/40 hover:bg-surface focus-visible:ring-primary",
                    )}
                  >
                    {/* 裸图标不套方框底。11 个入口同属一类，统一用主色而非彩虹轮转；
                        只有会中断业务的操作跳到 negative 语义色示警。 */}
                    <Icon
                      className={cn(
                        "h-[18px] w-[18px] shrink-0 transition-colors",
                        disruptive ? "text-negative" : "text-primary",
                      )}
                      strokeWidth={1.75}
                    />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-medium">{t.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{t.desc}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

/* 批量操作网格：作用范围条 + 实心图标大卡片（与单机的分区列表刻意区分） */
function BatchToolGrid({ os, tools, onOpen }: { os: OS; tools: Tool[]; onOpen: (id: string) => void }) {
  const { clients } = useServerData()
  const osLabel = os === "windows" ? "Windows" : "Linux"
  const targets = clients.filter((c) => (os === "windows" ? c.os === "Windows" : c.os === "Linux"))
  const online = targets.filter((c) => c.status === "online").length

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* 作用范围：批量模式独有的目标提示 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-primary/25 bg-primary/8 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Users className="h-4 w-4" />
          作用范围
        </span>
        <span className="text-sm text-foreground">全部 {osLabel} 客户端</span>
        {targets.length > 0 && (
          <>
            <span className="hidden h-4 w-px bg-primary/25 sm:block" />
            <span className="font-mono text-xs text-muted-foreground">
              {targets.length} 台目标 · {online} 台在线
            </span>
          </>
        )}
        <span className="ml-auto text-xs text-muted-foreground/80">操作将同时下发到所有匹配设备</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pr-1">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tools.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => onOpen(t.id)}
                className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-surface/60 p-4 text-left transition-all duration-300 hover:-translate-y-1 hover:bg-surface hover:shadow-[0_14px_32px_-10px_oklch(0_0_0_/_55%)]"
              >
                {/* 顶部色条：悬停时铺满整条，强调“批量下发” */}
                <span
                  className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100"
                  style={{ backgroundColor: t.tint }}
                />
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-105"
                    style={{ backgroundColor: t.tint, boxShadow: `0 10px 24px -12px ${t.tint}` }}
                  >
                    <Icon className="h-6 w-6 text-white" />
                  </span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/40 text-muted-foreground transition-all duration-300 group-hover:border-primary/50 group-hover:text-primary">
                    <ChevronRight className="h-4 w-4" />
                  </span>
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="text-sm font-semibold">{t.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.desc}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ManagementPanel({ client, onExit }: { client?: Client; onExit?: () => void }) {
  const clientOS: OS = client?.os === "Linux" ? "linux" : "windows"
  const [os, setOS] = useState<OS>(clientOS)
  const [activeId, setActiveId] = useState<string | null>(null)
  // 当前内容区的进场动画：OS 切换时按药丸方向水平平移，钻取工具时竖直进场
  const [enterAnim, setEnterAnim] = useState("animate-panel-enter")

  const tools = os === "windows" ? windowsTools : linuxTools
  const active = tools.find((t) => t.id === activeId) ?? null

  const osIndex = (o: OS) => osTabs.findIndex((t) => t.id === o)

  const switchOS = (next: OS) => {
    if (next === os) return
    // 药丸右移 → 新内容从右侧滑入；左移 → 从左侧滑入，与滑块同向
    setEnterAnim(osIndex(next) > osIndex(os) ? "animate-slide-in-right" : "animate-slide-in-left")
    setOS(next)
    setActiveId(null)
  }

  // 钻取进入下一层：新卡片从下方上移进场
  const openTool = (id: string) => {
    setEnterAnim("animate-panel-enter")
    setActiveId(id)
  }

  // 返回上一层：方向与钻取相反，上一层卡片从上方下移进场
  const back = () => {
    if (!activeId && client) {
      onExit?.()
      return
    }
    setEnterAnim("animate-panel-enter-down")
    setActiveId(null)
  }

  const showBack = Boolean(active || client)
  const title = active ? active.title : client ? "客户端管理" : "批量操作"
  const description = active
    ? client
      ? `${active.desc} · ${client.name}`
      : active.desc
    : client
      ? `单机模式 · ${client.name} · ${tools.length} 项管理功能`
      : `${os === "windows" ? "Windows" : "Linux"} · ${tools.length} 项批量功能`
  const clientStatus = client ? statusMeta[client.status] : null
  const clientBrand = client ? resolveOsBrand(client.os, client.osName) : null

  return (
    <div className="card-glow flex h-full w-full flex-col overflow-hidden rounded-3xl bg-card p-6">
      {/* 头部 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start">
          <button
            type="button"
            onClick={back}
            aria-label={active ? `返回${client ? "客户端管理" : "批量操作"}菜单` : "返回客户端列表"}
            tabIndex={showBack ? 0 : -1}
            className={cn(
              "mt-0.5 flex h-9 shrink-0 items-center justify-center overflow-hidden rounded-full border transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-x-0.5 hover:bg-surface hover:text-foreground",
              showBack
                ? "mr-3 w-9 border-border text-muted-foreground opacity-100"
                : "mr-0 w-0 border-transparent text-transparent opacity-0",
            )}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
          </button>
          <div className="transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]">
            <h2 className="text-lg font-semibold">
              <MorphText text={title} />
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <MorphText text={description} />
            </p>
          </div>
        </div>

        {client && clientBrand ? (
          <div className="flex items-center gap-3 rounded-full border border-border bg-surface/60 px-3.5 py-2 text-xs">
            <span className={cn("flex items-center gap-1.5 font-medium", clientStatus?.text)}>
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", clientStatus?.dot)} />
              {clientStatus?.label}
            </span>
            <span className="h-4 w-px bg-border" />
            <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <OsLogo brand={clientBrand} className="h-3.5 w-3.5" colored />
              <span className="max-w-48 truncate">{clientBrand.label}</span>
            </span>
          </div>
        ) : (
          <SegmentedControl variant="pill" value={os} onChange={switchOS} options={osTabs} />
        )}
      </div>

      {/* 内容区 */}
      <div key={`${client?.id ?? "batch"}-${os}-${active ? active.id : "hub"}`} className={cn("mt-5 min-h-0 flex-1", enterAnim)}>
        {active ? (
          <active.Detail os={os} clientId={client?.id} />
        ) : client ? (
          <ClientToolHub client={client} tools={tools} onOpen={openTool} />
        ) : (
          <BatchToolGrid os={os} tools={tools} onOpen={openTool} />
        )}
      </div>
    </div>
  )
}

export function ExtensionsPanel() {
  return <ManagementPanel />
}

export function ClientManagementPanel({ client, onBack }: { client: Client; onBack: () => void }) {
  if (client.os === "macOS") {
    return (
      <div className="card-glow flex h-full w-full flex-col overflow-hidden rounded-3xl bg-card p-6">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回客户端列表"
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-lg font-semibold">客户端管理</h2>
            <p className="mt-1 text-sm text-muted-foreground">{client.name} · {client.hostname}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border bg-surface/30 px-6 text-center text-sm text-muted-foreground">
          当前管理命令仅覆盖 Windows 与 Linux 客户端。
        </div>
      </div>
    )
  }

  return <ManagementPanel client={client} onExit={onBack} />
}
