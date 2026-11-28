"use strict"

// 纯 Node.js 原生密码原语：规范化 JSON、流式 AES-256-GCM 信封加密（NACHOENC1）、
// X25519+HKDF+AES-256-GCM 按设备包裹 DEK，以及 Ed25519 设备/发布机请求签名。
const {
  createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey,
  diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, sign, timingSafeEqual, verify,
} = require("node:crypto")
const fs = require("node:fs/promises")

const ENVELOPE_MAGIC = Buffer.from("NACHOENC1", "ascii")
const ENVELOPE_CIPHER = "nacho-aes-256-gcm-v1"
const WRAP_ALGORITHM = "x25519-hkdf-sha256-aes-256-gcm"
const DEFAULT_CHUNK_SIZE = 64 * 1024
const MIN_CHUNK_SIZE = 1024
const MAX_CHUNK_SIZE = 4 * 1024 * 1024
const HEADER_BYTES = ENVELOPE_MAGIC.length + 4 + 12
const TAG_BYTES = 16
const MAX_REQUEST_SKEW_MS = 5 * 60 * 1000
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

function check(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256Buffer(bytes) {
  return createHash("sha256").update(bytes).digest()
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function canonicalJsonString(value) {
  if (value === null) return "null"
  const kind = typeof value
  if (kind === "boolean") return value ? "true" : "false"
  if (kind === "number") {
    check(Number.isFinite(value), "规范化 JSON 不允许 NaN 或 Infinity")
    return Object.is(value, -0) ? "0" : JSON.stringify(value)
  }
  if (kind === "string") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalJsonString(item)).join(",") + "]"
  }
  if (kind === "object") {
    const keys = Object.keys(value).sort()
    const parts = []
    for (const key of keys) {
      const entry = value[key]
      check(entry !== undefined, `规范化 JSON 不允许 undefined 字段：${key}`)
      parts.push(`${JSON.stringify(key)}:${canonicalJsonString(entry)}`)
    }
    return "{" + parts.join(",") + "}"
  }
  throw new Error(`规范化 JSON 不支持类型：${kind}`)
}

function canonicalJson(value) {
  return Buffer.from(canonicalJsonString(value), "utf8")
}

function normalizePublicKey(input, expectedType) {
  let key
  if (input && typeof input === "object" && input.type === "public") {
    key = input
  } else {
    check(typeof input === "string" && input.length > 0 && input.length <= 512, "公钥格式无效")
    key = createPublicKey(input)
  }
  if (expectedType) check(key.asymmetricKeyType === expectedType, `公钥算法必须为 ${expectedType}`)
  return key
}

function normalizePrivateKey(input, expectedType) {
  let key
  if (input && typeof input === "object" && input.type === "private") {
    key = input
  } else {
    check(typeof input === "string" || Buffer.isBuffer(input), "私钥格式无效")
    key = createPrivateKey(input)
  }
  if (expectedType) check(key.asymmetricKeyType === expectedType, `私钥算法必须为 ${expectedType}`)
  return key
}

function keyIdOfPublicKey(input, expectedType) {
  const key = normalizePublicKey(input, expectedType)
  return sha256Hex(key.export({ type: "spki", format: "der" }))
}

function exportPublicPem(input, expectedType) {
  return normalizePublicKey(input, expectedType).export({ type: "spki", format: "pem" }).toString()
}

function deviceIdForAuthKey(authPublicKey) {
  return "dev_" + keyIdOfPublicKey(authPublicKey, "ed25519").slice(0, 32)
}

function generateDeviceIdentity() {
  const auth = generateKeyPairSync("ed25519")
  const enc = generateKeyPairSync("x25519")
  const authPublicKey = auth.publicKey.export({ type: "spki", format: "pem" }).toString()
  const authPrivateKey = auth.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  const encPublicKey = enc.publicKey.export({ type: "spki", format: "pem" }).toString()
  const encPrivateKey = enc.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  return {
    deviceId: deviceIdForAuthKey(authPublicKey),
    auth: {
      publicKey: authPublicKey,
      privateKey: authPrivateKey,
      keyId: keyIdOfPublicKey(authPublicKey, "ed25519"),
    },
    encryption: {
      publicKey: encPublicKey,
      privateKey: encPrivateKey,
      keyId: keyIdOfPublicKey(encPublicKey, "x25519"),
    },
  }
}

