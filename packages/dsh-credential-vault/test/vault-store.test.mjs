// Tests for lib/vault-store.js — the store facade used by both tool and API.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createVaultStore } from '../lib/vault-store.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-store-test-'))
}

test('set / get / list never expose the secret', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    const result = store.set('github-token', { kind: 'token', secret: 'ghp_secretvalue', note: 'CI' })
    assert.deepEqual(result, { name: 'github-token', updated: false })

    const got = store.get('github-token')
    assert.equal(got.hasSecret, true)
    assert.equal(got.kind, 'token')
    assert.equal(got.note, 'CI')
    assert.equal(JSON.stringify(got).includes('ghp_secretvalue'), false)

    const listed = store.list()
    assert.equal(listed.length, 1)
    assert.equal(JSON.stringify(listed).includes('ghp_secretvalue'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reveal returns the plaintext exactly once sealed back', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('prod-server', { kind: 'password', secret: 'S3cret!', username: 'root', url: 'ssh://10.0.0.1' })
    const revealed = store.reveal('prod-server')
    assert.equal(revealed.secret, 'S3cret!')
    assert.equal(revealed.username, 'root')
    assert.equal(store.reveal('nope'), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('set validates name, kind and secret', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    assert.throws(() => store.set('a/b', { secret: 'x' }), /invalid credential name/)
    assert.throws(() => store.set('ok', { kind: 'nope', secret: 'x' }), /invalid kind/)
    assert.throws(() => store.set('ok', { secret: '' }), /secret must be/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('update keeps createdAt, refreshes updatedAt, flags updated', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('k', { secret: 'one' })
    const before = store.get('k')
    const result = store.set('k', { kind: 'api-key', secret: 'two' })
    assert.equal(result.updated, true)
    const after = store.get('k')
    assert.equal(after.createdAt, before.createdAt)
    assert.notEqual(after.updatedAt, before.updatedAt)
    assert.equal(store.reveal('k').secret, 'two')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('delete reports existence', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('k', { secret: 'v' })
    assert.equal(store.delete('k'), true)
    assert.equal(store.delete('k'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rotateKey re-encrypts every entry under a new key', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('a', { secret: 'alpha' })
    store.set('b', { secret: 'beta' })
    const resealed = store.rotateKey()
    assert.equal(resealed, 2)
    assert.equal(store.reveal('a').secret, 'alpha')
    assert.equal(store.reveal('b').secret, 'beta')
    const keyMode = statSync(join(dir, 'master.key')).mode & 0o777
    assert.equal(keyMode, 0o600)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('two stores on the same dir share the same master key', () => {
  const dir = tempDir()
  try {
    const first = createVaultStore(dir)
    first.set('k', { secret: 'v' })
    const second = createVaultStore(dir)
    assert.equal(second.reveal('k').secret, 'v')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
