import assert from "node:assert/strict"
import test from "node:test"
import {
  AI_MODE_TIMING,
  OPTICAL_CARD_INITIAL_SIZE,
  buildEnergyArcPath,
  computeCenterCardMorphTarget,
  computeCenterContentBlurMotion,
  computeCenterZoneBlurMotion,
  computeIntroCardContentBlurMotion,
  computeWorkspaceColumnMotion,
  resolveAIOriginPoint,
} from "../lib/ai-mode-transition"

test("resolveAIOriginPoint 计算真实按钮中心并提供右上角默认锚点回退", () => {
  const fromRect = resolveAIOriginPoint(
    { left: 1200, top: 20, width: 110, height: 48 },
    { width: 1440, height: 900 },
  )
  assert.deepEqual(fromRect, { x: 1255, y: 44, vw: 1440, vh: 900 })

  const fallback = resolveAIOriginPoint(null, { width: 1280, height: 800 })
  assert.deepEqual(fallback, { x: 1132, y: 38, vw: 1280, vh: 800 })
})

test("buildEnergyArcPath 生成从触发点指向视口中心的贝塞尔能量弧", () => {
  const origin = resolveAIOriginPoint(
    { left: 1220, top: 18, width: 100, height: 44 },
    { width: 1440, height: 900 },
  )
  const arc = buildEnergyArcPath(origin)
  assert.equal(arc.centerX, 720)
  assert.equal(arc.centerY, 450)
  assert.ok(arc.distance > 600)
  assert.match(arc.path, /^M 1270 40 Q \d+ \d+ 720 450$/)
})

test("computeCenterCardMorphTarget 精确计算中间主卡片四向扩展的目标尺寸与内缩裁剪量", () => {
  const desktop = computeCenterCardMorphTarget({ width: 1440, height: 900 })
  // 1440 - 40(左右 padding) - 272(左卡+gap) - 272(右卡+gap) = 856；900 - 40 = 860
  assert.equal(desktop.width, 856)
  assert.equal(desktop.height, 860)
  assert.equal(desktop.offsetX, 0)
  assert.equal(desktop.offsetY, 0)
  assert.equal(desktop.insetX, Math.round((856 - OPTICAL_CARD_INITIAL_SIZE.width) / 2))
  assert.equal(desktop.insetY, Math.round((860 - OPTICAL_CARD_INITIAL_SIZE.height) / 2))

  // 实测 DOMRect 优先
  const measured = computeCenterCardMorphTarget(
    { width: 1440, height: 900 },
    { left: 292, top: 20, width: 856, height: 860 },
  )
  assert.equal(measured.width, 856)
  assert.equal(measured.height, 860)
  assert.equal(measured.offsetX, 0)
})

test("原内容模糊渐隐与新内容（含顶栏/主体/底栏）模糊渐显保持同步交叉溶解", () => {
  const introIdle = computeIntroCardContentBlurMotion(false)
  const introExpanding = computeIntroCardContentBlurMotion(true)
  assert.equal(introIdle.opacity, 1)
  assert.equal(introIdle.filter, "none")
  assert.equal(introExpanding.opacity, 0)
  assert.equal(introExpanding.filter, "blur(20px)")

  const centerHidden = computeCenterContentBlurMotion(false, false)
  const centerShown = computeCenterContentBlurMotion(true, false)
  const centerSettled = computeCenterContentBlurMotion(true, false, true)
  assert.equal(centerHidden.opacity, 0)
  assert.equal(centerHidden.filter, "blur(24px)")
  assert.equal(centerShown.opacity, 1)
  assert.equal(centerShown.filter, "blur(0px)")
  assert.equal(centerSettled.filter, "none")

  const headerHidden = computeCenterZoneBlurMotion("header", false, false)
  const bodyHidden = computeCenterZoneBlurMotion("body", false, false)
  const footerHidden = computeCenterZoneBlurMotion("footer", false, false)
  assert.equal(headerHidden.opacity, 0)
  assert.match(headerHidden.transform, /translate3d\(0, 56px, 0\)/)
  assert.equal(bodyHidden.filter, "blur(18px)")
  assert.match(footerHidden.transform, /translate3d\(0, -56px, 0\)/)

  const bodyShown = computeCenterZoneBlurMotion("body", true, false)
  const bodySettled = computeCenterZoneBlurMotion("body", true, false, true)
  assert.equal(bodyShown.opacity, 1)
  assert.equal(bodyShown.filter, "blur(0px)")
  assert.equal(bodySettled.filter, "none")
})

test("computeWorkspaceColumnMotion 编排中间卡片四向扩展与左右两张卡片从左右侧逐一切入", () => {
  const morph = computeCenterCardMorphTarget({ width: 1440, height: 900 })
  const hiddenLeft = computeWorkspaceColumnMotion("left", false, false, morph)
  const hiddenCenter = computeWorkspaceColumnMotion("center", false, false, morph)
  const hiddenRight = computeWorkspaceColumnMotion("right", false, false, morph)

  // 未展开时：中栏裁剪为中央加载卡片大小，左卡位于左侧外部 (-88px)，右卡位于右侧外部 (+88px)
  assert.equal(hiddenCenter.clipPath, `inset(${morph.insetY}px ${morph.insetX}px round 16px)`)
  assert.match(hiddenLeft.transform, /translate3d\(-88px/)
  assert.match(hiddenRight.transform, /translate3d\(88px/)

  const shownCenter = computeWorkspaceColumnMotion("center", true, false, morph)
  const shownLeft = computeWorkspaceColumnMotion("left", true, false, morph)
  const shownRight = computeWorkspaceColumnMotion("right", true, false, morph)

  assert.equal(shownCenter.clipPath, "inset(0px 0px round 16px)")
  assert.equal(shownLeft.opacity, 1)
  assert.equal(shownRight.opacity, 1)
  // 左卡先切入（340ms），右卡后切入（520ms）
  assert.match(shownLeft.transition, new RegExp(`${AI_MODE_TIMING.LEFT_CARD_DELAY_MS}ms`))
  assert.match(shownRight.transition, new RegExp(`${AI_MODE_TIMING.RIGHT_CARD_DELAY_MS}ms`))
  assert.ok(AI_MODE_TIMING.LEFT_CARD_DELAY_MS < AI_MODE_TIMING.RIGHT_CARD_DELAY_MS)

  const exitLeft = computeWorkspaceColumnMotion("left", true, true, morph)
  const exitRight = computeWorkspaceColumnMotion("right", true, true, morph)
  assert.equal(exitLeft.opacity, 0)
  assert.match(exitLeft.transform, /translate3d\(-56px/)
  assert.match(exitRight.transform, /translate3d\(56px/)
  assert.ok(AI_MODE_TIMING.HELIX_START_MS < AI_MODE_TIMING.LOCK_START_MS)
  assert.ok(AI_MODE_TIMING.LOCK_START_MS < AI_MODE_TIMING.PORTAL_HANDOFF_MS)
})