function generateDek() {
  return randomBytes(32)
}

function chunkNonce(baseNonce, chunkIndex) {
  const nonce = Buffer.from(baseNonce)
  let value = BigInt(chunkIndex)
  for (let i = 11; i >= 4; i--) {
    nonce[i] ^= Number(value & 0xffn)
    value >>= 8n
  }
  return nonce
}

function chunkAad(chunkSize, baseNonce, chunkIndex, flags, plainLength, contextHash) {
  const aad = Buffer.alloc(ENVELOPE_MAGIC.length + 4 + 12 + 8 + 1 + 4 + 32)
  let offset = 0
  ENVELOPE_MAGIC.copy(aad, offset); offset += ENVELOPE_MAGIC.length
  aad.writeUInt32BE(chunkSize, offset); offset += 4
  baseNonce.copy(aad, offset); offset += 12
  aad.writeBigUInt64BE(BigInt(chunkIndex), offset); offset += 8
  aad.writeUInt8(flags, offset); offset += 1
  aad.writeUInt32BE(plainLength, offset); offset += 4
  contextHash.copy(aad, offset)
  return aad
}

function validateDek(dek) {
  check(Buffer.isBuffer(dek) && dek.length === 32, "内容密钥 DEK 必须为 32 字节")
}

function normalizeContext(context) {
  check(typeof context === "string" && context.length > 0 && context.length <= 512, "加密上下文无效")
  return sha256Buffer(Buffer.from(context, "utf8"))
}

function encryptChunk(plain, dek, chunkSize, baseNonce, chunkIndex, isFinal, contextHash) {
  const flags = isFinal ? 1 : 0
  const nonce = chunkNonce(baseNonce, chunkIndex)
  const aad = chunkAad(chunkSize, baseNonce, chunkIndex, flags, plain.length, contextHash)
  const cipher = createCipheriv("aes-256-gcm", dek, nonce)
  cipher.setAAD(aad)
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  const frameHeader = Buffer.alloc(5)
  frameHeader.writeUInt8(flags, 0)
  frameHeader.writeUInt32BE(plain.length, 1)
  return Buffer.concat([frameHeader, encrypted, tag])
}

function decryptChunk(encrypted, tag, dek, chunkSize, baseNonce, chunkIndex, flags, plainLength, contextHash) {
  const nonce = chunkNonce(baseNonce, chunkIndex)
  const aad = chunkAad(chunkSize, baseNonce, chunkIndex, flags, plainLength, contextHash)
  const decipher = createDecipheriv("aes-256-gcm", dek, nonce)
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()])
}

function encryptBufferEnvelope(plainBuffer, dek, context, { chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
  check(Buffer.isBuffer(plainBuffer), "明文输入必须为 Buffer")
  validateDek(dek)
  check(Number.isSafeInteger(chunkSize) && chunkSize >= MIN_CHUNK_SIZE && chunkSize <= MAX_CHUNK_SIZE, "分块大小超出允许范围")
  const contextHash = normalizeContext(context)
  const baseNonce = randomBytes(12)
  const header = Buffer.alloc(HEADER_BYTES)
  ENVELOPE_MAGIC.copy(header, 0)
  header.writeUInt32BE(chunkSize, ENVELOPE_MAGIC.length)
  baseNonce.copy(header, ENVELOPE_MAGIC.length + 4)
  const parts = [header]
  if (plainBuffer.length === 0) {
    parts.push(encryptChunk(Buffer.alloc(0), dek, chunkSize, baseNonce, 0, true, contextHash))
    return Buffer.concat(parts)
  }
  let index = 0
  for (let offset = 0; offset < plainBuffer.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, plainBuffer.length)
    const isFinal = end === plainBuffer.length
    parts.push(encryptChunk(plainBuffer.subarray(offset, end), dek, chunkSize, baseNonce, index++, isFinal, contextHash))
  }
  return Buffer.concat(parts)
}

