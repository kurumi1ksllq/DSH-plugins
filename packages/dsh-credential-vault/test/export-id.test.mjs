// T1 (issue #51): stable ids + vault v3 + version ceiling.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { VAULT_VERSION, readVault } from '../lib/store.js'
import { createVaultStore } from '../lib/vault-store.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-id-'))
}

test('a created credential carries a stable UUID id', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('github token', { kind: 'token', secret: 'v', service: 'github', aliases: ['gh'] })

    const listed = store.listMeta()
    assert.equal(listed.length, 1)
    const id = listed[0].id
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, id)

    // The id survives writes and reads.
    store.set('github token', { kind: 'token', secret: 'v2' })
    assert.equal(store.listMeta()[0].id, id, 'overwriting must keep the id')

    store.update('github token', { note: 'x' })
    assert.equal(store.listMeta()[0].id, id, 'updating must keep the id')

    assert.equal(store.get('github token').id, id)
    assert.equal(store.reveal('github token').id, id)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('two credentials never share an id', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('one', { kind: 'token', secret: '1' })
    store.set('two', { kind: 'token', secret: '2' })
    const ids = store.listMeta().map((entry) => entry.id)
    assert.equal(new Set(ids).size, ids.length)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('set() return value does not carry the id (documented contract)', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    const result = store.set('x', { kind: 'token', secret: 'v' })
    assert.deepEqual(result, { name: 'x', updated: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a version 2 vault gets ids on write and keeps its secrets', () => {
  const dir = tempDir()
  try {
    const seeded = createVaultStore(dir)
    seeded.set('legacy', { kind: 'token', secret: 'legacy-secret' })
    const doc = JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8'))
    doc.version = 2
    delete doc.entries.legacy.id
    writeFileSync(join(dir, 'vault.json'), JSON.stringify(doc))

    const store = createVaultStore(dir)
    const before = store.reveal('legacy').secret

    // Writing the legacy entry itself upgrades it in place (keeps secret, gains id).
    store.set('legacy', { kind: 'token', secret: 'legacy-secret' })
    const after = JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8'))
    assert.equal(after.version, VAULT_VERSION)
    assert.match(after.entries.legacy.id, /^[0-9a-f-]{36}$/i, 'the legacy entry must gain an id when written')
    assert.equal(store.reveal('legacy').secret, before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readVault refuses a FUTURE vault version instead of degrading it', () => {
  const dir = tempDir()
  try {
    writeFileSync(
      join(dir, 'vault.json'),
      JSON.stringify({ version: VAULT_VERSION + 1, entries: {} }),
    )
    assert.throws(() => readVault(dir), /unsupported-vault-version/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
