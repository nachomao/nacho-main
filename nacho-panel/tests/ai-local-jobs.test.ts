import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createLocalJobsManager, type LocalJobsManager } from "../lib/ai/local-jobs"

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(
  manager: LocalJobsManager,
  jobId: string,
  predicate: (status: string) => boolean,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const job = manager.get(jobId)
    if (job && predicate(job.status)) return job
    await delay(100)
  }
  throw new Error(`等待本地任务状态超时：${jobId}`)
}

test("local job starts, writes a log and exits", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nacho-local-job-"))
  const manager = createLocalJobsManager({ directory, defaultCwd: directory })
  const started: string[] = []
  t.after(async () => {
    for (const id of started) manager.stop(id)
    await delay(200)
    await rm(directory, { recursive: true, force: true })
  })

  const job = manager.start({
    uiSessionId: "u-local-1",
    command: `node -e "console.log('job-ok'); setTimeout(()=>{}, 300)"`,
    shell: "powershell",
    label: "短任务",
  })
  started.push(job.id)
  assert.match(job.id, /^job-/)
  assert.ok(job.pid > 0)
  assert.equal(job.status, "running")
  assert.equal(manager.hasActive("u-local-1"), true)
  assert.ok(manager.list("u-local-1").some((item) => item.id === job.id))

  const ended = await waitFor(manager, job.id, (status) => status !== "running")
  assert.equal(ended.status, "exited", manager.describe(job.id, 80) ?? "no log")
  assert.equal(ended.exitCode, 0)
  assert.equal(manager.hasActive("u-local-1"), false)
  await delay(300)
  const text = manager.describe(job.id, 80)
  assert.ok(text)
  assert.match(text, /job-ok/)
  assert.match(text, /status=exited/)
})

test("local job can be stopped and unknown ids are rejected", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nacho-local-job-"))
  const manager = createLocalJobsManager({ directory, defaultCwd: directory })
  t.after(async () => {
    await delay(200)
    await rm(directory, { recursive: true, force: true })
  })

  const job = manager.start({
    uiSessionId: "u-local-2",
    command: `node -e "setTimeout(()=>{}, 60000)"`,
    shell: "cmd",
    label: "长任务",
  })
  await delay(500)
  const stopped = manager.stop(job.id)
  assert.ok(stopped)
  assert.equal(stopped.status, "stopped")
  assert.equal(manager.hasActive("u-local-2"), false)
  await waitFor(manager, job.id, (status) => status !== "running")

  assert.equal(manager.get("missing-job"), null)
  assert.equal(manager.describe("missing-job"), null)
  assert.equal(manager.stop("missing-job"), null)
})
