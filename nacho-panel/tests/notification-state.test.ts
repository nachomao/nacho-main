import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { canApplyNotificationSnapshot, nextNotificationDayNine, notificationCopyText, notificationUnreadCount } from "../lib/notification-state"
import { playNotificationAnimation } from "../lib/notification-animation"
import { holdForegroundMotion, isForegroundMotionActive } from "../lib/foreground-motion"

const drawerSource = readFileSync(new URL("../components/topbar/notifications-drawer.tsx", import.meta.url), "utf8")
const serverDataSource = readFileSync(new URL("../components/server-data-context.tsx", import.meta.url), "utf8")
const orbSource = readFileSync(new URL("../components/orb.tsx", import.meta.url), "utf8")
const overlaySource = readFileSync(new URL("../components/topbar/overlay.tsx", import.meta.url), "utf8")

test("通知轮询快照仅在 mutation epoch 未变化时生效", () => {
  assert.equal(canApplyNotificationSnapshot(3, 3), true)
  assert.equal(canApplyNotificationSnapshot(3, 4), false)
})

test("通知未读数按组内条目统计", () => {
  assert.equal(notificationUnreadCount([{ read: false }, { read: false, items: [{ read: false }, { read: true }] }]), 2)
})

test("稍后提醒和复制详情生成稳定结果", () => {
  const from = new Date(2026, 8, 14, 22, 30).getTime()
  const next = new Date(nextNotificationDayNine(from))
  assert.equal(next.getDate(), 15)
  assert.equal(next.getHours(), 9)
  assert.equal(notificationCopyText({ title: "失败", detail: "详情", code: "E1" }), "失败\n详情\nCode: E1")
})

test("通知组以同一批卡片执行 iOS 式弹簧堆叠过渡", () => {
  assert.match(drawerSource, /data-notification-stack=\{expanded \? "expanded" : "collapsed"\}/)
  assert.match(drawerSource, /data-stack-card=\{item\.id\}/)
  assert.match(drawerSource, /layoutSnapshot/)
  assert.match(drawerSource, /playNotificationAnimation\(\s*card/)
  assert.match(drawerSource, /origin-top-left shrink-0/)
  assert.match(drawerSource, /expanded !== requestedExpanded/)
  assert.match(drawerSource, /activeAnimations\.current = cleanups/)
  const stackSource = drawerSource.slice(drawerSource.indexOf("function NotificationStack"))
  assert.doesNotMatch(stackSource, /return \(\) => cleanups\.forEach/)
  assert.match(stackSource, /useLayoutEffect\(\(\) => \(\) => \{\s*activeAnimations\.current\.forEach\(\(cancel\) => cancel\(\)\)\s*\}, \[\]\)/)
  assert.match(drawerSource, /cubic-bezier\(0\.22, 1, 0\.36, 1\)/)
  assert.match(drawerSource, /items\.map\(\(item, index\)/)
})

function animationFixture(timelineTime: number | null = 100, now = timelineTime ?? 0) {
  const animation = Object.assign(new EventTarget(), {
    timeline: { currentTime: timelineTime },
    startTime: null as number | null,
    cancellations: 0,
    cancel() { this.cancellations += 1 },
    pause() { assert.fail("展开动画不得暂停后等待下一帧再次播放") },
  })
  let received: { keyframes: Keyframe[]; options: KeyframeAnimationOptions } | undefined
  const element = {
    ownerDocument: { defaultView: { performance: { now: () => now } } },
    animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      received = { keyframes, options }
      return animation
    },
  } as unknown as Element
  return { animation, element, received: () => received }
}

test("通知动画立即绑定当前时间线并保留起止帧和错峰参数", () => {
  const fixture = animationFixture(250)
  const keyframes = [{ height: "98px" }, { height: "236px" }]
  const cancel = playNotificationAnimation(fixture.element, keyframes, { duration: 620, delay: 48, easing: "ease-out" })
  assert.equal(fixture.animation.startTime, 250)
  assert.deepEqual(fixture.received(), { keyframes, options: { duration: 620, delay: 48, easing: "ease-out", fill: "both" } })
  assert.equal(fixture.animation.cancellations, 0)
  fixture.animation.dispatchEvent(new Event("finish"))
  assert.equal(fixture.animation.cancellations, 1)
  cancel()
  assert.equal(fixture.animation.cancellations, 1)
})

test("上一绘制帧的时间戳滞后时不会跳过动画开头", () => {
  const fixture = animationFixture(100, 320)
  const cancel = playNotificationAnimation(fixture.element, [{ height: "98px" }, { height: "236px" }], { duration: 620 })
  assert.equal(fixture.animation.startTime, 320)
  cancel()
})

test("快速反向时旧动画只取消一次且迟到的 finish 不会重复清理", () => {
  const fixture = animationFixture(0)
  const cancel = playNotificationAnimation(fixture.element, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 })
  assert.equal(fixture.animation.startTime, 0)
  cancel()
  fixture.animation.dispatchEvent(new Event("finish"))
  cancel()
  assert.equal(fixture.animation.cancellations, 1)
})

