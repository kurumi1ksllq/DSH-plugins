// T2 (issue #51): the password-encrypted export envelope.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sealEnvelope, openEnvelope, ENVELOPE_KDF, ENVELOPE_FORMAT } from '../lib/envelope.mjs'

const PAYLOAD = { sourceVaultVersion: 3, entries: [{ id: 'x', name: 'github token', secret: 'ghp_topsecret' }] }
const PASS = 'correct horse battery'

test('seal/open round-trips with the right passphrase', () => {
  const envelope = sealEnvelope(PASS, PAYLOAD)
  assert.equal(envelope.format, ENVELOPE_FORMAT)
  assert.equal(envelope.kdf.N, ENVELOPE_KDF.N)
  const opened = openEnvelope(PASS, envelope)
  assert.deepEqual(opened, PAYLOAD)
})

test('a wrong passphrase fails with the unified error', () => {
  const envelope = sealEnvelope(PASS, PAYLOAD)
  assert.throws(() => openEnvelope('wrong passphrase 12', envelope), (error) => error.code === 'bad-passphrase-or-tampered')
})

test('tampering with the payload fails', () => {
  const envelope = sealEnvelope(PASS, PAYLOAD)
  const corrupted = { ...envelope, payload: envelope.payload.slice(0, -4) + 'AAAA' }
  assert.throws(() => openEnvelope(PASS, corrupted), (error) => error.code === 'bad-passphrase-or-tampered')
})

test('tampering with the header (exportedAt) fails — AAD covers it', () => {
  const envelope = sealEnvelope(PASS, PAYLOAD)
  const rewritten = { ...envelope, exportedAt: '2000-01-01T00:00:00.000Z' }
  assert.throws(() => openEnvelope(PASS, rewritten), (error) => error.code === 'bad-passphrase-or-tampered')
})

test('a non-canonical kdf parameter is refused without allocating memory', () => {
  const envelope = sealEnvelope(PASS, PAYLOAD)
  // An attacker rewrites N to force a huge scrypt allocation.
  const forged = { ...envelope, kdf: { ...envelope.kdf, N: 1073741824 } }
  assert.throws(() => openEnvelope(PASS, forged), (error) => error.code === 'bad-passphrase-or-tampered')
  // Even a "smaller" N is refused: only the exact built-in constants are legal.
  const shrunk = { ...envelope, kdf: { ...envelope.kdf, N: 16384 } }
  assert.throws(() => openEnvelope(PASS, shrunk), (error) => error.code === 'bad-passphrase-or-tampered')
})

test('two seals of the same payload use different salt and iv', () => {
  const a = sealEnvelope(PASS, PAYLOAD)
  const b = sealEnvelope(PASS, PAYLOAD)
  assert.notEqual(a.kdf.salt, b.kdf.salt)
  assert.notEqual(a.cipher.iv, b.cipher.iv)
})

test('an unknown envelope format or version is refused', () => {
  const envelope = sealEnvelope(PASS, PAYLOAD)
  assert.throws(() => openEnvelope(PASS, { ...envelope, format: 'someone-else' }), (error) => error.code === 'bad-passphrase-or-tampered')
  assert.throws(() => openEnvelope(PASS, { ...envelope, version: 99 }), (error) => error.code === 'bad-passphrase-or-tampered')
})

test('a short passphrase is refused at seal time', () => {
  assert.throws(() => sealEnvelope('short12', PAYLOAD), /passphrase/)
})
