import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { createHealthCollectionPayload, healthPackagePrimaryAction, isHealthPackageActive } from "../lib/health-center"

test("健康包活动状态只在采集和分析阶段轮询", () => {
  assert.equal(isHealthPackageActive("collecting"), true)
  assert.equal(isHealthPackageActive("analyzing"), true)
  assert.equal(isHealthPackageActive("analyzed"), false)
  assert.equal(isHealthPackageActive("failed"), false)
})

test("健康包按终态选择重新分析或失败重采", () => {
  assert.equal(healthPackagePrimaryAction("analyzed", true, true), "reanalyze")
  assert.equal(healthPackagePrimaryAction("analyzed", false, true), null)
  assert.equal(healthPackagePrimaryAction("failed", true, true), "recollect")
  assert.equal(healthPackagePrimaryAction("failed", true, false), null)
})

test("主动采集固定使用最近 24 小时、三类来源和 500 条上限", () => {
  const now = new Date("2026-08-21T05:00:00.000Z")
  const payload = createHealthCollectionPayload(["client-a", "client-b"], now)
  assert.deepEqual(payload.clientIds, ["client-a", "client-b"])
  assert.deepEqual(payload.sources, ["agent", "system", "application"])
  assert.equal(payload.sinceUtc, "2026-08-20T05:00:00.000Z")
  assert.equal(payload.untilUtc, now.toISOString())
  assert.equal(payload.maxEntries, 500)
})

test("健康页使用专用采集、下载、重新分析和失败重采接口", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "components/health/health-view.tsx"), "utf8")
  assert.match(source, /apiRequest\("\/health\/collections"/)
  assert.match(source, /downloadRequest\(`\/health\/packages\/\$\{encodeURIComponent\(id\)\}\/download`/)
  assert.match(source, /"download" \| "reanalyze" \| "recollect"/)
  assert.match(source, /window\.setInterval\(\(\) => void load\(false\), 1000\)/)
})
