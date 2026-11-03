// Tests for lib/store.js — sealing, masking, file permissions, validation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs'
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
    const mode = statSync(join(dir, 'master.key')).mode & 0o777
    assert.equal(mode, 0o600)
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
    const mode = statSync(join(dir, 'vault.json')).mode & 0o777
    assert.equal(mode, 0o600)
    assert.deepEqual(readVault(dir), vault)
    assert.ok(existsSync(`${join(dir, 'vault.json')}.tmp-0`) === false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readVault on a missing file returns an empty vault', () => {
  const dir = tempDir()
  try {
    assert.deepEqual(readVault(dir), { version: VAULT_VERSION, entries: {} })
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
