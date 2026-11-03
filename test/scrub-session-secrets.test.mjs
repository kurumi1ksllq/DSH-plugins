// Tests for scripts/scrub-session-secrets.mjs (issue #36, T7).
//
// The script exists because credential plaintext already reached session logs and
// spill files. What matters here is the contract: dry run by default, backups
// before rewriting, never printing a value, and never touching a live session.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { REDACTION, scrubText, scan } from '../scripts/scrub-session-secrets.mjs'

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

test('apply rewrites the file and keeps a timestamped backup', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'session.jsonl')
    writeFileSync(file, 'log line ghp_supersecretvalue\n')
    const report = scan({ roots: [dir], secrets: SECRETS, apply: true, timestamp: 'STAMP' })
    assert.equal(report.hitFiles.length, 1)
    const rewritten = readFileSync(file, 'utf8')
    assert.equal(rewritten.includes('ghp_supersecretvalue'), false)
    assert.match(rewritten, /REDACTED/)
    const backup = `${file}.bak-STAMP`
    assert.ok(existsSync(backup))
    assert.equal(readFileSync(backup, 'utf8').includes('ghp_supersecretvalue'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a live session directory is skipped, even under apply', () => {
  const dir = tempDir()
  try {
    const sessionDir = join(dir, 'some-session')
    mkdirSync(sessionDir)
    const file = join(sessionDir, 'session.v4.jsonl')
    writeFileSync(file, 'x ghp_supersecretvalue y\n')
    writeFileSync(join(sessionDir, 'session.lock'), '')
    const report = scan({ roots: [dir], secrets: SECRETS, apply: true, timestamp: 'STAMP' })
    assert.equal(readFileSync(file, 'utf8').includes('ghp_supersecretvalue'), true)
    assert.ok(report.skipped.some((item) => /live session/.test(item.reason)))
    assert.equal(existsSync(`${file}.bak-STAMP`), false)
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
    const report = scan({ roots: [dir], secrets: SECRETS, apply: true, timestamp: 'STAMP' })
    assert.equal(report.hitFiles.length, 0)
    assert.equal(readFileSync(file, 'utf8'), 'old value ghp_rotatedaway\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
