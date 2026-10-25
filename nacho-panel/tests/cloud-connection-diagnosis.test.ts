import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {
  describeCloudVerificationFailure,
  describeMixedContentBlock,
  isLoopbackHost,
  isMixedContentBlocked,
} from "../lib/cloud-connection-diagnosis"

test("回环主机判定覆盖 localhost、127.0.0.0/8 与 IPv6 回环", () => {
  for (const host of ["localhost", "LOCALHOST", "panel.localhost", "127.0.0.1", "127.1.2.3", "[::1]", "::1"]) {
    assert.equal(isLoopbackHost(host), true, host)
  }
  for (const host of ["maojiu.cc", "192.168.1.20", "10.0.0.5", "0.0.0.0", "example.com"]) {
    assert.equal(isLoopbackHost(host), false, host)
  }
})

test("只有 HTTPS 页面访问非回环 HTTP API 才构成混合内容", () => {
  assert.equal(isMixedContentBlocked("https:", "http://maojiu.cc:8443"), true)
  assert.equal(isMixedContentBlocked("https:", "http://192.168.1.20:8443"), true)
  assert.equal(isMixedContentBlocked("https:", "http://127.0.0.1:8443"), false)
  assert.equal(isMixedContentBlocked("https:", "http://localhost:8443"), false)
  assert.equal(isMixedContentBlocked("https:", "http://[::1]:8443"), false)
  assert.equal(isMixedContentBlocked("http:", "http://maojiu.cc:8443"), false)
  assert.equal(isMixedContentBlocked("https:", "https://maojiu.cc"), false)
  for (const api of ["", "not-a-url", "http://"]) {
    assert.equal(isMixedContentBlocked("https:", api), false, api)
  }
})

test("验证失败文案优先解释混合内容，其次超时、端口告警与通用失败", () => {
  const mixed = describeCloudVerificationFailure({
    pageProtocol: "https:",
    api: "http://maojiu.cc:8443",
    warning: "安全组未放行",
  })
  assert.match(mixed, /混合内容/)
  assert.match(mixed, /HTTPS/)
  assert.match(mixed, /桌面面板/)
  assert.ok(mixed.includes("http://maojiu.cc:8443"))

  assert.match(describeCloudVerificationFailure({
    pageProtocol: "http:",
    api: "http://maojiu.cc:8443",
    errorName: "TimeoutError",
  }), /超时/)

  assert.match(describeCloudVerificationFailure({
    pageProtocol: "http:",
    api: "http://maojiu.cc:8443",
    warning: "安全组未放行",
  }), /放行/)

  assert.match(describeCloudVerificationFailure({
    pageProtocol: "http:",
    api: "http://maojiu.cc:8443",
  }), /8443/)
})

test("云端对接表单复用混合内容文案并标明实际 API 地址", () => {
  const message = describeMixedContentBlock("http://maojiu.cc:8443")
  assert.match(message, /混合内容/)
  assert.ok(message.includes("http://maojiu.cc:8443"))
})

test("云端部署表单在 HTTPS 页面给出前置提示并使用统一诊断", () => {
  const source = readFileSync(new URL("../components/onboarding/cloud-deploy-form.tsx", import.meta.url), "utf8")
  assert.match(source, /import \{ describeCloudVerificationFailure \} from "@\/lib\/cloud-connection-diagnosis"/)
  assert.match(source, /setPageProtocol\(window\.location\.protocol\)/)
  assert.match(source, /pageProtocol === "https:"/)
  assert.match(source, /describeCloudVerificationFailure\(\{/)
})

test("云端对接表单在浏览前识别混合内容", () => {
  const source = readFileSync(new URL("../components/onboarding/server-register.tsx", import.meta.url), "utf8")
  assert.match(source, /import \{ describeMixedContentBlock, isMixedContentBlocked \} from "@\/lib\/cloud-connection-diagnosis"/)
  assert.match(source, /isMixedContentBlocked\(window\.location\.protocol, baseUrl\)/)
})
