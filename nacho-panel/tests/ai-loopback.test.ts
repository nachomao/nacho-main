import assert from "node:assert/strict"
import test from "node:test"
import { NextRequest } from "next/server"
import { requireSameOrigin } from "../lib/ai/http"
import { isLoopbackHostname } from "../lib/ai/loopback"

test("loopback host accepts only local hostnames", () => {
  for (const value of ["127.0.0.1", "127.0.0.1:3000", "localhost", "LOCALHOST:3000", "::1", "[::1]", "[::1]:3000"]) {
    assert.equal(isLoopbackHostname(value), true, value)
  }
  for (const value of ["", null, undefined, "attacker.com", "attacker.com:3000", "127.0.0.1.evil.com", "127.0.0.2", "[::1].evil.com", "127.0.0.1:evil", "10.0.0.1:3000"]) {
    assert.equal(isLoopbackHostname(value), false, String(value))
  }
})

test("same-origin AI routes reject non-loopback hosts even when origin matches", async () => {
  const request = new NextRequest("http://attacker.com:3000/api/ai/settings", {
    headers: {
      host: "attacker.com:3000",
      origin: "http://attacker.com:3000",
      "sec-fetch-site": "same-origin",
    },
  })
  const response = requireSameOrigin(request)
  assert.ok(response)
  assert.equal(response.status, 403)
  const body = await response.json() as { code?: string }
  assert.equal(body.code, "non-loopback")
})

test("same-origin AI routes still accept loopback panel requests", () => {
  const request = new NextRequest("http://127.0.0.1:3000/api/ai/settings", {
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin",
    },
  })
  assert.equal(requireSameOrigin(request), null)
})
