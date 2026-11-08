import assert from "node:assert/strict"
import test from "node:test"
import { RuntimeLifecycle, RuntimeStartCancelledError } from "../lib/ai/runtime-lifecycle"

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test("concurrent ensure calls share one start", async () => {
  let starts = 0
  const lifecycle = new RuntimeLifecycle<number>({
    start: async () => {
      starts++
      await delay(10)
      return 1
    },
    terminate: async () => undefined,
  })
  const [first, second] = await Promise.all([lifecycle.ensure(), lifecycle.ensure()])
  assert.equal(starts, 1)
  assert.equal(first, 1)
  assert.equal(second, 1)
  assert.equal(lifecycle.getCurrent(), 1)
})

test("stop cancels an in-flight start and terminates a late handle", async () => {
  let terminated = 0
  let finalized = 0
  const lifecycle = new RuntimeLifecycle<number>({
    start: async () => {
      await delay(30)
      return 1
    },
    terminate: async () => {
      terminated++
    },
  })
  const ensuring = lifecycle.ensure()
  await delay(5)
  const stopping = lifecycle.stop(() => {
    finalized++
  })
  await assert.rejects(ensuring, RuntimeStartCancelledError)
  await stopping
  assert.equal(terminated, 1)
  assert.equal(finalized, 1)
  assert.equal(lifecycle.getCurrent(), null)
})

test("failed start clears the gate and can be retried", async () => {
  let attempts = 0
  const lifecycle = new RuntimeLifecycle<number>({
    start: async () => {
      attempts++
      if (attempts === 1) throw new Error("boom")
      return 2
    },
    terminate: async () => undefined,
  })
  await assert.rejects(lifecycle.ensure(), /boom/)
  assert.equal(lifecycle.isStarting(), false)
  assert.equal(lifecycle.getFailure(), "boom")
  assert.equal(await lifecycle.ensure(), 2)
  assert.equal(attempts, 2)
  assert.equal(lifecycle.getFailure(), null)
})

test("markStale replaces the current engine on the next ensure", async () => {
  let next = 0
  const terminated: number[] = []
  const lifecycle = new RuntimeLifecycle<number>({
    start: async () => ++next,
    terminate: async (value) => {
      terminated.push(value)
    },
  })
  assert.equal(await lifecycle.ensure(), 1)
  lifecycle.markStale()
  assert.equal(await lifecycle.ensure(), 2)
  assert.deepEqual(terminated, [1])
  assert.equal(lifecycle.getCurrent(), 2)
})

test("concurrent stop calls share one termination", async () => {
  let terminated = 0
  const lifecycle = new RuntimeLifecycle<number>({
    start: async () => 1,
    terminate: async () => {
      terminated++
      await delay(10)
    },
  })
  await lifecycle.ensure()
  await Promise.all([lifecycle.stop(), lifecycle.stop()])
  assert.equal(terminated, 1)
  assert.equal(lifecycle.getCurrent(), null)
})

test("invalidate clears a current engine after an unexpected exit", async () => {
  const lifecycle = new RuntimeLifecycle<number>({
    start: async () => 1,
    terminate: async () => undefined,
  })
  await lifecycle.ensure()
  lifecycle.invalidate("exited")
  assert.equal(lifecycle.getCurrent(), null)
  assert.equal(lifecycle.getFailure(), "exited")
})
