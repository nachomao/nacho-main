const assert = require("node:assert/strict")
const { createHash } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const { OFFICIAL_PROFILE } = require("../src/release-manifest.cjs")
const { createUpdater } = require("../src/updates.cjs")
let download, launch

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-install-progress-"))
  const version = "2.0.0", total = 128
  const contents = Buffer.alloc(total, 0x62)
  const digest = "a".repeat(64)
  const asset = { fileName: "NachoPanel-Setup-2.0.0.exe", sizeBytes: total,
    sha256: createHash("sha256").update(contents).digest("hex") }
  const target = { profileId: "official", channel: "stable", component: "panel", version, digest }
  const events = [], spawns = []
  let quit = false
  launch = () => {}
  const updater = createUpdater({
    isPackaged: true, getVersion: () => "1.0.0", getPath: () => root, quit() { quit = true },
  }, {
    platform: "win32", dataDirectory: root, onPanelInstallProgress: (state) => events.push({ ...state, time: Date.now() }),
    settings: { selection: () => ({ profile: OFFICIAL_PROFILE, channel: "stable" }) },
    checker: { async confirm() { return { digest, manifest: { version,
      release: { repository: "nachomao/nacho-main", tag: "v2.0.0" }, assets: { installer: asset } } } } },
    http: { async download(url, file, verified, options) {
      await download(url, file, { ...options, sizeBytes: verified.sizeBytes })
      fs.writeFileSync(file, contents)
    } },
    handoff: async (script, file) => {
      assert.match(fs.readFileSync(script, "utf8"), /Get-FileHash/)
      assert.deepEqual(fs.readFileSync(file), contents)
      spawns.push({ script, file })
      await launch()
    },
  })
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, updater, target, version, total, events, spawns, get quit() { return quit } }
}

test("面板安装报告真实进度、节流字节事件，快照保留最新值且校验后保持忙碌", async (context) => {
  const f = fixture(context)
  let complete, downloaded
  const bytesWritten = new Promise((resolve) => { downloaded = resolve })
  download = async (_url, _file, options) => {
    assert.equal(options.sizeBytes, f.total)
    options.onPhase("downloading")
    options.onProgress(0, f.total)
    options.onProgress(10, f.total)
    options.onProgress(20, f.total)
    downloaded()
    await new Promise((resolve) => { complete = resolve })
    options.onProgress(f.total, f.total)
    options.onPhase("verifying")
  }
  const installing = f.updater.installPanel(f.target)
  assert.equal(f.updater.getPanelInstallState().phase, "preparing", "异步检查前立即准备")
  await bytesWritten
  const snapshot = f.updater.getPanelInstallState()
  assert.equal(snapshot.downloadedBytes, 20, "节流不丢失可恢复快照")
  assert.equal(snapshot.phase, "downloading")
  snapshot.phase = "failed"
  assert.equal(f.updater.getPanelInstallState().phase, "downloading", "快照不能修改主进程状态")
  assert.ok(!f.events.some((state) => state.downloadedBytes === 10 || state.downloadedBytes === 20),
    "200 毫秒内只记录字节，不重复发送")
  await new Promise((resolve) => setTimeout(resolve, 230))
  assert.equal(f.events.at(-1).downloadedBytes, 20, "连接暂停时延迟发送最后一块真实字节")
  assert.equal(f.events.filter((state) => state.downloadedBytes === 20).length, 1)
  await assert.rejects(f.updater.installPanel(f.target), /升级已经在执行/)
  complete()
  assert.deepEqual(await installing, { phase: "installing", version: f.version })
  const phases = f.events.map((event) => event.phase).filter((value, i, all) => !i || value !== all[i - 1])
  assert.deepEqual(phases, ["preparing", "downloading", "verifying", "installing"])
  const full = f.events.findIndex((state) => state.phase === "downloading" && state.downloadedBytes === f.total)
  const verified = f.events.findIndex((state) => state.phase === "verifying")
  assert.ok(full >= 0 && verified > full, "100% 下载事件先于校验，不能直接认为安装完成")
  assert.ok(f.events.every((state, i) => !i || state.revision > f.events[i - 1].revision))
  assert.equal(f.spawns.length, 1)
  assert.equal(f.updater.getPanelInstallState().phase, "installing")
  await assert.rejects(f.updater.installPanel(f.target), /升级已经在执行/, "安装交接后仍拦截重复请求")
  await new Promise((resolve) => setTimeout(resolve, 350))
  assert.equal(f.quit, true)
})

test("下载失败保留错误，下一次重试清空旧错误并显示进度重置", async (context) => {
  const f = fixture(context)
  download = async (_url, _file, options) => {
    options.onPhase("downloading")
    options.onProgress(30, f.total)
    throw new Error("网络中断")
  }
  await assert.rejects(f.updater.installPanel(f.target), /网络中断/)
  assert.equal(f.updater.getPanelInstallState().phase, "failed")
  assert.equal(f.updater.getPanelInstallState().error, "网络中断")
  assert.equal(f.spawns.length, 0)
  download = async (_url, _file, options) => {
    options.onPhase("downloading")
    options.onProgress(30, f.total)
    options.onPhase("retrying")
    assert.equal(f.updater.getPanelInstallState().downloadedBytes, 0)
    options.onPhase("connecting")
    assert.equal(f.updater.getPanelInstallState().phase, "retrying")
    options.onPhase("downloading")
    options.onProgress(f.total, f.total)
    options.onPhase("verifying")
    throw new Error("SHA-256 不匹配")
  }
  const retry = f.updater.installPanel(f.target)
  assert.equal(f.updater.getPanelInstallState().error, null)
  assert.equal(f.updater.getPanelInstallState().downloadedBytes, 0)
  await assert.rejects(retry, /SHA-256 不匹配/)
  assert.equal(f.updater.getPanelInstallState().phase, "failed")
  assert.equal(f.updater.getPanelInstallState().error, "SHA-256 不匹配")
  assert.equal(f.spawns.length, 0, "校验失败不能启动安装程序")
  assert.equal(f.quit, false)
})

test("安装程序启动失败保留面板并释放重试入口", async (context) => {
  const f = fixture(context)
  download = async (_url, _file, options) => {
    options.onPhase("verifying")
    options.onProgress(f.total, f.total)
  }
  launch = () => {
    throw new Error("无法启动安装程序")
  }
  await assert.rejects(f.updater.installPanel(f.target), /无法启动安装程序/)
  assert.equal(f.updater.getPanelInstallState().phase, "failed")
  assert.equal(f.quit, false)
  await assert.rejects(f.updater.installPanel(f.target), /无法启动安装程序/, "失败后可以重新尝试")
})
