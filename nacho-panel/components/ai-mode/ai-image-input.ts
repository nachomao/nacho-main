"use client"

import {
  MAX_AI_ATTACHMENT_BYTES,
  attachmentByteSize,
  isAIImageMime,
  type AIChatAttachment,
  type AIImageMime,
} from "@/lib/ai/chat-attachments"

export type AIChatAttachmentDraft = AIChatAttachment & { id: string; size: number }

const MAX_IMAGE_EDGE = 1568

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result)
      else reject(new Error("读取图片失败"))
    }
    reader.onerror = () => reject(new Error("读取图片失败"))
    reader.readAsDataURL(file)
  })
}

async function compressToJpeg(file: File, quality: number) {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("当前环境不支持图片处理")
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL("image/jpeg", quality)
  } finally {
    bitmap.close()
  }
}

function safeName(file: File, mime: AIImageMime) {
  const base = (file.name || "image").split(/[/\\]/).pop() || "image"
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) || "image"
  if (mime !== "image/jpeg" || /\.jpe?g$/i.test(cleaned)) return cleaned
  return `${cleaned.replace(/\.[^.]*$/, "") || "image"}.jpg`
}

export async function prepareImageAttachment(file: File): Promise<AIChatAttachmentDraft> {
  if (!isAIImageMime(file.type)) throw new Error("仅支持 PNG、JPEG、WebP、GIF 图片")
  const id = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `img-${Date.now()}-${Math.random().toString(36).slice(2)}`
  if (file.type === "image/gif") {
    if (file.size > MAX_AI_ATTACHMENT_BYTES) throw new Error("单张图片不能超过 4 MB")
    const dataUrl = await readAsDataUrl(file)
    const size = attachmentByteSize(dataUrl)
    if (size <= 0 || size > MAX_AI_ATTACHMENT_BYTES) throw new Error("单张图片不能超过 4 MB")
    return { id, name: safeName(file, "image/gif"), mime: "image/gif", dataUrl, size }
  }

  let dataUrl: string
  let mime: AIImageMime = "image/jpeg"
  try {
    dataUrl = await compressToJpeg(file, 0.85)
    if (attachmentByteSize(dataUrl) > MAX_AI_ATTACHMENT_BYTES) {
      dataUrl = await compressToJpeg(file, 0.65)
    }
  } catch {
    dataUrl = await readAsDataUrl(file)
    mime = file.type
  }
  const size = attachmentByteSize(dataUrl)
  if (size <= 0) throw new Error("图片数据无效")
  if (size > MAX_AI_ATTACHMENT_BYTES) throw new Error("图片压缩后仍超过 4 MB，请换一张更小的图片")
  return { id, name: safeName(file, mime), mime, dataUrl, size }
}