function decryptBufferEnvelope(cipherBuffer, dek, context) {
  check(Buffer.isBuffer(cipherBuffer) && cipherBuffer.length >= HEADER_BYTES + 5 + TAG_BYTES, "密文长度无效")
  validateDek(dek)
  const contextHash = normalizeContext(context)
  check(cipherBuffer.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC), "密文格式标识无效")
  const chunkSize = cipherBuffer.readUInt32BE(ENVELOPE_MAGIC.length)
  check(chunkSize >= MIN_CHUNK_SIZE && chunkSize <= MAX_CHUNK_SIZE, "密文分块大小无效")
  const baseNonce = cipherBuffer.subarray(ENVELOPE_MAGIC.length + 4, HEADER_BYTES)
  let offset = HEADER_BYTES
  let chunkIndex = 0
  let sawFinal = false
  const outputs = []
  while (offset < cipherBuffer.length) {
    check(offset + 5 <= cipherBuffer.length, "密文分块头被截断")
    const flags = cipherBuffer.readUInt8(offset)
    const plainLen = cipherBuffer.readUInt32BE(offset + 1)
    offset += 5
    check(flags === 0 || flags === 1, "密文分块标志无效")
    check(plainLen <= chunkSize && (flags === 1 || plainLen > 0), "密文分块长度无效")
    check(offset + plainLen + TAG_BYTES <= cipherBuffer.length, "密文分块内容被截断")
    const body = cipherBuffer.subarray(offset, offset + plainLen)
    const tag = cipherBuffer.subarray(offset + plainLen, offset + plainLen + TAG_BYTES)
    offset += plainLen + TAG_BYTES
    outputs.push(decryptChunk(body, tag, dek, chunkSize, baseNonce, chunkIndex++, flags, plainLen, contextHash))
    if (flags === 1) {
      sawFinal = true
      break
    }
  }
  check(sawFinal && offset === cipherBuffer.length, "密文未正常结束或包含多余尾部字节")
  return Buffer.concat(outputs)
}

async function readExact(handle, length) {
  const buffer = Buffer.allocUnsafe(length)
  let total = 0
  while (total < length) {
    const { bytesRead } = await handle.read(buffer, total, length - total, null)
    if (bytesRead === 0) break
    total += bytesRead
  }
  return buffer.subarray(0, total)
}

