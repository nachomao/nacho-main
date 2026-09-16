import assert from "node:assert/strict"
import { test } from "node:test"
import { isSameOriginRequest } from "../lib/same-origin"

function headers(values: Record<string, string>) {
  return new Headers(values)
}

test("browser fetch metadata accepts same-origin requests behind a preview proxy", () => {
  assert.equal(
    isSameOriginRequest(
      headers({
        origin: "https://preview.example",
        host: "internal:3000",
        "sec-fetch-site": "same-origin",
      }),
      "http://internal:3000",
    ),
    true,
  )
})

test("cross-site browser requests are rejected even when proxy headers are present", () => {
  assert.equal(
    isSameOriginRequest(
      headers({
        origin: "https://attacker.example",
        host: "panel.example",
        "x-forwarded-host": "panel.example",
        "x-forwarded-proto": "https",
        "sec-fetch-site": "cross-site",
      }),
      "http://internal:3000",
    ),
    false,
  )
})

test("non-browser clients may use matching forwarded host and protocol", () => {
  assert.equal(
    isSameOriginRequest(
      headers({
        origin: "https://panel.example",
        host: "internal:3000",
        "x-forwarded-host": "panel.example",
        "x-forwarded-proto": "https",
      }),
      "http://internal:3000",
    ),
    true,
  )
  assert.equal(
    isSameOriginRequest(headers({ origin: "not a url", host: "panel.example" }), "http://internal:3000"),
    false,
  )
})
