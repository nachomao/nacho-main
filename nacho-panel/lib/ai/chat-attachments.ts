/* 图片附件协议：客户端与服务端共用，不包含 Node 依赖。 */

export const AI_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const

export type AIImageMime = (typeof AI_IMAGE_MIME_TYPES)[number]

export const MAX_AI_ATTACHMENT_COUNT = 3
export const MAX_AI_ATTACHMENT_BYTES = 4 * 1024 * 1024
export const MAX_AI_ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024
export const MAX_AI_ATTACHMENT_NAME_LENGTH = 128
export const MAX_AI_CHAT_REQUEST_LENGTH = 16 * 1024 * 1024

export type AIChatAttachment = {
  name: string
  mime: AIImageMime
  dataUrl: string
}

export type AIChatAttachmentErrorCode =
  | "invalid-attachment"
  | "attachment-too-large"
  | "too-many-attachments"

export class AIChatAttachmentError extends Error {
  constructor(message: string, readonly code: AIChatAttachmentErrorCode) {
    super(message)
    this.name = "AIChatAttachmentError"
  }
}

const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/

function decodeDataUrl(dataUrl: string): { mime: AIImageMime; bytes: number } | null {
  const match = DATA_URL_PATTERN.exec(dataUrl)
  if (!match) return null
  const base64 = match[2]
  if (!base64 || base64.length % 4 !== 0) return null
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
  const bytes = (base64.length / 4) * 3 - padding
  if (bytes <= 0) return null
  return { mime: match[1] as AIImageMime, bytes }
}

export function attachmentByteSize(dataUrl: string): number {
  return decodeDataUrl(dataUrl)?.bytes ?? 0
}

export function isAIImageMime(value: string): value is AIImageMime {
  return (AI_IMAGE_MIME_TYPES as readonly string[]).includes(value)
}

export function validateAIChatAttachments(value: unknown): AIChatAttachment[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new AIChatAttachmentError("图片附件格式无效", "invalid-attachment")
  }
  if (value.length > MAX_AI_ATTACHMENT_COUNT) {
    throw new AIChatAttachmentError(`最多上传 ${MAX_AI_ATTACHMENT_COUNT} 张图片`, "too-many-attachments")
  }
  let total = 0
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new AIChatAttachmentError("图片附件格式无效", "invalid-attachment")
    }
    const record = item as Record<string, unknown>
    const name = typeof record.name === "string" ? record.name.trim() : ""
    if (!name || name.length > MAX_AI_ATTACHMENT_NAME_LENGTH || /[\u0000-\u001f\u007f/\\]/.test(name)) {
      throw new AIChatAttachmentError("图片文件名无效", "invalid-attachment")
    }
    const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl : ""
    const decoded = decodeDataUrl(dataUrl)
    if (!decoded || record.mime !== decoded.mime) {
      throw new AIChatAttachmentError("图片数据无效", "invalid-attachment")
    }
    if (decoded.bytes > MAX_AI_ATTACHMENT_BYTES) {
      throw new AIChatAttachmentError("单张图片不能超过 4 MB", "attachment-too-large")
    }
    total += decoded.bytes
    if (total > MAX_AI_ATTACHMENT_TOTAL_BYTES) {
      throw new AIChatAttachmentError("图片总大小不能超过 10 MB", "attachment-too-large")
    }
    return { name, mime: decoded.mime, dataUrl }
  })
}
