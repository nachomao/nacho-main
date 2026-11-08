/** 单飞启动门：并发 ensure 只启动一次；stop 会取消进行中的启动并阻止其晚到句柄写入 current。 */
export class RuntimeStartCancelledError extends Error {
  constructor() {
    super("AI 引擎启动已取消")
    this.name = "RuntimeStartCancelledError"
  }
}

type StartOptions<T> = {
  start: (signal: AbortSignal) => Promise<T>
  terminate: (value: T) => Promise<void> | void
}

type Starting<T> = {
  promise: Promise<T>
  controller: AbortController
  epoch: number
}

export class RuntimeLifecycle<T> {
  private current: T | null = null
  private starting: Starting<T> | null = null
  private stopping: Promise<void> | null = null
  private epoch = 0
  private stale = false
  private failure: string | null = null

  constructor(private readonly options: StartOptions<T>) {}

  async ensure(): Promise<T> {
    for (;;) {
      if (this.stopping) {
        await this.stopping
        continue
      }
      if (this.current && !this.stale) return this.current
      if (this.starting) return this.starting.promise
      if (this.current) {
        await this.stop()
        continue
      }

      const epoch = this.epoch
      const controller = new AbortController()
      const promise = (async () => {
        const value = await this.options.start(controller.signal)
        if (controller.signal.aborted || epoch !== this.epoch || this.stale) {
          await this.options.terminate(value)
          throw new RuntimeStartCancelledError()
        }
        this.current = value
        this.stale = false
        this.failure = null
        return value
      })()
      const entry: Starting<T> = { promise, controller, epoch }
      this.starting = entry
      try {
        return await promise
      } catch (error) {
        if (!(error instanceof RuntimeStartCancelledError)) {
          this.failure = error instanceof Error ? error.message : "AI 引擎启动失败"
        }
        throw error
      } finally {
        if (this.starting === entry) this.starting = null
      }
    }
  }

  async stop(finalize?: () => Promise<void> | void): Promise<void> {
    if (this.stopping) return this.stopping
    this.epoch++
    this.stale = false
    const starting = this.starting
    starting?.controller.abort()
    const current = this.current
    this.current = null
    const task = (async () => {
      if (current) await this.options.terminate(current)
      if (starting) {
        try {
          await starting.promise
        } catch {
          // 启动被取消
        }
      }
      if (finalize) await finalize()
    })()
    let stopping: Promise<void>
    stopping = task.finally(() => {
      if (this.stopping === stopping) this.stopping = null
    })
    this.stopping = stopping
    return stopping
  }

  markStale() {
    this.stale = true
  }

  /** 子进程意外退出时由外部调用；不重复 terminate。 */
  invalidate(error: string) {
    this.current = null
    this.failure = error
  }

  getCurrent() {
    return this.current
  }

  isStarting() {
    return Boolean(this.starting)
  }

  getFailure() {
    return this.failure
  }
}