test("前台过渡持有可叠加、可重复释放，并带超时兜底", async () => {
  assert.equal(isForegroundMotionActive(), false)
  const releaseA = holdForegroundMotion(1000)
  const releaseB = holdForegroundMotion(30)
  assert.equal(isForegroundMotionActive(), true)
  releaseA()
  releaseA()
  assert.equal(isForegroundMotionActive(), true)
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(isForegroundMotionActive(), false)
  releaseB()
})

test("通知动画播放期间持有前台优先，结束或取消后释放", () => {
  const fixture = animationFixture(100)
  const cancel = playNotificationAnimation(fixture.element, [{ height: "98px" }, { height: "236px" }], { duration: 620, delay: 48 })
  assert.equal(isForegroundMotionActive(), true)
  fixture.animation.dispatchEvent(new Event("finish"))
  assert.equal(isForegroundMotionActive(), false)
  const second = playNotificationAnimation(fixture.element, [{ opacity: 0 }, { opacity: 1 }], { duration: 340 })
  assert.equal(isForegroundMotionActive(), true)
  second()
  assert.equal(isForegroundMotionActive(), false)
  cancel()
})

test("Orb 在前台过渡期间暂停出帧且时钟同步暂停，弹层过渡登记持有", () => {
  assert.match(orbSource, /if \(isForegroundMotionActive\(\)\) return/)
  assert.match(orbSource, /elapsed \+= dt\s*\n\s*uniforms\.iTime\.value = elapsed/)
  assert.doesNotMatch(orbSource, /uniforms\.iTime\.value = time \* 0\.001/)
  assert.match(overlaySource, /holdForegroundMotion\(overlayTransitionMs \+ 40\)/)
})

test("时间线尚未激活时保留浏览器原生自动播放而非暂停", () => {
  const fixture = animationFixture(null)
  const cancel = playNotificationAnimation(fixture.element, [{ opacity: 0.6 }, { opacity: 1 }], { duration: 160 })
  assert.equal(fixture.animation.startTime, null)
  assert.equal(fixture.animation.cancellations, 0)
  cancel()
})

test("减少动态效果时保留淡入淡出而非完全跳过过渡", () => {
  assert.match(drawerSource, /reducedMotion\s*\? \[\{ opacity: 0\.6 \}, \{ opacity: 1 \}\]/)
  assert.doesNotMatch(drawerSource, /matchMedia\([^\n]+\.matches\) return/)
})

test("单张通知依次展开完整内容和详细日志", () => {
  assert.match(drawerSource, /type CardStage = "compact" \| "full" \| "log"/)
  assert.match(drawerSource, /data-notification-stage=\{visibleStage\}/)
  assert.match(drawerSource, /setStage\("full"\)/)
  assert.match(drawerSource, /setStage\(stage === "full" \? "log" : "compact"\)/)
  assert.match(drawerSource, /事件详细日志/)
})

test("收起通知组时同步重置已展开的卡片", () => {
  assert.match(drawerSource, /if \(forceCompact && stage !== "compact"\)/)
  assert.match(drawerSource, /setStage\("compact"\)/)
  assert.match(drawerSource, /previousHeight\.current = null/)
})

test("收起时首卡不做高度缩放", () => {
  assert.match(drawerSource, /expanded \|\| index !== 0 \? scaleY : 1/)
})

test("通知卡片的圆角、描边和高遮蔽玻璃共用同一裁切层", () => {
  assert.match(drawerSource, /rounded-3xl border bg-card\/\[0\.94\] bg-clip-padding/)
  assert.match(drawerSource, /backdrop-blur-\[36px\] backdrop-saturate-150/)
  assert.match(drawerSource, /relative z-10 flex w-full/)
  assert.doesNotMatch(drawerSource, /absolute inset-0 z-0 bg-card/)
  assert.doesNotMatch(drawerSource, /notice\.read && "opacity-75"/)
})

test("通知中心从真实服务端接口读取数据且不保留临时模拟分支", () => {
  assert.doesNotMatch(serverDataSource, /USE_MOCK_SERVER_DATA|createMockNotifications|mock-notice-/)
  assert.match(serverDataSource, /fetch\(`\$\{connection\.baseUrl\}\/api\/panel\$\{path\}`/)
  assert.match(serverDataSource, /apiRequest<ServerNotification\[\]>\(`\/notifications\?\$\{notificationQuery\}`\)/)
})
