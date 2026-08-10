"use client"

import { useEffect, useRef, useState } from "react"
import {
  Code2,
  Download,
  FileCode,
  FolderInput,
  Globe,
  History,
  Keyboard,
  ListChecks,
  Lock,
  RotateCcw,
  Save,
  ShieldCheck,
  Tag,
  Timer,
  Unlock,
} from "lucide-react"
import { cn } from "@/lib/utils"

/* 通用面板外壳：与客户端面板保持一致（card-glow + 圆角 + 标题/描述 + 右侧动作） */
function PanelShell({
  title,
  desc,
  action,
  children,
  className,
}: {
  title: string
  desc: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("card-glow flex w-full flex-col overflow-hidden rounded-3xl bg-card p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
        </div>
        {action}
      </div>
      <div className="mt-5 min-h-0 flex-1">{children}</div>
    </div>
  )
}

/* 表单字段 —— 复用客户端面板的字段样式 */
function Field({
  label,
  icon,
  hint,
  children,
}: {
  label: string
  icon?: React.ReactNode
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      {children}
      {hint && <span className="text-xs text-muted-foreground/70">{hint}</span>}
    </label>
  )
}

const inputCls =
  "h-11 rounded-xl border border-border bg-surface/60 px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:bg-surface"

/* 运行模式选项 */
const runModes = [
  { id: "menu", label: "menu（交互菜单）", desc: "脚本启动后显示菜单，由用户手动选择操作。" },
  { id: "unattended", label: "unattended（无人值守）", desc: "默认静默安装，不显示日志输出。修改后立即生效；如需写入版本历史，仍可点击保存设置。" },
] as const

type RunMode = (typeof runModes)[number]["id"]

type Params = {
  panelUrl: string
  installPath: string
  interval: number
  version: string
  runMode: RunMode
}

const defaultParams: Params = {
  panelUrl: "",
  installPath: "C:\\Program Files\\NachoAgent",
  interval: 5,
  version: "2.3.8",
  runMode: "menu",
}

/* 官方模板：参数会自动注入到脚本头部 */
function buildScript(p: Params): string {
  return `# NachoAgent 安装脚本 (install.ps1)
# 由官方模板自动生成，参数已注入

$PanelUrl    = "${p.panelUrl || "http://panel.example.com:3000"}"
$InstallPath = "${p.installPath}"
$Interval    = ${p.interval}
$Version     = "${p.version}"
$RunMode     = "${p.runMode}"

Write-Host "正在安装 NachoAgent $Version ..." -ForegroundColor Green
New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null

# 心跳上报间隔：$Interval 秒（范围 5~120）
# 运行模式：$RunMode
Write-Host "面板地址：$PanelUrl"
Write-Host "安装目录：$InstallPath"
Write-Host "安装完成。" -ForegroundColor Green
`
}

type HistoryEntry = { id: number; version: string; note: string; time: string }

export function ScriptsView() {
  const [params, setParams] = useState<Params>(defaultParams)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  // 脚本编辑器
  const [editMode, setEditMode] = useState(false)
  const [hintVisible, setHintVisible] = useState(true)
  const [code, setCode] = useState<string>(buildScript(defaultParams))
  const [savedFlash, setSavedFlash] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const toggleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const update = <K extends keyof Params>(key: K, value: Params[K]) =>
    setParams((p) => ({ ...p, [key]: value }))

  const flashSaved = () => {
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1600)
  }

  // 切换编辑模式：先渐隐（375ms），在渐隐中途（200ms）翻转并开始渐显，形成交叉淡入淡出
  const handleToggleEditMode = () => {
    if (toggleTimer.current) {
      clearTimeout(toggleTimer.current)
      toggleTimer.current = null
    }
    setHintVisible(false)
    toggleTimer.current = setTimeout(() => {
      setEditMode((v) => !v)
      setHintVisible(true)
      toggleTimer.current = null
    }, 200)
  }

  // 保存设置：写入版本历史并填写本次迭代说明
  const handleSaveSettings = () => {
    const note = window.prompt("本次迭代说明：", "更新参数配置")
    if (note === null) return
    setHistory((h) => [
      {
        id: Date.now(),
        version: params.version,
        note: note.trim() || "未填写说明",
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
      },
      ...h,
    ])
    flashSaved()
  }

  // 下载 install.ps1：编辑模式下使用编辑器内容，否则使用官方模板
  const handleDownload = () => {
    const content = editMode ? code : buildScript(params)
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "install.ps1"
    a.click()
    URL.revokeObjectURL(url)
  }

  // 保存代码 / Ctrl+S
  const handleSaveCode = () => flashSaved()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        handleSaveCode()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // 卸载时清理切换定时器
  useEffect(() => () => {
    if (toggleTimer.current) clearTimeout(toggleTimer.current)
  }, [])

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto pr-1 lg:grid-cols-2">
      {/* 左列：参数设置 + 版本历史 */}
      <div className="flex flex-col gap-4">
        <PanelShell
          title="参数设置"
          desc="这些参数会自动注入到下载的安装脚本中。"
          action={
            <span className="flex h-8 items-center gap-1.5 rounded-full bg-primary/12 px-3 text-xs font-medium text-primary">
              <Tag className="h-3.5 w-3.5" />
              {params.version}
            </span>
          }
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field
                label="面板地址"
                icon={<Globe className="h-3.5 w-3.5" />}
                hint="例如 10.11.32.200:3000 或 https://panel.example.com"
              >
                <input
                  className={cn(inputCls, "font-mono")}
                  value={params.panelUrl}
                  onChange={(e) => update("panelUrl", e.target.value)}
                  placeholder="https://panel.example.com"
                />
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field label="安装路径" icon={<FolderInput className="h-3.5 w-3.5" />}>
                <input
                  className={cn(inputCls, "font-mono")}
                  value={params.installPath}
                  onChange={(e) => update("installPath", e.target.value)}
                  placeholder="C:\\Program Files\\NachoAgent"
                />
              </Field>
            </div>

            <Field label="上报间隔（秒）" icon={<Timer className="h-3.5 w-3.5" />} hint="范围 5~120，默认 5 秒。">
              <input
                type="number"
                min={5}
                max={120}
                className={cn(inputCls, "font-mono")}
                value={params.interval}
                onChange={(e) => update("interval", Number(e.target.value))}
              />
            </Field>

            <Field label="版本号" icon={<Tag className="h-3.5 w-3.5" />}>
              <input
                className={cn(inputCls, "font-mono")}
                value={params.version}
                onChange={(e) => update("version", e.target.value)}
                placeholder="2.3.8"
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="运行模式" icon={<ListChecks className="h-3.5 w-3.5" />}>
                <div className="flex flex-col gap-2">
                  {runModes.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => update("runMode", m.id)}
                      className={cn(
                        "flex flex-col items-start gap-0.5 rounded-xl border px-4 py-3 text-left transition-all duration-200",
                        params.runMode === m.id
                          ? "border-primary bg-primary/15"
                          : "border-border bg-surface/60 hover:bg-surface",
                      )}
                    >
                      <span
                        className={cn(
                          "text-sm font-medium",
                          params.runMode === m.id ? "text-primary" : "text-foreground",
                        )}
                      >
                        {m.label}
                      </span>
                      <span className="text-xs text-muted-foreground">{m.desc}</span>
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </div>

          <p className="mt-4 text-xs text-muted-foreground/80">
            运行模式会立即生效；其余设置点击保存后会弹窗填写“本次迭代说明”，并写入版本历史。
          </p>

          <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-border pt-4">
            <button
              type="button"
              onClick={handleDownload}
              className="flex h-11 items-center gap-2 rounded-xl border border-border bg-surface/60 px-5 text-sm font-medium text-foreground transition-colors hover:bg-surface"
            >
              <Download className="h-4 w-4" />
              下载 install.ps1
            </button>
            <button
              type="button"
              onClick={handleSaveSettings}
              className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-95"
            >
              <Save className="h-4 w-4" />
              {savedFlash ? "已保存" : "保存设置"}
            </button>
          </div>
        </PanelShell>

        <PanelShell title="版本历史" desc="每次保存脚本会记录一次迭代说明。">
          {history.length > 0 ? (
            <div className="flex flex-col gap-2">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface/60 px-4 py-3.5 transition-colors hover:bg-surface"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-background/40">
                      <History className="h-5 w-5 text-muted-foreground" />
                    </span>
                    <div className="leading-tight">
                      <p className="text-sm font-medium">{h.note}</p>
                      <p className="text-xs text-muted-foreground">{h.time}</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-primary/12 px-3 py-1 font-mono text-xs font-medium text-primary">
                    {h.version}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
              <History className="h-8 w-8" />
              <p className="text-sm">暂无历史记录。保存一次脚本后会自动生成。</p>
            </div>
          )}
        </PanelShell>
      </div>

      {/* 右列：脚本代码编辑器 */}
      <PanelShell
        title="脚本代码编辑器"
        desc="涉及用户可改动的脚本代码统一纳入设置。建议仅在明确需求下开启编辑模式并修改。"
        className="min-h-0"
        action={
          <button
            type="button"
            onClick={handleToggleEditMode}
            className={cn(
              "flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-all duration-200",
              editMode
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:scale-[1.02] active:scale-95"
                : "border border-border bg-surface/60 text-muted-foreground hover:bg-surface hover:text-foreground",
            )}
          >
            {editMode ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            {editMode ? "编辑模式" : "安全模式"}
          </button>
        }
      >
        <div className="flex h-full flex-col">
          {/* 模式说明条：交叉淡入淡出 + 编辑模式红色警示 / 安全模式绿色 */}
          <div
            className={cn(
              "rounded-2xl border px-4 py-3 text-xs leading-relaxed transition-all duration-500",
              editMode
                ? "border-red-500/40 bg-red-500/10 text-red-400"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
            )}
          >
            <span
              className="flex items-start gap-2.5"
              style={{
                opacity: hintVisible ? 1 : 0,
                filter: hintVisible ? "blur(0px)" : "blur(8px)",
                transition:
                  "opacity 375ms cubic-bezier(0.22,1,0.36,1), filter 375ms ease-out",
              }}
            >
              {editMode ? (
                <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              ) : (
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              )}
              <span>
                {editMode
                  ? "已启用编辑模式：下载时将使用下方自定义代码。"
                  : "编辑模式已启用你正在使用自定义脚本覆盖默认模板。错误的改动可能导致客户端安装失败或运行异常，请先在测试机验证。"}
              </span>
            </span>
          </div>

          {/* 代码编辑区 */}
          <div className="mt-4 min-h-[280px] flex-1">
            <textarea
              ref={editorRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              readOnly={!editMode}
              spellCheck={false}
              className={cn(
                "h-full w-full resize-none rounded-2xl border border-border bg-surface/40 p-4 font-mono text-[13px] leading-relaxed text-foreground outline-none transition-colors focus:border-primary/60 focus:bg-surface/60",
                !editMode && "cursor-default text-muted-foreground",
              )}
            />
          </div>

          <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground/70">
            <Keyboard className="h-3.5 w-3.5" />
            快捷键：Ctrl+S / Cmd+S 保存编辑器内容。
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-3 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setCode(buildScript(params))}
              className="flex h-11 items-center gap-2 rounded-xl border border-border bg-surface/60 px-5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" />
              加载当前生效脚本
            </button>
            <button
              type="button"
              onClick={() => setCode(buildScript(defaultParams))}
              className="flex h-11 items-center gap-2 rounded-xl border border-border bg-surface/60 px-5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
            >
              <FileCode className="h-4 w-4" />
              加载官方模板
            </button>
            <button
              type="button"
              onClick={handleSaveCode}
              disabled={!editMode}
              className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
            >
              <Save className="h-4 w-4" />
              {savedFlash ? "已保存" : "保存代码"}
            </button>
          </div>
        </div>
      </PanelShell>
    </div>
  )
}
