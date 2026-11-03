// Tests for scripts/scrub-session-secrets.mjs (issue #36, T7 + review round).
//
// The script exists because credential plaintext already reached session logs and
// spill files. The contract that matters: dry run by default, backups OUTSIDE the
// scanned roots, a stale `session.lock` does not freeze a directory forever, short
// secrets are not blanket-replaced, and a failed rewrite is an error — not a
// silent success.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { MIN_SECRET_LENGTH, REDACTION, main, scrubText, scan } from '../scripts/scrub-session-secrets.mjs'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'scrub-test-'))
}

const SECRETS = [{ name: 'github token', value: 'ghp_supersecretvalue' }]

test('scrubText replaces every occurrence and reports counts per credential', () => {
  const text = 'a ghp_supersecretvalue b ghp_supersecretvalue c'
  const { text: scrubbed, hits } = scrubText(text, SECRETS)
  assert.equal(scrubbed.includes('ghp_supersecretvalue'), false)
  assert.equal(scrubbed.split(REDACTION).length - 1, 2)
  assert.deepEqual(hits, [{ name: 'github token', count: 2 }])
})

test('scrubText leaves clean text byte-identical and reports no hits', () => {
  const text = 'nothing to see here'
  const { text: scrubbed, hits } = scrubText(text, SECRETS)
  assert.equal(scrubbed, text)
  assert.deepEqual(hits, [])
})

test('a dry run reports hits but changes nothing', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'session.jsonl')
    writeFileSync(file, 'log line ghp_supersecretvalue\n')
    const report = scan({ roots: [dir], secrets: SECRETS, apply: false })
    assert.equal(report.hitFiles.length, 1)
    assert.equal(report.redactions, 1)
    assert.equal(readFileSync(file, 'utf8').includes('ghp_supersecretvalue'), true)
    assert.deepEqual(readdirSync(dir), ['session.jsonl'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('apply leaves no plaintext inside the scanned root and backs up outside it', () => {
  const base = tempDir()
  try {
    const root = join(base, 'sessions')
    mkdirSync(root)
    const backupDir = join(base, 'backups')
    const file = join(root, 'session.jsonl')
    writeFileSync(file, 'log line ghp_supersecretvalue\n')

    const report = scan({ roots: [root], secrets: SECRETS, apply: true, backupDir, timestamp: 'STAMP' })
    assert.equal(report.hitFiles.length, 1)

    const rewritten = readFileSync(file, 'utf8')
    assert.equal(rewritten.includes('ghp_supersecretvalue'), false)
    assert.match(rewritten, /REDACTED/)

    // Nothing under the scanned root may still hold the value — including .bak files.
    assert.deepEqual(readdirSync(root), ['session.jsonl'])
    assert.equal(report.backups.length, 1)
    assert.ok(report.backups[0].startsWith(backupDir), 'the backup must live outside the scanned root')
    assert.equal(readFileSync(report.backups[0], 'utf8').includes('ghp_supersecretvalue'), true)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('--no-backup keeps no plaintext copy at all', () => {
  const base = tempDir()
  try {
    const root = join(base, 'sessions')
    mkdirSync(root)
    const file = join(root, 'session.jsonl')
    writeFileSync(file, 'x ghp_supersecretvalue y\n')
    const report = scan({ roots: [root], secrets: SECRETS, apply: true, backupDir: null })
    assert.deepEqual(report.backups, [])
    assert.equal(readFileSync(file, 'utf8').includes('ghp_supersecretvalue'), false)
    assert.deepEqual(readdirSync(base), ['sessions'])
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('a stale session.lock does not protect the directory forever', () => {
  const dir = tempDir()
  try {
    const sessionDir = join(dir, 'finished-session')
    mkdirSync(sessionDir)
    const file = join(sessionDir, 'session.v4.jsonl')
    writeFileSync(file, 'x ghp_supersecretvalue y\n')
    const lock = join(sessionDir, 'session.lock')
    writeFileSync(lock, '')
    const old = new Date('2026-01-01T00:00:00Z')
    utimesSync(lock, old, old)

    const report = scan({ roots: [dir], secrets: SECRETS, apply: true, backupDir: null })
    assert.equal(report.hitFiles.length, 1)
    assert.equal(readFileSync(file, 'utf8').includes('ghp_supersecretvalue'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a live (freshly touched) session.lock is skipped', () => {
  const dir = tempDir()
  try {
    const sessionDir = join(dir, 'running-session')
    mkdirSync(sessionDir)
    const file = join(sessionDir, 'session.v4.jsonl')
    writeFileSync(file, 'x ghp_supersecretvalue y\n')
    writeFileSync(join(sessionDir, 'session.lock'), '')

    const report = scan({ roots: [dir], secrets: SECRETS, apply: true, backupDir: null })
    assert.equal(readFileSync(file, 'utf8').includes('ghp_supersecretvalue'), true)
    assert.ok(report.skipped.some((item) => /live session/.test(item.reason)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a too-short secret is reported instead of being replaced everywhere', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'notes.txt')
    writeFileSync(file, 'the password is pw and pw is short\n')
    const report = scan({ roots: [dir], secrets: [{ name: 'short pw', value: 'pw' }], apply: true, backupDir: null })
    assert.equal(report.hitFiles.length, 0)
    assert.deepEqual(report.tooShort, [{ name: 'short pw', length: 2 }])
    assert.equal(readFileSync(file, 'utf8'), 'the password is pw and pw is short\n')
    assert.ok(MIN_SECRET_LENGTH >= 8)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a binary file is skipped rather than rewritten as text', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'blob.bin')
    writeFileSync(file, Buffer.from([0x00, 0x01, 0x67, 0x68, 0x70, 0x00]))
    const report = scan({ roots: [dir], secrets: SECRETS, apply: true, backupDir: null })
    assert.ok(report.skipped.some((item) => /binary/.test(item.reason)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed rewrite is reported, not swallowed', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'session.jsonl')
    writeFileSync(file, 'x ghp_supersecretvalue y\n')
    const report = scan({
      roots: [dir],
      secrets: SECRETS,
      apply: true,
      backupDir: null,
      write: () => false,
    })
    assert.ok(report.skipped.some((item) => /rewrite failed/.test(item.reason)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('compressed logs are skipped when zstd is unavailable rather than ignored', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'session.v4.jsonl.zstd')
    writeFileSync(file, 'not really compressed ghp_supersecretvalue')
    const report = scan({ roots: [dir], secrets: SECRETS, apply: true, zstdAvailable: false })
    assert.equal(report.hitFiles.length, 0)
    assert.equal(report.skipped.length, 1)
    assert.match(report.skipped[0].reason, /zstd/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a rotated secret that no longer matches is left alone', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'old.jsonl')
    writeFileSync(file, 'old value ghp_rotatedaway\n')
    const report = scan({ roots: [dir], secrets: SECRETS, apply: true, backupDir: null })
    assert.equal(report.hitFiles.length, 0)
    assert.equal(readFileSync(file, 'utf8'), 'old value ghp_rotatedaway\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the CLI rejects a flag without a value and reports hit/clean exit codes', () => {
  const base = tempDir()
  try {
    const vaultDir = join(base, 'vault')
    mkdirSync(vaultDir)
    const lines = []
    const io = { log: (line) => lines.push(line), error: (line) => lines.push(`ERR ${line}`) }

    assert.equal(main(['--vault'], io), 2)
    assert.ok(lines.some((line) => /needs a value/.test(line)))

    // No master.key/vault.json → nothing to look for, exit 0.
    assert.equal(main(['--vault', vaultDir, '--roots', join(base, 'missing')], io), 0)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
