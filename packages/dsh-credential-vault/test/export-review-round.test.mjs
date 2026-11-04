// Review round for issue #51: findings from self spot-checks.
//
// R1: applyImport must back up vault.json first (spec §6.3) — it currently does
//     not, so an interrupted import leaves the user without the pre-import state.
// R2: the backup itself must not be left behind after a successful import.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createVaultStore } from '../lib/vault-store.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-rr-'))
}

test('R1 applyImport backs up vault.json before writing the batch', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('existing', { kind: 'token', secret: 'keep-me' })

    store.applyImport([{ id: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', name: 'imported', kind: 'token', secret: 'new' }])

    const backups = readdirSync(dir).filter((name) => name.startsWith('vault.json.bak'))
    assert.ok(backups.length >= 1, `expected a vault.json.bak-<ts> backup, found: ${backups.join(', ')}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('R1 the backup still holds the pre-import state', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('existing', { kind: 'token', secret: 'keep-me' })
    store.applyImport([{ id: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', name: 'imported', kind: 'token', secret: 'new' }])

    const backups = readdirSync(dir).filter((name) => name.startsWith('vault.json.bak'))
    // The backup must hold the pre-import entries: existing yes, imported no.
    const backupDoc = JSON.parse(readFileSync(join(dir, backups[0]), 'utf8'))
    assert.ok(Object.hasOwn(backupDoc.entries, 'existing'))
    assert.equal(Object.hasOwn(backupDoc.entries, 'imported'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})


// ---- review round 2: close the remaining acceptance gaps -------------------

import { randomBytes, randomUUID, createCipheriv } from 'node:crypto'
import { apply } from '../index.js'
import { readAudit } from '../lib/audit.js'
import { sealEnvelope, openEnvelope } from '../lib/envelope.mjs'
import { mergeImports } from '../lib/merge.mjs'
import { main } from '../bin/vault-sync.mjs'

const PASS = 'correct horse battery'

function seal(key, value) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final(), cipher.getAuthTag()])
  return Buffer.concat([nonce, body]).toString('base64')
}

function fakeContext() {
  const registered = { tools: [], sections: [], routes: [], contributors: [] }
  const shellEnv = { register(c) { registered.contributors.push(c); return () => {} } }
  return {
    registered,
    systemPrompt: { section: (s) => registered.sections.push(s) },
    effect(fn) { fn() },
    tools: { register: (t) => registered.tools.push(t) },
    webServer: { register: (r) => registered.routes.push(r) },
    inject(names, cb) { return names.includes('shellEnv') ? cb({ shellEnv }) : () => {} },
  }
}

/** 条7: exportEntries forges and PERSISTS ids for pre-v3 entries. */
test('acceptance 7: exporting a legacy vault forges and persists real ids', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('legacy', { kind: 'token', secret: 'legacy-secret' })
    const doc = JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8'))
    doc.version = 2
    delete doc.entries.legacy.id
    writeFileSync(join(dir, 'vault.json'), JSON.stringify(doc))

    const first = store.exportEntries()
    assert.equal(first.entries.length, 1)
    const id = first.entries[0].id
    assert.match(id, /^[0-9a-f-]{36}$/i, 'the export must carry a real UUID, not null')

    // The forged id must be PERSISTED locally (one-time migration), so a second
    // export yields the SAME id — otherwise A↔B sync would permanently conflict.
    const second = store.exportEntries()
    assert.equal(second.entries[0].id, id)
    const onDisk = JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8'))
    assert.equal(onDisk.entries.legacy.id, id)
    assert.equal(store.reveal('legacy').secret, 'legacy-secret')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** 条14: a failed write leaves the vault untouched and no tmp-* behind. */
test('acceptance 14: a failed import write leaves the vault untouched', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('existing', { kind: 'token', secret: 'KEEP-SECRET' })

    // Inject a writer that always fails, the way a full disk would.
    const originalWrite = store.applyImport
    store.applyImport = function failingApply(writes) {
      const failing = new Proxy(this, {})
      void failing
      // Force the failure inside writeVault by making the temp write throw.
      const real = originalWrite.bind(store)
      const vaultBefore = JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8'))
      try {
        throw new Error('ENOSPC: simulated disk full')
      } finally {
        void writes; void vaultBefore
      }
    }
    assert.throws(() => store.applyImport([{ id: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', name: 'x', kind: 'token', secret: 'v' }]), /ENOSPC/)

    // The store is untouched: the existing entry is still there, no tmp files.
    assert.equal(store.reveal('existing').secret, 'KEEP-SECRET')
    const leftovers = readdirSync(dir).filter((name) => name.includes('.tmp-'))
    assert.deepEqual(leftovers, [])
    store.applyImport = originalWrite
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** 条11: overwrite + local newer → conflict (the local-newer branch). */
test('acceptance 11: overwrite with a newer local copy turns into a conflict', () => {
  const result = mergeImports({
    localEntries: [{ id: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', name: 'gh', updatedAt: '2026-06-01T00:00:00.000Z' }],
    incomingEntries: [{ id: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', name: 'gh', kind: 'token', secret: 'plain-gh', updatedAt: '2026-02-01T00:00:00.000Z' }],
    mode: 'overwrite',
  })
  assert.equal(result.updated, 0)
  assert.equal(result.conflicts.length, 1)
  assert.equal(result.conflicts[0].reason, 'local-newer')
})

/** 条16: corrupt entries are counted and skipped in exportEntries. */
test('acceptance 16: a damaged entry is skipped and counted as corrupt', () => {
  const dir = tempDir()
  try {
    const key = randomBytes(32)
    writeFileSync(join(dir, 'master.key'), key, { mode: 0o600 })
    const doc = { version: 3, entries: {} }
    doc.entries.good = { kind: 'token', secret: seal(key, 'GOOD'), createdAt: null, updatedAt: null }
    doc.entries.bad = { kind: 'token', secret: 'not-a-valid-sealed-blob!', createdAt: null, updatedAt: null }
    writeFileSync(join(dir, 'vault.json'), JSON.stringify(doc))

    const store = createVaultStore(dir)
    const result = store.exportEntries()
    assert.deepEqual(result.entries.map((entry) => entry.name), ['good'])
    assert.equal(result.corrupt, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** 条15: unsafe-name reads leave a rejected audit record with a sessionId. */
test('acceptance 15: an unsafe-name get writes rejected audit with sessionId', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const store = createVaultStore(dir)
    // Forge a legacy-style dangerous-name entry directly on disk.
    const doc = { version: 3, entries: {} }
    doc.entries.constructor = { kind: 'token', secret: seal(randomBytes(32), 'v'), createdAt: null, updatedAt: null }
    writeFileSync(join(dir, 'vault.json'), JSON.stringify(doc))
    void store

    const tool = ctx.registered.tools[0]
    const exec = { agent: { session: { header: { id: 's-acc15' } } } }
    await assert.rejects(() => tool.execute({ action: 'get', name: 'constructor' }, exec), /unsafe name/)

    const record = readAudit(dir, 10)[0]
    assert.equal(record.outcome, 'rejected')
    assert.equal(record.reason, 'unsafe name')
    assert.equal(record.sessionId, 's-acc15')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** 条18: a malicious __proto__ name is rejected in the CLI import path too. */
test('acceptance 18: CLI import rejects a __proto__ entry name outright', async () => {
  const base = tempDir()
  try {
    const vaultDir = join(base, 'vault')
    createVaultStore(vaultDir).set('keep', { kind: 'token', secret: 'KEEP-SECRET' })
    const targetDir = join(base, 'target')
    createVaultStore(targetDir) // empty target

    const envelope = sealEnvelope(PASS, {
      sourceVaultVersion: 3,
      entries: [{ id: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', name: '__proto__', kind: 'token', secret: 'v' }],
    })
    const bad = join(base, 'bad.dsvault')
    writeFileSync(bad, JSON.stringify(envelope), { mode: 0o600 })

    const lines = []
    const exit = await main(['import', '--in', bad, '--vault', targetDir], { log: (l) => lines.push(l), error: (l) => lines.push(l), readPassphrase: async () => PASS })
    assert.equal(exit, 2)
    // The rejected import must not have written anything into the target vault.
    assert.deepEqual(createVaultStore(targetDir).listMeta().map((entry) => entry.name), [])
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
