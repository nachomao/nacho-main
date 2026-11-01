/* 左滑操作行的拖动手感（改编自 React Bits SwipeRow）：橡皮筋阻尼、整行提交阈值与松手落点。
 * 统一用“露出宽度”描述状态：0 = 收起，actionWidth = 露出操作键，越过提交点松手即执行操作。 */

const DECEL = 0.998

/** 横向位移超过该值（且大于纵向位移）才算开始拖动 */
export const SWIPE_HYSTERESIS = 10
/** 松手速度（px/s）达到该值按甩动方向决定开合 */
export const SWIPE_FLICK = 110
export const SWIPE_VMAX = 1500

export type SwipeGeometry = {
  /** 行宽 */
  width: number
  actionWidth: number
  /** 阻尼系数 0.05–1，越小越“紧” */
  resistance: number
  /** 提交点占行宽的比例 */
  commitAt: number
}

export type SwipeSample = readonly [time: number, exposed: number]

export function rubberBand(offset: number, dimension: number, resistance: number) {
  return (offset * dimension * resistance) / (dimension + resistance * Math.abs(offset))
}

export function unrubberBand(value: number, dimension: number, resistance: number) {
  return (value * dimension) / (resistance * Math.max(1, dimension - Math.abs(value)))
}

/** 松手后的惯性滑行距离（px） */
export function projectMomentum(velocity: number) {
  return ((velocity / 1000) * DECEL) / (1 - DECEL)
}

/** 由最近几帧的露出宽度估算松手速度（px/s，正值表示继续打开） */
export function releaseVelocity(samples: readonly SwipeSample[]) {
  if (samples.length < 2) return 0
  const [startTime, startValue] = samples[0]
  const [endTime, endValue] = samples[samples.length - 1]
  return ((endValue - startValue) / Math.max(1, endTime - startTime)) * 1000
}

export function swipeCommitPoint({ width, actionWidth, commitAt }: SwipeGeometry) {
  return Math.max(commitAt * width, actionWidth * 1.5)
}

export function canSwipeCommit(geometry: SwipeGeometry) {
  return swipeCommitPoint(geometry) <= geometry.width
}

/**
 * 手指位移 → 露出宽度。反向拖动与越界部分施加橡皮筋阻尼；
 * 可以整行提交时，操作宽度到提交点之间按阻尼系数线性跟手，越过提交点后再次进入橡皮筋。
 */
export function swipeExposure(raw: number, geometry: SwipeGeometry) {
  const { width, actionWidth, resistance } = geometry
  if (raw < 0) return rubberBand(raw, width, resistance)
  if (raw <= actionWidth) return raw
  if (!canSwipeCommit(geometry)) return actionWidth + rubberBand(raw - actionWidth, width, resistance)
  const commit = swipeCommitPoint(geometry)
  const knee = actionWidth + (commit - actionWidth) / resistance
  return raw <= knee ? actionWidth + resistance * (raw - actionWidth) : commit + rubberBand(raw - knee, width, resistance)
}

/** swipeExposure 的反函数：从当前露出宽度接着拖时，换算出对应的手指位移，避免起手跳变。 */
export function swipeRaw(exposed: number, geometry: SwipeGeometry) {
  const { width, actionWidth, resistance } = geometry
  if (exposed < 0) return unrubberBand(exposed, width, resistance)
  if (exposed <= actionWidth) return exposed
  if (!canSwipeCommit(geometry)) return actionWidth + unrubberBand(exposed - actionWidth, width, resistance)
  const commit = swipeCommitPoint(geometry)
  const knee = actionWidth + (commit - actionWidth) / resistance
  return exposed <= commit
    ? actionWidth + (exposed - actionWidth) / resistance
    : knee + unrubberBand(exposed - commit, width, resistance)
}

/** 松手落点：快速甩动按方向决定；否则看惯性滑行后是否越过操作宽度的一半。 */
export function swipeReleaseTarget(exposed: number, velocity: number, actionWidth: number) {
  if (Math.abs(velocity) >= SWIPE_FLICK) return velocity > 0 ? actionWidth : 0
  return exposed + projectMomentum(velocity) > actionWidth / 2 ? actionWidth : 0
}
