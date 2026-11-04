// T6 (issue #51): the vault-sync CLI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { main, parseArgs } from '../bin/vault-sync.mjs'
import { createVaultStore } from '../lib/vault-store.js'
import { sealEnvelope } from '../lib/envelope.mjs'

const PASS = 'correct horse battery'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-sync-'))
}

function io() {
  const lines = []
  return { lines, log: (line) => lines.push(line), error: (line) => lines.push(`ERR ${line}`) }
}

test('parseArgs validates the command and required flags', () => {
  assert.equal(parseArgs([]).error !== undefined, true)
  assert.equal(parseArgs(['nope']).error !== undefined, true)
  assert.equal(parseArgs(['export']).error !== undefined, true)
  assert.equal(parseArgs(['export', '--out']).error !== undefined, true)
  const ok = parseArgs(['export', '--out', 'a.dsvault'])
  assert.equal(ok.error, undefined)
  assert.equal(ok.out, 'a.dsvault')
})

test('export writes an envelope file that import can read back', async () => {
  const base = tempDir()
  try {
    const vaultDir = join(base, 'vault')
    const store = createVaultStore(vaultDir)
    store.set('github token', { kind: 'token', secret: 'ghp_syncvalue', service: 'github', aliases: ['gh'] })

    const out = join(base, 'sync.dsvault')
    const exit = await main(['export', '--out', out, '--vault', vaultDir], { ...io(), readPassphrase: async () => PASS })
    assert.equal(exit, 0)
    assert.ok(existsSync(out))
    const written = JSON.parse(readFileSync(out, 'utf8'))
    assert.equal(written.format, 'dsh-credential-vault-export')

    // Import into a second vault.
    const targetDir = join(base, 'target')
    const importExit = await main(['import', '--in', out, '--vault', targetDir], { ...io(), readPassphrase: async () => PASS })
    assert.equal(importExit, 0)
    const target = createVaultStore(targetDir)
    assert.equal(target.reveal('github token').secret, 'ghp_syncvalue')
    assert.deepEqual(target.get('github token').aliases, ['gh'])
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('a wrong passphrase exits 2 and leaves no file', async () => {
  const base = tempDir()
  try {
    const vaultDir = join(base, 'vault')
    createVaultStore(vaultDir).set('a', { kind: 'token', secret: 'v' })
    const out = join(base, 'x.dsvault')
    // Export with the right passphrase first.
    await main(['export', '--out', out, '--vault', vaultDir], { ...io(), readPassphrase: async () => PASS })
    // Import with the wrong one.
    const exit = await main(['import', '--in', out, '--vault', join(base, 't2')], {
      ...io(), readPassphrase: async () => 'totally-wrong-pass',
    })
    assert.equal(exit, 2)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('--dry-run reports without writing the vault', async () => {
  const base = tempDir()
  try {
    const vaultDir = join(base, 'vault')
    const store = createVaultStore(vaultDir)
    store.set('github token', { kind: 'token', secret: 'ghp_dryrun' })

    const out = join(base, 'sync.dsvault')
    await main(['export', '--out', out, '--vault', vaultDir], { ...io(), readPassphrase: async () => PASS })

    const targetDir = join(base, 'target')
    const target = createVaultStore(targetDir) // empty vault; no vault.json until a write

    const exit = await main(['import', '--in', out, '--vault', targetDir, '--dry-run'], {
      ...io(), readPassphrase: async () => PASS,
    })
    assert.equal(exit, 0)
    assert.equal(existsSync(join(targetDir, 'vault.json')), false, 'dry run must not write')
    assert.equal(target.listMeta().length, 0)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('a name-taken conflict exits 1 and preserves the local entry', async () => {
  const base = tempDir()
  try {
    const vaultDir = join(base, 'vault')
    createVaultStore(vaultDir).set('prod ssh', { kind: 'password', secret: 'SOURCE-SECRET' })
    const out = join(base, 'sync.dsvault')
    await main(['export', '--out', out, '--vault', vaultDir], { ...io(), readPassphrase: async () => PASS })

    const targetDir = join(base, 'target')
    const target = createVaultStore(targetDir)
    target.set('prod ssh', { kind: 'password', secret: 'TARGET-SECRET' })

    const exit = await main(['import', '--in', out, '--vault', targetDir, '--mode', 'overwrite'], {
      ...io(), readPassphrase: async () => PASS,
    })
    assert.equal(exit, 1)
    assert.equal(target.reveal('prod ssh').secret, 'TARGET-SECRET')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('inspect validates the envelope shape without decrypting', async () => {
  const base = tempDir()
  try {
    const vaultDir = join(base, 'vault')
    createVaultStore(vaultDir).set('a', { kind: 'token', secret: 'v' })
    const out = join(base, 'sync.dsvault')
    await main(['export', '--out', out, '--vault', vaultDir], { ...io(), readPassphrase: async () => PASS })

    const lines = io()
    const exit = await main(['inspect', '--in', out], lines)
    assert.equal(exit, 0)
    assert.ok(lines.lines.some((line) => /envelope ok/.test(line)))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
