// Tests for the normalized credential model (issue #36, T1).
//
// Public behaviour only: the name normalizer, the kind enum, the new
// `service`/`aliases` metadata, the vault version bump and slug-collision
// refusal. Old version-1 vaults must keep reading exactly as before.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { KINDS, VAULT_VERSION, normalizeKey, readVault, slugOf, writeVault, emptyVault } from '../lib/store.js'
import { createVaultStore } from '../lib/vault-store.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-normalize-test-'))
}

test('KINDS offers a database classification', () => {
  assert.ok(KINDS.includes('database'))
  assert.deepEqual(KINDS, ['password', 'token', 'api-key', 'ssh-key', 'database', 'other'])
})

test('normalizeKey folds case, whitespace and punctuation', () => {
  assert.equal(normalizeKey('github token'), 'github-token')
  assert.equal(normalizeKey('GitHub_Token'), 'github-token')
  assert.equal(normalizeKey('  GitHub   Token  '), 'github-token')
  assert.equal(normalizeKey('prod-server'), 'prod-server')
  assert.equal(normalizeKey('a---b'), 'a-b')
})

test('normalizeKey keeps non-ASCII names usable', () => {
  assert.equal(normalizeKey('阿里云 ECS 密码'), '阿里云-ecs-密码')
  assert.equal(normalizeKey('数据库 root'), '数据库-root')
})

test('normalizeKey of an empty or punctuation-only value is empty', () => {
  assert.equal(normalizeKey(''), '')
  assert.equal(normalizeKey('   '), '')
  assert.equal(normalizeKey('---'), '')
})

test('slugOf derives the same slug for the same name', () => {
  assert.equal(slugOf('github token'), 'github-token')
  assert.equal(slugOf('github-token'), 'github-token')
})

