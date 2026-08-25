"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  Check,
  Copy,
  Download,
  History,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Star,
  Tag,
  Timer,
  Trash2,
} from "lucide-react"
import { useServerData } from "@/components/server-data-context"
import { useConfirm } from "@/components/ui/confirm-dialog"
import {
  defaultInstallProfileValues,
  installCommands,
  installScriptUrl,
  type InstallProfile,
  type InstallProfileRevision,
  type InstallProfileValues,
} from "@/lib/install-profiles"
import { cn } from "@/lib/utils"

const inputClass = "h-11 w-full rounded-xl border border-border bg-surface/60 px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:bg-surface"

function Panel({ title, description, action, children }: {
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="card-glow rounded-3xl bg-card p-5 sm:p-6" data-confirm-surface>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-relaxed text-muted-foreground/70">{hint}</span> : null}
    </label>
  )
}

function Toggle({ checked, onChange, label, description }: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 rounded-2xl border border-border bg-surface/50 px-4 py-3 text-left"
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{description}</span>
      </span>
      <span className={cn("relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-muted")}>
        <span className={cn("absolute top-1 h-4 w-4 rounded-full bg-white transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
      </span>
    </button>
  )
}

function Command({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="rounded-2xl border border-border bg-background/40 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-start gap-2 rounded-xl bg-surface/60 p-3">
        <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed">{value}</code>
        <button type="button" onClick={copy} className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-muted-foreground hover:text-foreground">
          {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
    </div>
  )
}

function profileValues(profile: InstallProfile): InstallProfileValues {
  return {
    name: profile.name,
    runMode: profile.runMode,
    agentServerUrl: profile.agentServerUrl,
    heartbeatSeconds: profile.heartbeatSeconds,
    pollSeconds: profile.pollSeconds,
    clientName: profile.clientName,
    group: profile.group,
    tags: profile.tags,
    overwriteExisting: profile.overwriteExisting,
    reEnrollOnServerChange: profile.reEnrollOnServerChange,
  }
}

export function ScriptsView() {
  const { apiRequest, serverBaseUrl } = useServerData()
  const { confirm, promptText } = useConfirm()
  const [profiles, setProfiles] = useState<InstallProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<InstallProfileValues>(defaultInstallProfileValues)
  const [revisions, setRevisions] = useState<InstallProfileRevision[]>([])
  const [artifactVersion, setArtifactVersion] = useState<string>("—")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = profiles.find((profile) => profile.id === selectedId) || null
  const scriptUrl = installScriptUrl(serverBaseUrl, selected?.id)
  const commands = useMemo(() => installCommands(serverBaseUrl, selected?.id), [serverBaseUrl, selected?.id])

  const loadRevisions = useCallback(async (profileId: string) => {
    const next = await apiRequest<InstallProfileRevision[]>(`/install-profiles/${encodeURIComponent(profileId)}/revisions`)
    setRevisions(next)
  }, [apiRequest])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await apiRequest<InstallProfile[]>("/install-profiles")
      setProfiles(next)
      const nextSelected = next.find((profile) => profile.id === selectedId) || next.find((profile) => profile.isDefault) || next[0]
      if (nextSelected) {
        setSelectedId(nextSelected.id)
        setForm(profileValues(nextSelected))
        await loadRevisions(nextSelected.id)
      }
      const response = await fetch(`${serverBaseUrl}/agent/downloads/windows/latest.json`, { signal: AbortSignal.timeout(8000) })
      if (response.ok) {
        const manifest = await response.json() as { version?: string }
        setArtifactVersion(manifest.version || "—")
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载安装档案失败")
    } finally {
      setLoading(false)
    }
  }, [apiRequest, loadRevisions, selectedId, serverBaseUrl])

  useEffect(() => { void load() }, [load])

  const choose = (profile: InstallProfile) => {
    setSelectedId(profile.id)
    setForm(profileValues(profile))
    setError(null)
    void loadRevisions(profile.id).catch((caught) => setError(caught instanceof Error ? caught.message : "加载历史失败"))
  }

  const createProfile = async (copyCurrent: boolean) => {
    setSaving(true)
    setError(null)
    try {
      const values = copyCurrent && selected
        ? { ...profileValues(selected), name: `${selected.name} 副本` }
        : { ...defaultInstallProfileValues }
      const created = await apiRequest<InstallProfile>("/install-profiles", {
        method: "POST",
        body: JSON.stringify({ ...values, note: copyCurrent ? "复制安装档案" : "创建安装档案" }),
      })
      setProfiles((items) => [created, ...items])
      choose(created)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建安装档案失败")
    } finally { setSaving(false) }
  }

  const save = async () => {
    if (!selected) return
    const note = await promptText({
      title: "保存安装档案",
      description: "保存后，同一档案链接会立即使用新参数。",
      label: "版本说明",
      defaultValue: "更新安装参数",
      confirmLabel: "保存",
    })
    if (note === null) return
    setSaving(true)
    setError(null)
    try {
      const updated = await apiRequest<InstallProfile>(`/install-profiles/${encodeURIComponent(selected.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          expectedRevision: selected.revision,
          expectedActiveRevision: selected.activeRevision,
          note,
        }),
      })
      setProfiles((items) => items.map((item) => item.id === updated.id ? updated : item))
      setForm(profileValues(updated))
      await loadRevisions(updated.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存安装档案失败")
    } finally { setSaving(false) }
  }

  const setDefault = async () => {
    if (!selected || selected.isDefault) return
    setSaving(true)
    try {
      const updated = await apiRequest<InstallProfile>(`/install-profiles/${encodeURIComponent(selected.id)}/default`, { method: "POST", body: "{}" })
      setProfiles((items) => items.map((item) => ({ ...item, isDefault: item.id === updated.id })))
    } catch (caught) { setError(caught instanceof Error ? caught.message : "设置默认档案失败") }
    finally { setSaving(false) }
  }

  const remove = async () => {
    if (!selected) return
    if (profiles.length <= 1) {
      setError("至少需要保留一个安装档案；请先新建或复制另一个档案。")
      return
    }
    const accepted = await confirm({
      title: "删除安装档案",
      description: selected.isDefault
        ? `删除默认档案“${selected.name}”及其全部历史版本，并自动将另一个档案设为默认。`
        : `删除“${selected.name}”及其全部历史版本。`,
      confirmLabel: "删除",
      tone: "danger",
    })
    if (!accepted) return
    setSaving(true)
    try {
      const result = await apiRequest<{ id: string; defaultProfileId: string | null }>(
        `/install-profiles/${encodeURIComponent(selected.id)}`,
        { method: "DELETE" },
      )
      const remaining = profiles
        .filter((item) => item.id !== result.id)
        .map((item) => result.defaultProfileId ? { ...item, isDefault: item.id === result.defaultProfileId } : item)
      setProfiles(remaining)
      const next = remaining.find((item) => item.isDefault) || remaining[0] || null
      setSelectedId(next?.id || null)
      if (next) choose(next)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "删除安装档案失败") }
    finally { setSaving(false) }
  }

  const restore = async (revision: InstallProfileRevision) => {
    if (!selected || revision.revision === selected.activeRevision) return
    const accepted = await confirm({
      title: `恢复到版本 ${revision.revision}`,
      description: `仅将当前生效配置切换为 v${revision.revision}；现有版本历史全部保留，也不会生成新版本。`,
      confirmLabel: "恢复",
      tone: "warning",
    })
    if (!accepted) return
    setSaving(true)
    try {
      const updated = await apiRequest<InstallProfile>(`/install-profiles/${encodeURIComponent(selected.id)}/revisions/${revision.revision}/restore`, {
        method: "POST",
        body: JSON.stringify({
          expectedRevision: selected.revision,
          expectedActiveRevision: selected.activeRevision,
          note: `恢复版本 ${revision.revision}`,
        }),
      })
      setProfiles((items) => items.map((item) => item.id === updated.id ? updated : item))
      setForm(profileValues(updated))
      await loadRevisions(updated.id)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "恢复历史版本失败") }
    finally { setSaving(false) }
  }

  if (loading) {
    return <div className="card-glow flex min-h-64 items-center justify-center rounded-3xl bg-card text-sm text-muted-foreground">正在加载真实安装档案…</div>
  }

  return (
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 overflow-y-auto pb-4 pr-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Panel
          title="安装档案"
          description="保存后，档案链接和默认 install.ps1 会由控制服务端实时渲染。"
          action={<span className="rounded-full bg-primary/12 px-3 py-1.5 text-xs font-medium text-primary">Agent {artifactVersion}</span>}
        >
          {error ? <div className="mb-4 rounded-xl border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative">{error}</div> : null}
          <div className="flex flex-wrap gap-2">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => choose(profile)}
                className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors", selectedId === profile.id ? "border-primary bg-primary/12 text-primary" : "border-border bg-surface/50 hover:bg-surface")}
              >
                {profile.isDefault ? <Star className="h-3.5 w-3.5 fill-current" /> : null}
                {profile.name}
                <span className="font-mono text-[10px] opacity-70">v{profile.activeRevision}</span>
              </button>
            ))}
            <button type="button" disabled={saving} onClick={() => void createProfile(false)} className="flex items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
              <Plus className="h-4 w-4" />新建
            </button>
            <button type="button" disabled={!selected || saving} onClick={() => void createProfile(true)} className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
              <Copy className="h-4 w-4" />复制档案
            </button>
          </div>

          {selected ? (
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="档案名称">
                <input className={inputClass} value={form.name} maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </Field>
              <Field label="客户端名称" hint="留空时使用目标机器的 COMPUTERNAME。">
                <input className={inputClass} value={form.clientName || ""} maxLength={100} placeholder="自动使用计算机名" onChange={(event) => setForm({ ...form, clientName: event.target.value || null })} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Agent 服务端地址" hint="仅决定 Agent 最终连接地址；制品仍从当前控制服务端下载。留空时使用当前控制服务端。">
                  <div className="relative">
                    <Server className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                    <input className={cn(inputClass, "pl-10 font-mono")} value={form.agentServerUrl || ""} placeholder={serverBaseUrl} onChange={(event) => setForm({ ...form, agentServerUrl: event.target.value || null })} />
                  </div>
                </Field>
              </div>
              <Field label="心跳间隔（秒）">
                <div className="relative"><Timer className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" /><input type="number" min={5} max={3600} className={cn(inputClass, "pl-10 font-mono")} value={form.heartbeatSeconds} onChange={(event) => setForm({ ...form, heartbeatSeconds: Number(event.target.value) })} /></div>
              </Field>
              <Field label="HTTP 回退轮询（秒）">
                <div className="relative"><RefreshCw className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" /><input type="number" min={5} max={3600} className={cn(inputClass, "pl-10 font-mono")} value={form.pollSeconds} onChange={(event) => setForm({ ...form, pollSeconds: Number(event.target.value) })} /></div>
              </Field>
              <Field label="分组">
                <input className={inputClass} value={form.group} maxLength={80} onChange={(event) => setForm({ ...form, group: event.target.value })} />
              </Field>
              <Field label="标签" hint="使用逗号分隔，最多 20 个。">
                <div className="relative"><Tag className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" /><input className={cn(inputClass, "pl-10")} value={form.tags.join(", ")} onChange={(event) => setForm({ ...form, tags: event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) })} /></div>
              </Field>

              <div className="sm:col-span-2">
                <p className="mb-2 text-xs font-medium text-muted-foreground">运行模式</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(["menu", "silent"] as const).map((mode) => (
                    <button key={mode} type="button" onClick={() => setForm({ ...form, runMode: mode })} className={cn("rounded-2xl border px-4 py-3 text-left", form.runMode === mode ? "border-primary bg-primary/12" : "border-border bg-surface/50")}>
                      <span className="block text-sm font-medium">{mode === "menu" ? "menu（交互菜单）" : "silent（无人值守）"}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{mode === "menu" ? "运行时由用户选择安装、卸载或清除。" : "自动安装，仅输出最终结果；UAC仍正常显示。"}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 sm:col-span-2">
                <Toggle checked={form.overwriteExisting} onChange={(value) => setForm({ ...form, overwriteExisting: value })} label="覆盖已有基础配置" description="升级时覆盖名称、分组、标签、心跳和轮询；关闭时只更新 serverUrl。" />
                <Toggle checked={form.reEnrollOnServerChange} onChange={(value) => setForm({ ...form, reEnrollOnServerChange: value })} label="服务端地址变化时重新入网" description="备份旧 state.dat 并在新服务端注册；关闭开放入网时需通过 NACHO_ENROLLMENT_KEY 提供密钥。" />
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4 sm:col-span-2">
                <button type="button" disabled={saving || selected.isDefault} onClick={() => void setDefault()} className="flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm disabled:opacity-40"><Star className="h-4 w-4" />设为默认</button>
                <button type="button" disabled={saving || profiles.length <= 1} title={profiles.length <= 1 ? "至少需要保留一个安装档案" : undefined} onClick={() => void remove()} className="flex h-10 items-center gap-2 rounded-xl border border-negative/30 px-4 text-sm text-negative disabled:opacity-40"><Trash2 className="h-4 w-4" />删除</button>
                <button type="button" disabled={saving} onClick={() => void save()} className="flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "保存中…" : "保存档案"}</button>
              </div>
            </div>
          ) : null}
        </Panel>

        <Panel title="部署命令" description="标准命令跟随档案保存的模式；菜单和静默命令只覆盖本次运行。">
          <div className="space-y-3">
            <Command label="标准档案命令" value={commands.standard} />
            <Command label="本次强制菜单模式" value={commands.menu} />
            <Command label="本次强制静默模式" value={commands.silent} />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <code className="min-w-0 break-all font-mono text-xs text-muted-foreground">{scriptUrl}</code>
            <a href={scriptUrl} download="install.ps1" className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"><Download className="h-4 w-4" />下载真实脚本</a>
          </div>
        </Panel>
      </div>

      <div className="min-w-0">
        <Panel title="版本历史" description="每次保存记录完整快照；恢复只切换当前生效版本，不新增或删除历史。">
          <div className="space-y-2">
            {revisions.map((revision) => (
              <div key={revision.revision} className="rounded-2xl border border-border bg-surface/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <History className="h-4 w-4 text-primary" />
                      <span className="font-mono text-sm font-semibold">v{revision.revision}</span>
                      {revision.revision === selected?.activeRevision ? <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary">当前生效</span> : null}
                    </div>
                    <p className="mt-2 break-words text-sm">{revision.note || "未填写版本说明"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{new Date(revision.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{revision.snapshot.runMode} · 心跳 {revision.snapshot.heartbeatSeconds}s · 轮询 {revision.snapshot.pollSeconds}s</p>
                  </div>
                  <button type="button" disabled={!selected || revision.revision === selected.activeRevision || saving} onClick={() => void restore(revision)} className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 text-xs disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />恢复</button>
                </div>
              </div>
            ))}
            {revisions.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">暂无真实历史记录。</p> : null}
          </div>
        </Panel>
      </div>
    </div>
  )
}
