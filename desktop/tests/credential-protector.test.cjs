const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const { createCredentialProtector } = require("../src/credential-protector.cjs")
const helper = path.resolve(__dirname, "../build/credential-protector/nacho-credential-protector.exe")

test("DPAPI fresh-process round trip survives helper relocation and rejects tampering", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-native-credentials-"))
  try {
    const original = createCredentialProtector(helper)
    const plaintext = "credential-protector-only-fixture"
    const encrypted = original.protect(plaintext)
    assert.equal(encrypted.includes(Buffer.from(plaintext)), false)
    const relocated = path.join(root, "upgraded-panel.exe")
    fs.copyFileSync(helper, relocated)
    assert.equal(createCredentialProtector(relocated).unprotect(encrypted), plaintext)
    const tampered = Buffer.from(encrypted)
    tampered[tampered.length - 1] ^= 1
    assert.throws(() => original.unprotect(tampered), /保护操作失败/)
    assert.throws(() => createCredentialProtector(path.join(root, "missing.exe")).protect(plaintext), /保护操作失败/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