async function encryptFileEnvelope(inputPath, outputPath, dek, context, { chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
  validateDek(dek)
  check(Number.isSafeInteger(chunkSize) && chunkSize >= MIN_CHUNK_SIZE && chunkSize <= MAX_CHUNK_SIZE, "分块大小超出允许范围")
  const contextHash = normalizeContext(context)
  const baseNonce = randomBytes(12)
  const header = Buffer.alloc(HEADER_BYTES)
  ENVELOPE_MAGIC.copy(header, 0)
  header.writeUInt32BE(chunkSize, ENVELOPE_MAGIC.length)
  baseNonce.copy(header, ENVELOPE_MAGIC.length + 4)

  const input = await fs.open(inputPath, "r")
  const output = await fs.open(outputPath, "wx", 0o600)
  let completed = false
  try {
    const plainHash = createHash("sha256")
    const cipherHash = createHash("sha256")
    let plainSizeBytes = 0
    let cipherSizeBytes = 0
    const writeOut = async (chunk) => {
      cipherHash.update(chunk)
      cipherSizeBytes += chunk.length
      await output.write(chunk)
    }
    await writeOut(header)

    let current = await readExact(input, chunkSize)
    if (current.length === 0) {
      await writeOut(encryptChunk(Buffer.alloc(0), dek, chunkSize, baseNonce, 0, true, contextHash))
    } else {
      let chunkIndex = 0
      while (current.length > 0) {
        const next = await readExact(input, chunkSize)
        const isFinal = next.length === 0
        plainHash.update(current)
        plainSizeBytes += current.length
        await writeOut(encryptChunk(current, dek, chunkSize, baseNonce, chunkIndex++, isFinal, contextHash))
        current = next
      }
    }
    completed = true
    return {
      plainSizeBytes,
      plainSha256: plainHash.digest("hex"),
      cipherSizeBytes,
      cipherSha256: cipherHash.digest("hex"),
      cipher: ENVELOPE_CIPHER,
    }
  } finally {
    await input.close().catch(() => {})
    await output.close().catch(() => {})
    if (!completed) await fs.unlink(outputPath).catch(() => {})
  }
}

async function decryptFileEnvelope(inputPath, outputPath, dek, context, expectedAsset = null) {
  validateDek(dek)
  const contextHash = normalizeContext(context)
  const input = await fs.open(inputPath, "r")
  const output = await fs.open(outputPath, "wx", 0o600)
  let completed = false
  try {
    const header = await readExact(input, HEADER_BYTES)
    check(header.length === HEADER_BYTES && header.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC), "密文头无效")
    const chunkSize = header.readUInt32BE(ENVELOPE_MAGIC.length)
    check(chunkSize >= MIN_CHUNK_SIZE && chunkSize <= MAX_CHUNK_SIZE, "密文分块大小无效")
    const baseNonce = header.subarray(ENVELOPE_MAGIC.length + 4, HEADER_BYTES)

    const plainHash = createHash("sha256")
    let plainSizeBytes = 0
    let chunkIndex = 0
    let sawFinal = false
    while (true) {
      const frameHead = await readExact(input, 5)
      if (frameHead.length === 0) break
      check(frameHead.length === 5, "密文分块头被截断")
      const flags = frameHead.readUInt8(0)
      const plainLen = frameHead.readUInt32BE(1)
      check(flags === 0 || flags === 1, "密文分块标志无效")
      check(plainLen <= chunkSize && (flags === 1 || plainLen > 0), "密文分块长度无效")
      const payload = await readExact(input, plainLen + TAG_BYTES)
      check(payload.length === plainLen + TAG_BYTES, "密文分块内容被截断")
      const body = payload.subarray(0, plainLen)
      const tag = payload.subarray(plainLen, plainLen + TAG_BYTES)
      const plain = decryptChunk(body, tag, dek, chunkSize, baseNonce, chunkIndex++, flags, plainLen, contextHash)
      plainSizeBytes += plain.length
      if (expectedAsset && plainSizeBytes > expectedAsset.sizeBytes) {
        throw new Error("解密后的制品超过签名大小")
      }
      plainHash.update(plain)
      if (plain.length > 0) await output.write(plain)
      if (flags === 1) {
        sawFinal = true
        const trailing = await readExact(input, 1)
        check(trailing.length === 0, "密文终块后存在非法尾部字节")
        break
      }
    }
    check(sawFinal, "密文缺少终块标记")
    const plainSha256 = plainHash.digest("hex")
    if (expectedAsset) {
      check(plainSizeBytes === expectedAsset.sizeBytes && plainSha256 === expectedAsset.sha256, "解密后的制品大小或 SHA-256 不符")
    }
    completed = true
    return { plainSizeBytes, plainSha256 }
  } finally {
    await input.close().catch(() => {})
    await output.close().catch(() => {})
    if (!completed) await fs.unlink(outputPath).catch(() => {})
  }
}

function wrapDekToPublicKey(dek, recipientX25519Pem, aadObject) {
  validateDek(dek)
  const recipientKey = normalizePublicKey(recipientX25519Pem, "x25519")
  const recipientKeyId = keyIdOfPublicKey(recipientKey, "x25519")
  const aadBytes = canonicalJson(aadObject)
  const ephemeral = generateKeyPairSync("x25519")
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipientKey })
  let kek
  try {
    kek = Buffer.from(hkdfSync("sha256", shared, sha256Buffer(aadBytes), Buffer.from("nacho-dek-wrap-v6", "utf8"), 32))
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", kek, iv)
    cipher.setAAD(aadBytes)
    const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()])
    const tag = cipher.getAuthTag()
    return {
      alg: WRAP_ALGORITHM,
      recipientKeyId,
      ephemeralPublicKey: ephemeral.publicKey.export({ type: "spki", format: "pem" }).toString(),
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: tag.toString("base64"),
      aad: aadObject,
    }
  } finally {
    shared.fill(0)
    if (kek) kek.fill(0)
  }
}

