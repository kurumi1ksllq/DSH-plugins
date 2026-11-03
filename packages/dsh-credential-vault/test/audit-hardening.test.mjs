// Tests for the hardened audit log (issue #36, T5).
//
// The log must answer three questions the panel could not answer before:
// which session read what, by which matching rule, and whether the caller used
// the safe `use` path or the plaintext `reveal` escape hatch. It still never
// records a value, and the file is private to the owner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { appendAudit, readAudit } from '../lib/audit.js'
import { apply } from '../index.js'
import { createVaultStore } from '../lib/vault-store.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-audit2-test-'))
}

function fakeContext() {
  const registered = { tools: [], sections: [], routes: [], contributors: [] }
  return {
    registered,
    systemPrompt: { section: (section) => registered.sections.push(section) },
    effect(fn) { fn() },
    tools: { register: (tool) => registered.tools.push(tool) },
    webServer: { register: () => {} },
    shellEnv: {
      register(contributor) {
        registered.contributors.push(contributor)
        return () => {}
      },
    },
  }
}

const EXEC = { agent: { session: { header: { id: 'session-42' } } } }

test('the audit file is private to its owner', () => {
  const dir = tempDir()
  try {
    appendAudit(dir, { name: 'github-token', outcome: 'ok', source: 'tool' })
    const mode = statSync(join(dir, 'audit.log')).mode & 0o777
    assert.equal(mode, 0o600)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a record carries the session, the rule and the action when supplied', () => {
  const dir = tempDir()
  try {
    appendAudit(dir, {
      name: 'github token',
      outcome: 'ok',
      source: 'tool',
      action: 'use',
      sessionId: 'session-42',
      resolvedBy: 'alias',
    })
    const record = readAudit(dir)[0]
    assert.equal(record.action, 'use')
    assert.equal(record.sessionId, 'session-42')
    assert.equal(record.resolvedBy, 'alias')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('omitted optional fields stay absent instead of becoming junk', () => {
  const dir = tempDir()
  try {
    appendAudit(dir, { name: 'x', outcome: 'ok', source: 'tool' })
    const record = readAudit(dir)[0]
    assert.equal(record.action, undefined)
    assert.equal(record.sessionId, undefined)
    assert.equal(record.resolvedBy, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a long reason is truncated and no value is ever recorded', () => {
  const dir = tempDir()
  try {
    appendAudit(dir, { name: 'x', outcome: 'rejected', source: 'tool', reason: 'y'.repeat(500) })
    const record = readAudit(dir)[0]
    assert.ok(record.reason.length <= 200)
    const raw = readFileSync(join(dir, 'audit.log'), 'utf8')
    assert.equal(raw.includes('secret'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reveal and use are distinguishable in the log, and both record the session', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    createVaultStore(dir).set('github token', { kind: 'token', secret: 'ghp_value', aliases: ['gh'] })
    const tool = ctx.registered.tools[0]

    await tool.execute({ action: 'use', name: 'gh' }, EXEC)
    await tool.execute({ action: 'reveal', name: 'gh' }, EXEC)

    const [revealRecord, useRecord] = readAudit(dir, 10)
    assert.equal(useRecord.action, 'use')
    assert.equal(useRecord.sessionId, 'session-42')
    assert.equal(useRecord.resolvedBy, 'alias')
    assert.equal(useRecord.name, 'github token')

    assert.equal(revealRecord.action, 'reveal')
    assert.equal(revealRecord.sessionId, 'session-42')
    assert.equal(revealRecord.resolvedBy, 'alias')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an ambiguous lookup is recorded as ambiguous with the candidates in the reason', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const store = createVaultStore(dir)
    store.set('github ci', { kind: 'token', secret: 'a', service: 'github' })
    store.set('github deploy', { kind: 'token', secret: 'b', service: 'github' })
    const tool = ctx.registered.tools[0]

    await assert.rejects(() => tool.execute({ action: 'get', name: 'github' }, EXEC), /matches several/)
    const record = readAudit(dir)[0]
    assert.equal(record.outcome, 'ambiguous')
    assert.match(record.reason, /github ci/)
    assert.match(record.reason, /github deploy/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
