// Tests for lib/store.js — sealing, masking, file permissions, validation.
import { test } from 'node:test'
import { assertOwnerOnly } from './owner-mode.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  KINDS,
  VAULT_VERSION,
  isValidName,
  loadOrCreateMasterKey,
  maskSecret,
  openSecret,
  readVault,
  sealSecret,
  verifySecret,
  writeVault,
  vaultFingerprint,
  assertVaultUnchanged,
} from '../lib/store.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-test-'))
}

test('master key is created once, 32 bytes, mode 0600', () => {
  const dir = tempDir()
  try {
    const first = loadOrCreateMasterKey(dir)
    assert.equal(first.key.length, 32)
    assert.equal(first.created, true)
    assertOwnerOnly(join(dir, 'master.key'))
    const second = loadOrCreateMasterKey(dir)
    assert.equal(second.created, false)
    assert.deepEqual(second.key, first.key)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('seal/open round-trips and rejects tampering', () => {
  const key = loadOrCreateMasterKey(tempDir()).key
  const sealed = sealSecret(key, 'hunter2 中文 🔐')
  assert.notEqual(sealed, 'hunter2 中文 🔐')
  assert.equal(openSecret(key, sealed), 'hunter2 中文 🔐')
  const tampered = sealed.slice(0, -4) + 'AAAA'
  assert.throws(() => openSecret(key, tampered))
})

test('verifySecret is true only for the right guess', () => {
  const key = loadOrCreateMasterKey(tempDir()).key
  const sealed = sealSecret(key, 'secret-value')
  assert.equal(verifySecret(key, sealed, 'secret-value'), true)
  assert.equal(verifySecret(key, sealed, 'wrong'), false)
})

test('maskSecret never leaks long secrets and hides short ones', () => {
  assert.equal(maskSecret('short'), '***')
  assert.equal(maskSecret('a-very-long-secret-value').length <= 8, true)
  const masked = maskSecret('ghp_abcdefghijklmnop')
  assert.match(masked, /^ghp_…/)
  assert.equal(masked.includes('cdefghij'), false)
})

test('vault file is 0600 and round-trips', () => {
  const dir = tempDir()
  try {
    const vault = { version: 1, entries: { a: { secret: 'x' } } }
    writeVault(dir, vault)
    assertOwnerOnly(join(dir, 'vault.json'))
    const back = readVault(dir)
    assert.equal(back.version, 1)
    // Spread into a plain object: readVault returns prototype-free entries.
    assert.deepEqual({ ...back.entries }, vault.entries)
    assert.ok(existsSync(`${join(dir, 'vault.json')}.tmp-0`) === false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readVault on a missing file returns an empty vault', () => {
  const dir = tempDir()
  try {
    const vault = readVault(dir)
    assert.equal(vault.version, VAULT_VERSION)
    assert.deepEqual(Object.keys(vault.entries), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('isValidName rejects separators, control chars and empties', () => {
  for (const good of ['github-token', 'prod server', '中文名', 'a'.repeat(128)]) {
    assert.equal(isValidName(good), true, good)
  }
  for (const bad of ['', '   ', 'a/b', 'a\\b', 'a\nb', 'a\u0000b', `${'a'.repeat(129)}`, null, 42]) {
    assert.equal(isValidName(bad), false, String(bad))
  }
})

test('KINDS covers the documented credential types', () => {
  assert.deepEqual(KINDS, ['password', 'token', 'api-key', 'ssh-key', 'database', 'other'])
})


// ---- #103 D1:乐观并发守卫(跨进程共享 $DSH_HOME 的最后防线) ----
import { writeFileSync } from 'node:fs'

test('vaultFingerprint hashes the vault file; missing file hashes as null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'store-fp-'))
  assert.equal(vaultFingerprint(dir), null, 'no vault.json yet')
  writeVault(dir, { version: VAULT_VERSION, entries: {} })
  const a = vaultFingerprint(dir)
  assert.equal(typeof a, 'string')
  writeVault(dir, { version: VAULT_VERSION, entries: { x: { secret: 's' } } })
  assert.notEqual(vaultFingerprint(dir), a, 'different content, different fingerprint')
})

test('assertVaultUnchanged throws when the file changed since the stamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'store-guard-'))
  writeVault(dir, { version: VAULT_VERSION, entries: {} })
  const stamp = vaultFingerprint(dir)
  assert.doesNotThrow(() => assertVaultUnchanged(dir, stamp))
  // 模拟另一个宿主进程在同一目录上落了盘
  writeFileSync(join(dir, 'vault.json'), JSON.stringify({ version: VAULT_VERSION, entries: { other: { secret: 'e' } } }))
  assert.throws(() => assertVaultUnchanged(dir, stamp), /changed on disk/)
})