test('a store keeps service and aliases as user-maintained metadata', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('github token', {
      kind: 'token',
      secret: 'ghp_value',
      service: 'github',
      aliases: ['gh', 'git', 'GitHub_Token'],
    })

    const got = store.get('github token')
    assert.equal(got.service, 'github')
    assert.deepEqual(got.aliases, ['gh', 'git', 'GitHub_Token'])
    assert.equal(got.slug, 'github-token')

    const listed = store.list()
    assert.equal(listed.length, 1)
    assert.equal(listed[0].slug, 'github-token')
    assert.deepEqual(listed[0].aliases, ['gh', 'git', 'GitHub_Token'])
    assert.equal(JSON.stringify(listed).includes('ghp_value'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('metadata defaults are null and an empty list when not supplied', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('bare', { kind: 'password', secret: 'v' })
    const got = store.get('bare')
    assert.equal(got.service, null)
    assert.deepEqual(got.aliases, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('aliases are trimmed, de-duplicated and blank entries dropped', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('dup', { kind: 'token', secret: 'v', aliases: [' gh ', 'gh', '', '   ', 'git'] })
    const got = store.get('dup')
    assert.deepEqual(got.aliases, ['gh', 'git'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a second credential whose name folds to the same slug is refused', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('github token', { kind: 'token', secret: 'one' })
    assert.throws(
      () => store.set('github-token', { kind: 'token', secret: 'two' }),
      /github token/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updating an existing credential by its own name is allowed', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('github token', { kind: 'token', secret: 'one' })
    const again = store.set('github token', { kind: 'token', secret: 'two' })
    assert.deepEqual(again, { name: 'github token', updated: true })
    assert.equal(store.get('github token').hasSecret, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('update() carries service and aliases without touching the secret', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('rotated', { kind: 'api-key', secret: 'sk_live_value' })
    assert.equal(store.update('rotated', { service: 'openai', aliases: ['oa'] }), true)
    const got = store.get('rotated')
    assert.equal(got.service, 'openai')
    assert.deepEqual(got.aliases, ['oa'])
    assert.equal(store.reveal('rotated').secret, 'sk_live_value')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writes bump the vault document to version 2', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('v2', { kind: 'token', secret: 'v' })
    const doc = JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8'))
    assert.equal(doc.version, VAULT_VERSION)
    assert.ok(VAULT_VERSION >= 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a version 1 vault still reads with the new metadata defaults', () => {
  const dir = tempDir()
  try {
    // Build a real version-1 document by sealing through the store, then rewrite
    // it as the legacy shape (no service/aliases, version 1).
    const seeded = createVaultStore(dir)
    seeded.set('legacy-token', { kind: 'token', secret: 'legacy-value', note: 'old' })
    const doc = JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8'))
    doc.version = 1
    delete doc.entries['legacy-token'].service
    delete doc.entries['legacy-token'].aliases
    writeFileSync(join(dir, 'vault.json'), JSON.stringify(doc))

    const vault = readVault(dir)
    assert.equal(vault.version, 1)
    assert.equal(Object.keys(vault.entries).length, 1)

    const store = createVaultStore(dir)
    const got = store.get('legacy-token')
    assert.equal(got.note, 'old')
    assert.equal(got.service, null)
    assert.deepEqual(got.aliases, [])
    assert.equal(got.slug, 'legacy-token')
    assert.equal(store.reveal('legacy-token').secret, 'legacy-value')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('emptyVault starts at the current version with no entries', () => {
  const vault = emptyVault()
  assert.equal(vault.version, VAULT_VERSION)
  assert.deepEqual(vault.entries, {})
})

test('writeVault/readVault round-trip the normalized metadata', () => {
  const dir = tempDir()
  try {
    const vault = emptyVault()
    vault.entries['svc'] = {
      kind: 'database',
      secret: 'sealed',
      service: 'mysql',
      aliases: ['db'],
      username: null,
      url: null,
      note: null,
      createdAt: null,
      updatedAt: null,
    }
    writeVault(dir, vault)
    const back = readVault(dir)
    assert.deepEqual(back.entries['svc'].aliases, ['db'])
    assert.equal(back.entries['svc'].service, 'mysql')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- review round: P1-4 (a write must upgrade an old document) ----

test('set() upgrades a version 1 document to the current version', () => {
  const dir = tempDir()
  try {
    const seeded = createVaultStore(dir)
    seeded.set('legacy', { kind: 'token', secret: 'legacy-value' })
    const doc = JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8'))
    doc.version = 1
    const legacySecret = doc.entries.legacy.secret
    writeFileSync(join(dir, 'vault.json'), JSON.stringify(doc))

    const store = createVaultStore(dir)
    store.set('fresh', { kind: 'token', secret: 'fresh-value' })

    const after = JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8'))
    assert.equal(after.version, VAULT_VERSION)
    assert.equal(after.entries.legacy.secret, legacySecret, 'an upgrade must not re-seal existing entries')
    assert.equal(store.reveal('legacy').secret, 'legacy-value')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('update() also upgrades the document version', () => {
  const dir = tempDir()
  try {
    const seeded = createVaultStore(dir)
    seeded.set('legacy', { kind: 'token', secret: 'v' })
    const doc = JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8'))
    doc.version = 1
    writeFileSync(join(dir, 'vault.json'), JSON.stringify(doc))

    const store = createVaultStore(dir)
    assert.equal(store.update('legacy', { note: 'touched' }), true)
    assert.equal(JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8')).version, VAULT_VERSION)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- review round: P1-5 (one damaged entry must not break the listing) ----

test('list() degrades a damaged entry instead of throwing, and keeps the rest', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('good', { kind: 'token', secret: 'ghp_good' })
    store.set('damaged', { kind: 'token', secret: 'v' })
    const file = join(dir, 'vault.json')
    const doc = JSON.parse(readFileSync(file, 'utf8'))
    doc.entries.damaged.secret = Buffer.from('broken-ciphertext-here').toString('base64')
    writeFileSync(file, JSON.stringify(doc))

    const listed = store.list()
    assert.equal(listed.length, 2)
    const good = listed.find((entry) => entry.name === 'good')
    const damaged = listed.find((entry) => entry.name === 'damaged')
    assert.equal(good.preview.includes('ghp_good'), false)
    assert.ok(good.preview)
    assert.equal(damaged.preview, null)
    assert.equal(damaged.corrupt, true)
    assert.equal(damaged.hasSecret, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
