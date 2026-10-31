import assert from "node:assert/strict"
import test from "node:test"
import {
  AIChatAttachmentError,
  MAX_AI_ATTACHMENT_BYTES,
  MAX_AI_ATTACHMENT_COUNT,
  attachmentByteSize,
  validateAIChatAttachments,
} from "../lib/ai/chat-attachments"

function imageDataUrl(mime: string, content: string) {
  return `data:${mime};base64,${Buffer.from(content, "utf8").toString("base64")}`
}

test("accepts supported image attachments and normalizes fields", () => {
  const png = imageDataUrl("image/png", "png-bytes")
  const jpeg = imageDataUrl("image/jpeg", "jpeg-bytes")
  const result = validateAIChatAttachments([
    { name: "shot.png", mime: "image/png", dataUrl: png, size: 1 },
    { name: "photo.jpg", mime: "image/jpeg", dataUrl: jpeg },
  ])
  assert.deepEqual(result, [
    { name: "shot.png", mime: "image/png", dataUrl: png },
    { name: "photo.jpg", mime: "image/jpeg", dataUrl: jpeg },
  ])
  assert.equal(attachmentByteSize(png), Buffer.byteLength("png-bytes"))
})

test("accepts missing attachment list", () => {
  assert.deepEqual(validateAIChatAttachments(undefined), [])
  assert.deepEqual(validateAIChatAttachments(null), [])
})

test("rejects unsupported mime types", () => {
  const svg = imageDataUrl("image/svg+xml", "<svg/>")
  assert.throws(
    () => validateAIChatAttachments([{ name: "a.svg", mime: "image/svg+xml", dataUrl: svg }]),
    (error: unknown) => error instanceof AIChatAttachmentError && error.code === "invalid-attachment",
  )
})

test("rejects mismatched mime and data url", () => {
  const png = imageDataUrl("image/png", "png-bytes")
  assert.throws(
    () => validateAIChatAttachments([{ name: "a.png", mime: "image/jpeg", dataUrl: png }]),
    (error: unknown) => error instanceof AIChatAttachmentError && error.code === "invalid-attachment",
  )
})

test("rejects malformed data urls and file names", () => {
  assert.throws(
    () => validateAIChatAttachments([{ name: "a.png", mime: "image/png", dataUrl: "https://example.com/a.png" }]),
    (error: unknown) => error instanceof AIChatAttachmentError,
  )
  const png = imageDataUrl("image/png", "png-bytes")
  assert.throws(
    () => validateAIChatAttachments([{ name: "../a.png", mime: "image/png", dataUrl: png }]),
    (error: unknown) => error instanceof AIChatAttachmentError,
  )
})

test("rejects too many attachments", () => {
  const png = imageDataUrl("image/png", "png-bytes")
  const items = Array.from({ length: MAX_AI_ATTACHMENT_COUNT + 1 }, (_, index) => ({
    name: `${index}.png`,
    mime: "image/png",
    dataUrl: png,
  }))
  assert.throws(
    () => validateAIChatAttachments(items),
    (error: unknown) => error instanceof AIChatAttachmentError && error.code === "too-many-attachments",
  )
})

test("rejects images over the per-image limit", () => {
  const oversized = `data:image/png;base64,${Buffer.alloc(MAX_AI_ATTACHMENT_BYTES + 1).toString("base64")}`
  assert.throws(
    () => validateAIChatAttachments([{ name: "big.png", mime: "image/png", dataUrl: oversized }]),
    (error: unknown) => error instanceof AIChatAttachmentError && error.code === "attachment-too-large",
  )
})