function unwrapDekWithPrivateKey(wrapped, recipientX25519PrivKey, expectedAadObject) {
  check(wrapped && typeof wrapped === "object" && wrapped.alg === WRAP_ALGORITHM, "信封密钥包裹格式无效")
  const recipientPriv = normalizePrivateKey(recipientX25519PrivKey, "x25519")
  const ephPub = normalizePublicKey(wrapped.ephemeralPublicKey, "x25519")
  const actualAadBytes = canonicalJson(wrapped.aad)
  if (expectedAadObject !== undefined) {
    const expectedAadBytes = canonicalJson(expectedAadObject)
    check(actualAadBytes.length === expectedAadBytes.length && timingSafeEqual(actualAadBytes, expectedAadBytes),
      "信封密钥包裹上下文不匹配")
  }
  const iv = Buffer.from(wrapped.iv || "", "base64")
  const ciphertext = Buffer.from(wrapped.ciphertext || "", "base64")
  const tag = Buffer.from(wrapped.tag || "", "base64")
  check(iv.length === 12 && tag.length === 16 && ciphertext.length === 32, "信封密钥密文长度无效")
  const shared = diffieHellman({ privateKey: recipientPriv, publicKey: ephPub })
  let kek
  try {
    kek = Buffer.from(hkdfSync("sha256", shared, sha256Buffer(actualAadBytes), Buffer.from("nacho-dek-wrap-v6", "utf8"), 32))
    const decipher = createDecipheriv("aes-256-gcm", kek, iv)
    decipher.setAAD(actualAadBytes)
    decipher.setAuthTag(tag)
    const dek = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    check(dek.length === 32, "解包后的 DEK 长度无效")
    return dek
  } finally {
    shared.fill(0)
    if (kek) kek.fill(0)
  }
}

function requestSigningPayload(method, requestPath, timestamp, nonce, bodyBytes) {
  const bytes = Buffer.isBuffer(bodyBytes) ? bodyBytes : Buffer.from(bodyBytes || "", "utf8")
  return Buffer.from([
    String(method).toUpperCase(),
    String(requestPath),
    String(timestamp),
    String(nonce),
    sha256Hex(bytes),
  ].join("\n"), "utf8")
}

function signHttpRequest({ method, path: requestPath, timestamp, nonce, bodyBytes, privateKey }) {
  const key = normalizePrivateKey(privateKey, "ed25519")
  const payload = requestSigningPayload(method, requestPath, timestamp, nonce, bodyBytes)
  return sign(null, payload, key).toString("base64")
}

function verifyHttpRequest({
  method, path: requestPath, timestamp, nonce, bodyBytes, signatureBase64, publicKey,
  now = Date.now(), maxSkewMs = MAX_REQUEST_SKEW_MS,
}) {
  check(typeof nonce === "string" && NONCE_PATTERN.test(nonce), "请求 Nonce 格式无效")
  const ts = typeof timestamp === "number" ? timestamp : /^\d+$/.test(String(timestamp)) ? Number(timestamp) : Date.parse(String(timestamp))
  check(Number.isSafeInteger(ts) && Math.abs(now - ts) <= maxSkewMs, "请求时间戳无效或已过期")
  check(typeof signatureBase64 === "string" && signatureBase64.length > 0 && signatureBase64.length <= 128, "请求签名格式无效")
  const signature = Buffer.from(signatureBase64, "base64")
  check(signature.length === 64, "请求签名长度无效")
  const key = normalizePublicKey(publicKey, "ed25519")
  const payload = requestSigningPayload(method, requestPath, timestamp, nonce, bodyBytes)
  check(verify(null, payload, key, signature), "请求签名校验失败")
  return { timestampMs: ts, nonce }
}

module.exports = {
  ENVELOPE_MAGIC,
  ENVELOPE_CIPHER,
  WRAP_ALGORITHM,
  DEFAULT_CHUNK_SIZE,
  MAX_REQUEST_SKEW_MS,
  NONCE_PATTERN,
  canonicalJsonString,
  canonicalJson,
  sha256Buffer,
  sha256Hex,
  normalizePublicKey,
  normalizePrivateKey,
  keyIdOfPublicKey,
  exportPublicPem,
  deviceIdForAuthKey,
  generateDeviceIdentity,
  generateDek,
  encryptBufferEnvelope,
  decryptBufferEnvelope,
  encryptFileEnvelope,
  decryptFileEnvelope,
  wrapDekToPublicKey,
  unwrapDekWithPrivateKey,
  requestSigningPayload,
  signHttpRequest,
  verifyHttpRequest,
}
