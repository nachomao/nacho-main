"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowRight, ImagePlus } from "lucide-react"
import { useOnboarding } from "./onboarding-context"
import { avatars, getAvatar } from "./avatars"
import { cn } from "@/lib/utils"

/** 将上传图片读取、居中裁剪为正方形并压缩为 data URL，避免存储过大 */
function fileToAvatarDataUrl(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.crossOrigin = "anonymous"
      img.onload = () => {
        const canvas = document.createElement("canvas")
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext("2d")
        if (!ctx) return reject(new Error("canvas 不可用"))
        // 居中正方形裁剪
        const side = Math.min(img.width, img.height)
        const sx = (img.width - side) / 2
        const sy = (img.height - side) / 2
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
        resolve(canvas.toDataURL("image/jpeg", 0.85))
      }
      img.onerror = reject
      img.src = reader.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"

/**
 * 胶囊边框手绘动画：从左端中点出发，上下两条半周路径同时向右描绘，
 * 在右端中点汇合成完整轮廓。draw 触发描绘，faded 后整层淡出（交还给真实边框）。
 */
function DrawnPillBorder({ draw, faded }: { draw: boolean; faded: boolean }) {
  const hostRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = hostRef.current?.parentElement
    if (!el) return
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { w, h } = size
  const r = h / 2 - 0.75
  const cy = h / 2
  // 上半周：左中 → 左上圆弧 → 顶边 → 右上圆弧 → 右中；下半周为镜像
  const topPath = `M 0.75 ${cy} A ${r} ${r} 0 0 1 ${r + 0.75} 0.75 L ${w - r - 0.75} 0.75 A ${r} ${r} 0 0 1 ${w - 0.75} ${cy}`
  const bottomPath = `M 0.75 ${cy} A ${r} ${r} 0 0 0 ${r + 0.75} ${h - 0.75} L ${w - r - 0.75} ${h - 0.75} A ${r} ${r} 0 0 0 ${w - 0.75} ${cy}`

  const strokeStyle = {
    strokeDasharray: 1,
    strokeDashoffset: draw ? 0 : 1,
    // 前段近匀速、尾段轻收，笔迹全程可见
    transition: "stroke-dashoffset 1350ms cubic-bezier(0.45, 0, 0.25, 1)",
  } as const

  return (
    <svg
      ref={hostRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full text-foreground/30"
      style={{ opacity: faded ? 0 : 1, transition: "opacity 500ms ease" }}
    >
      {w > 0 && h > 0 && (
        <>
          <path d={topPath} pathLength={1} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" style={strokeStyle} />
          <path d={bottomPath} pathLength={1} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" style={strokeStyle} />
        </>
      )}
    </svg>
  )
}

/** 单句问候：从下往上平移 + 模糊渐显切入，停留后继续上移 + 模糊渐隐切出，全程 2.5s */
function GreetLine({ text }: { text: string }) {
  const [state, setState] = useState<"in" | "hold" | "out">("in")

  useEffect(() => {
    const t1 = window.setTimeout(() => setState("hold"), 30)
    const t2 = window.setTimeout(() => setState("out"), 1800)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  return (
    <p
      className="text-balance text-center text-4xl font-semibold text-foreground sm:text-5xl"
      style={{
        opacity: state === "hold" ? 1 : 0,
        transform:
          state === "in" ? "translateY(32px)" : state === "hold" ? "translateY(0)" : "translateY(-32px)",
        filter: state === "hold" ? "blur(0px)" : "blur(12px)",
        transition: `opacity 700ms ease, transform 700ms ${EASE}, filter 700ms ease`,
      }}
    >
      {text}
    </p>
  )
}

/**
 * 第二部分：用户名 + 头像注册。
 * 「您好」→「欢迎使用NachoPanel」逐句切入切出（各 2.5s），
 * 随后「我该如何称呼您？」上移让位、输入框渐显；确认称呼后，
 * 用户名区块模糊缩放退场，头像选择区块同步模糊渐显切入（原地衔接）；
 * 选定头像确认后整体模糊渐隐离场。
 */
export function NameRegister({ onDone }: { onDone: () => void }) {
  const { setUserName, setAvatar, setCustomAvatar } = useOnboarding()
  // 0/1: 两句问候 → 2: 表单阶段（用户名 + 头像）
  const [step, setStep] = useState(0)
  const [askIn, setAskIn] = useState(false) // 提问文字入场
  const [inputIn, setInputIn] = useState(false) // 输入框渐显（提问同步上移）
  const [drawStart, setDrawStart] = useState(false) // 入场稳定后再动笔描边
  const [drawDone, setDrawDone] = useState(false) // 边框描绘完成：真实边框接管、按钮渐显
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  // 表单内的两块画面：name（用户名）→ avatar（头像）
  const [screen, setScreen] = useState<"name" | "avatar">("name")
  const [avatarIn, setAvatarIn] = useState(false) // 头像区块入场
  const [avatarId, setAvatarId] = useState(avatars[0].id)
  const [customUrl, setCustomUrl] = useState<string | null>(null) // 本地上传头像预览
  const [popKey, setPopKey] = useState(0) // 每次选择头像重触发弹入动画
  const [leaving, setLeaving] = useState(false) // 整体离场
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timers: number[] = []
    timers.push(window.setTimeout(() => setStep(1), 2500))
    timers.push(window.setTimeout(() => setStep(2), 5000))
    timers.push(window.setTimeout(() => setAskIn(true), 5050))
    timers.push(window.setTimeout(() => setInputIn(true), 5900))
    // 等入场的位移/模糊基本稳定后再动笔（+450ms），描绘 1350ms 全程可见
    timers.push(window.setTimeout(() => setDrawStart(true), 5900 + 450))
    timers.push(window.setTimeout(() => setDrawDone(true), 5900 + 450 + 1400))
    timers.push(window.setTimeout(() => inputRef.current?.focus(), 5900 + 450 + 1500))
    return () => timers.forEach(clearTimeout)
  }, [])

  const confirmName = () => {
    if (screen !== "name") return
    setUserName(value.trim() || "NachoNeko")
    // 用户名区块退场 → 头像区块登场
    setScreen("avatar")
    window.setTimeout(() => setAvatarIn(true), 80)
  }

  const chooseAvatar = (id: string) => {
    setAvatarId(id)
    setPopKey((k) => k + 1)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // 允许重复选择同一文件
    if (!file || !file.type.startsWith("image/")) return
    try {
      const url = await fileToAvatarDataUrl(file)
      setCustomUrl(url)
      setAvatarId("custom")
      setPopKey((k) => k + 1)
    } catch {
      // 读取失败时静默忽略
    }
  }

  const confirmAvatar = () => {
    if (leaving) return
    if (avatarId === "custom" && customUrl) {
      setCustomAvatar(customUrl)
    } else {
      setAvatar(avatarId)
    }
    setLeaving(true)
    window.setTimeout(onDone, 750)
  }

  const isCustom = avatarId === "custom" && !!customUrl
  const selected = getAvatar(avatarId)

  return (
    <div
      className="flex h-full w-full items-center justify-center px-6"
      style={{
        opacity: leaving ? 0 : 1,
        filter: leaving ? "blur(14px)" : "blur(0px)",
        transform: leaving ? "scale(0.97)" : "scale(1)",
        transition: `opacity 700ms ease, filter 700ms ease, transform 700ms ${EASE}`,
      }}
    >
      {step === 0 && <GreetLine text="您好" />}
      {step === 1 && <GreetLine text="欢迎使用NachoPanel" />}

      {step >= 2 && (
        <div className="relative flex w-full max-w-md items-center justify-center">
          {/* ---------- 用户名区块（始终绝对定位居中，叠在头像区块之上做原地交叉过渡，避免容器高度跳变） ---------- */}
          <div
            className="absolute inset-0 flex w-full flex-col items-center justify-center"
            style={{
              opacity: screen === "name" ? 1 : 0,
              transform: screen === "name" ? "scale(1)" : "scale(0.94)",
              filter: screen === "name" ? "blur(0px)" : "blur(12px)",
              transition: `opacity 500ms ease, transform 550ms ${EASE}, filter 500ms ease`,
              pointerEvents: screen === "name" ? "auto" : "none",
            }}
            aria-hidden={screen !== "name"}
          >
            <h1
              className="text-balance text-center text-3xl font-semibold text-foreground will-change-transform sm:text-4xl"
              style={{
                opacity: askIn ? 1 : 0,
                transform: askIn
                  ? inputIn
                    ? "translateY(0)"
                    : "translateY(68px)"
                  : "translateY(100px)",
                filter: askIn ? "blur(0px)" : "blur(12px)",
                transition: `opacity 800ms ease, transform 850ms ${EASE}, filter 800ms ease`,
              }}
            >
              我该如何称呼您？
            </h1>

            <div className="w-full">
              <div
                className="relative pt-10 will-change-transform"
                style={{
                  opacity: inputIn ? 1 : 0,
                  transform: inputIn ? "translateY(0)" : "translateY(68px)",
                  filter: inputIn ? "blur(0px)" : "blur(10px)",
                  transition: `opacity 700ms ease 120ms, transform 850ms ${EASE}, filter 700ms ease 120ms`,
                  pointerEvents: inputIn && screen === "name" ? "auto" : "none",
                }}
              >
                {/* 边框手绘层：从左端上下同时描绘至右端汇合，画完淡出交还真实边框 */}
                <div className="relative">
                  <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) confirmName()
                    }}
                    placeholder="NachoNeko"
                    aria-label="您的称呼"
                    className={cn(
                      "h-14 w-full rounded-full border bg-surface/70 pl-6 pr-16 text-base text-foreground outline-none transition-colors duration-500 placeholder:text-muted-foreground/40",
                      drawDone
                        ? "border-border/70 hover:border-border focus:border-foreground/25 focus:bg-surface"
                        : "border-transparent",
                    )}
                  />
                  <DrawnPillBorder draw={drawStart} faded={drawDone} />
                  {/* 箭头钮：边框画完后模糊渐显；默认低调灰，输入内容后点亮为主题色 */}
                  <button
                    type="button"
                    onClick={confirmName}
                    aria-label="确认称呼"
                    className={cn(
                      "absolute right-2 top-1/2 flex h-10 w-10 items-center justify-center rounded-full transition-all duration-500 ease-out active:scale-90",
                      value.trim()
                        ? "bg-primary text-primary-foreground hover:brightness-110"
                        : "bg-foreground/[0.06] text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                    )}
                    style={{
                      opacity: drawDone ? 1 : 0,
                      filter: drawDone ? "blur(0px)" : "blur(8px)",
                      transform: `translateY(-50%) scale(${drawDone ? 1 : 0.85})`,
                      pointerEvents: drawDone ? "auto" : "none",
                    }}
                  >
                    <ArrowRight className="h-4.5 w-4.5" strokeWidth={2} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ---------- 头像选择区块（始终占据正常文档流，负责定义容器高度，使切换时高度恒定） ---------- */}
          <div
            className="flex w-full flex-col items-center"
            style={{
              opacity: screen === "avatar" ? 1 : 0,
              transform: screen === "avatar" ? "scale(1)" : "scale(1.06)",
              filter: screen === "avatar" ? "blur(0px)" : "blur(12px)",
              transition: `opacity 500ms ease 120ms, transform 550ms ${EASE} 120ms, filter 500ms ease 120ms`,
              pointerEvents: screen === "avatar" ? "auto" : "none",
            }}
            aria-hidden={screen !== "avatar"}
          >
            {/* 大号预览：每次选择重触发弹入动画 */}
            <div
              className="will-change-transform"
              style={{
                opacity: avatarIn ? 1 : 0,
                transform: avatarIn ? "translateY(0)" : "translateY(40px)",
                filter: avatarIn ? "blur(0px)" : "blur(12px)",
                transition: `opacity 700ms ease, transform 800ms ${EASE}, filter 700ms ease`,
              }}
            >
              <div
                key={popKey}
                className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full animate-avatar-pop"
              >
                {isCustom ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={customUrl! || "/placeholder.svg"} alt="自定义头像预览" className="h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.src || "/placeholder.svg"} alt={selected.label} className="h-full w-full object-cover" />
                )}
              </div>
            </div>

            <h1
              className="mt-8 text-balance text-center text-3xl font-semibold text-foreground sm:text-4xl"
              style={{
                opacity: avatarIn ? 1 : 0,
                transform: avatarIn ? "translateY(0)" : "translateY(28px)",
                filter: avatarIn ? "blur(0px)" : "blur(12px)",
                transition: `opacity 700ms ease 100ms, transform 800ms ${EASE} 100ms, filter 700ms ease 100ms`,
              }}
            >
              选择一个头像
            </h1>

            {/* 头像候选行 */}
            <div
              className="mt-8 flex flex-wrap items-center justify-center gap-3"
              style={{
                opacity: avatarIn ? 1 : 0,
                transform: avatarIn ? "translateY(0)" : "translateY(28px)",
                filter: avatarIn ? "blur(0px)" : "blur(10px)",
                transition: `opacity 700ms ease 200ms, transform 800ms ${EASE} 200ms, filter 700ms ease 200ms`,
              }}
            >
              {avatars.map((a) => {
                const active = a.id === avatarId
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => chooseAvatar(a.id)}
                    aria-label={a.label}
                    aria-pressed={active}
                    className={cn(
                      "flex h-14 w-14 items-center justify-center overflow-hidden rounded-full transition-all duration-300 ease-out hover:scale-[1.08] active:scale-95",
                      active
                        ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-[1.06]"
                        : "opacity-70 hover:opacity-100",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.src || "/placeholder.svg"} alt="" className="h-full w-full object-cover" />
                  </button>
                )
              })}

              {/* 本地上传头像：选中后显示图片缩略，未选中显示上传图标 */}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="上传本地头像"
                aria-pressed={isCustom}
                className={cn(
                  "flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-dashed border-border bg-surface text-muted-foreground transition-all duration-300 ease-out hover:scale-[1.08] hover:text-foreground active:scale-95",
                  isCustom
                    ? "scale-[1.06] border-solid ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : "opacity-80 hover:opacity-100",
                )}
              >
                {isCustom ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={customUrl! || "/placeholder.svg"} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-6 w-6" strokeWidth={1.75} aria-hidden />
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleUpload}
                className="sr-only"
                aria-hidden
                tabIndex={-1}
              />
            </div>

            {/* 确认按钮 */}
            <button
              type="button"
              onClick={confirmAvatar}
              className="mt-10 flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-7 text-sm font-medium text-primary-foreground transition-all duration-300 ease-out hover:brightness-110 active:scale-95"
              style={{
                opacity: avatarIn ? 1 : 0,
                transform: avatarIn ? "translateY(0)" : "translateY(28px)",
                filter: avatarIn ? "blur(0px)" : "blur(10px)",
                transition: `opacity 700ms ease 280ms, transform 800ms ${EASE} 280ms, filter 700ms ease 280ms`,
              }}
            >
              就用它
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
