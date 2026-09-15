export function playNotificationAnimation(
  element: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) {
  const animation = element.animate(keyframes, { ...options, fill: "both" })
  let released = false
  const release = () => {
    if (released) return
    released = true
    animation.removeEventListener("finish", release)
    animation.cancel()
  }
  animation.addEventListener("finish", release, { once: true })

  // 默认文档时间线与 performance.now 共用 timeOrigin；上一绘制帧的时间戳可能已滞后。
  // 直接设定开始时间，既不回溯跳帧，也不进入 pause → play 的待播放握手。
  const timelineTime = animation.timeline?.currentTime
  if (typeof timelineTime === "number") {
    animation.startTime = element.ownerDocument.defaultView?.performance.now() ?? timelineTime
  }

  return release
}
