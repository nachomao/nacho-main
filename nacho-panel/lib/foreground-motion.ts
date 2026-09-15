/**
 * 前台动效优先级。
 *
 * 面板底层常驻着全幅 WebGL 光晕（Orb），它每一帧都改写整块背景，迫使合成器每帧重绘
 * 全部覆盖其上的图层与 backdrop-filter。当卡片展开、抽屉滑入这类一次性过渡同时播放时，
 * 双方争抢同一份帧预算，过渡就会退化成“闪现”。
 *
 * 一次性过渡在播放期间登记持有；背景渲染在持有期间暂停出帧（时钟同步暂停，恢复时不跳变），
 * 全部持有释放后自动恢复。持有附带超时兜底，避免动画被外部打断后背景永久停摆。
 */
const holds = new Set<symbol>()

export function isForegroundMotionActive() {
  return holds.size > 0
}

export function holdForegroundMotion(maxDurationMs: number) {
  const token = Symbol("foreground-motion")
  holds.add(token)
  const timer = setTimeout(() => holds.delete(token), maxDurationMs)
  return () => {
    clearTimeout(timer)
    holds.delete(token)
  }
}
