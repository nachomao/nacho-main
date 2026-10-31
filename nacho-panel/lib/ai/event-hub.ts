import type { RuntimeHandle } from "./runtime"

export type OpenCodeEvent = {
  id?: string
  type: string
  properties?: Record<string, unknown>
}

type Listener = (event: OpenCodeEvent) => void

const listeners = new Map<string, Set<Listener>>()
let controller: AbortController | null = null
let loop: Promise<void> | null = null
let hubKey = ""
let connected = false
let waiters = new Set<() => void>()

function basicHeader(runtime: RuntimeHandle) {
  return `Basic ${Buffer.from(`${runtime.username}:${runtime.password}`, "utf8").toString("base64")}`
}

function markConnected() {
  if (connected) return
  connected = true
  for (const resolve of waiters) resolve()
  waiters = new Set()
}

function dispatch(event: OpenCodeEvent) {
  if (event.type === "server.connected") {
    markConnected()
    return
  }
  const sessionId = typeof event.properties?.sessionID === "string" ? event.properties.sessionID : ""
  if (!sessionId) return
  const set = listeners.get(sessionId)
  if (!set) return
  for (const listener of set) listener(event)
}

async function run(runtime: RuntimeHandle, signal: AbortSignal) {
  let buffer = ""
  while (!signal.aborted) {
    try {
      const response = await fetch(`${runtime.url}/event`, {
        headers: { Authorization: basicHeader(runtime), Accept: "text/event-stream" },
        signal,
      })
      if (!response.ok || !response.body) throw new Error(`event stream ${response.status}`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      buffer = ""
      while (!signal.aborted) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue
            const raw = line.slice(5).trim()
            if (!raw) continue
            try {
              dispatch(JSON.parse(raw) as OpenCodeEvent)
            } catch {
              // ignore malformed event
            }
          }
        }
      }
    } catch {
      if (signal.aborted) return
    }
    if (signal.aborted) return
    connected = false
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
}

export function ensureEventHub(runtime: RuntimeHandle) {
  const key = `${runtime.url}|${runtime.password}`
  if (controller && hubKey === key) return
  stopEventHub()
  hubKey = key
  controller = new AbortController()
  loop = run(runtime, controller.signal)
}

export function stopEventHub() {
  controller?.abort()
  controller = null
  loop = null
  hubKey = ""
  connected = false
  for (const resolve of waiters) resolve()
  waiters = new Set()
}

export function subscribeEvents(sessionId: string, listener: Listener) {
  let set = listeners.get(sessionId)
  if (!set) {
    set = new Set()
    listeners.set(sessionId, set)
  }
  set.add(listener)
  return () => {
    set?.delete(listener)
    if (set?.size === 0) listeners.delete(sessionId)
  }
}

export function waitForEventHub(timeoutMs = 5_000) {
  if (connected) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      waiters.delete(finish)
      resolve(connected)
    }
    const timer = setTimeout(finish, timeoutMs)
    waiters.add(finish)
  })
}

export function isEventHubConnected() {
  return connected
}

export function getEventHubLoop() {
  return loop
}
