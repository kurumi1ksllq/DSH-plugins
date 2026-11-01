// Tests for lib/audit.js — append, read, trim.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { appendAudit, readAudit, trimAudit, AUDIT_MAX_LINES } from '../lib/audit.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-audit-test-'))
}

test('appendAudit writes JSON lines without secret material', () => {
  const dir = tempDir()
  try {
    appendAudit(dir, { name: 'github-token', outcome: 'ok', source: 'tool' })
    const records = readAudit(dir)
    assert.equal(records.length, 1)
    assert.equal(records[0].name, 'github-token')
    assert.equal(records[0].outcome, 'ok')
    assert.ok(records[0].at)
    const raw = readFileSync(join(dir, 'audit.log'), 'utf8')
    assert.equal(raw.includes('secret'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readAudit is newest-first and capped', () => {
  const dir = tempDir()
  try {
    for (let i = 0; i < 5; i += 1) {
      appendAudit(dir, { name: `n${i}`, outcome: 'ok', source: 'tool' })
      // Ensure distinct timestamps would not be needed: order is append order.
    }
    const records = readAudit(dir, 3)
    assert.equal(records.length, 3)
    assert.equal(records[0].name, 'n4')
    assert.equal(records[2].name, 'n2')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readAudit on a missing file is empty; corrupt lines become records', async () => {
  const dir = tempDir()
  try {
    assert.deepEqual(readAudit(dir), [])
    appendAudit(dir, { name: 'x', outcome: 'ok', source: 'tool' })
    const { appendFileSync } = await import('node:fs')
    appendFileSync(join(dir, 'audit.log'), 'not-json\n', 'utf8')
    const records = readAudit(dir)
    assert.equal(records.length, 2)
    assert.equal(records[0].outcome, 'corrupt')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('trimAudit keeps only the newest AUDIT_MAX_LINES lines', () => {
  const dir = tempDir()
  try {
    for (let i = 0; i < AUDIT_MAX_LINES + 50; i += 1) {
      appendAudit(dir, { name: `n${i}`, outcome: 'ok', source: 'tool' })
    }
    trimAudit(dir)
    const records = readAudit(dir, AUDIT_MAX_LINES + 10)
    assert.equal(records.length, AUDIT_MAX_LINES)
    assert.equal(records[0].name, `n${AUDIT_MAX_LINES + 49}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('trimAudit is a no-op on a missing file', () => {
  const dir = tempDir()
  try {
    trimAudit(dir)
    assert.equal(existsSync(join(dir, 'audit.log')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
