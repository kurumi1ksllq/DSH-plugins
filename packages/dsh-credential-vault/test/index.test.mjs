// Tests for the host half: the `credential` tool contract (list/get/reveal +
// audit) with a fake Cordis context, mirroring how the goal tool registers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, TOOL_NAME, API_BASE } from '../index.js'
import { createVaultStore } from '../lib/vault-store.js'
import { readAudit } from '../lib/audit.js'

function fakeContext() {
  const registered = { tools: [], sections: [], routes: [] }
  return {
    registered,
    systemPrompt: {
      section(section) {
        registered.sections.push(section)
      },
    },
    effect(fn) {
      fn()
    },
    tools: {
      register(tool) {
        registered.tools.push(tool)
      },
    },
    webServer: {
      register(route) {
        registered.routes.push(route)
      },
    },
  }
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-index-test-'))
}

test('apply registers the tool, the hint section and the API route', () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    assert.equal(ctx.registered.tools.length, 1)
    assert.equal(ctx.registered.tools[0].name, TOOL_NAME)
    assert.ok(ctx.registered.sections.some((section) => section.name === 'dsh-credential-vault:hint'))
    const route = ctx.registered.routes[0]
    assert.equal(route.path, API_BASE)
    assert.equal(route.kind, 'prefix')
    assert.equal(typeof route.handler, 'function')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('list action returns names and kinds but never secrets', () => {
  const dir = tempDir()
  try {
    createVaultStore(dir).set('github-token', { kind: 'token', secret: 'ghp_supersecret' })
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const tool = ctx.registered.tools[0]
    const result = tool.execute({ action: 'list' })
    assert.equal(result.count, 1)
    assert.equal(result.entries[0].name, 'github-token')
    assert.equal(result.entries[0].kind, 'token')
    assert.equal(JSON.stringify(result).includes('ghp_supersecret'), false)
    assert.match(result.note, /reveal/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('get returns masked metadata and audits ok', () => {
  const dir = tempDir()
  try {
    createVaultStore(dir).set('prod-server', { kind: 'password', secret: 'hunter2', username: 'root' })
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const tool = ctx.registered.tools[0]
    const result = tool.execute({ action: 'get', name: 'prod-server' })
    assert.equal(result.action, 'get')
    assert.equal(result.username, 'root')
    assert.equal(JSON.stringify(result).includes('hunter2'), false)
    const audit = readAudit(dir)
    assert.equal(audit[0].name, 'prod-server')
    assert.equal(audit[0].outcome, 'ok')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reveal returns the plaintext and audits it', () => {
  const dir = tempDir()
  try {
    createVaultStore(dir).set('github-token', { kind: 'token', secret: 'ghp_supersecret' })
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const tool = ctx.registered.tools[0]
    const result = tool.execute({ action: 'reveal', name: 'github-token' })
    assert.equal(result.secret, 'ghp_supersecret')
    const audit = readAudit(dir)
    assert.equal(audit[0].outcome, 'ok')
    assert.equal(JSON.stringify(audit).includes('ghp_supersecret'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unknown name throws and audits missing; bad action and bad name rejected', () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const tool = ctx.registered.tools[0]
    assert.throws(() => tool.execute({ action: 'reveal', name: 'ghost' }), /no credential named/)
    assert.throws(() => tool.execute({ action: 'get', name: 'a/b' }), /name.*required/)
    assert.throws(() => tool.execute({ action: 'explode' }), /action must be/)
    assert.throws(() => tool.execute({}), /action must be/)
    const outcomes = readAudit(dir).map((record) => record.outcome)
    assert.ok(outcomes.includes('rejected'))
    assert.ok(outcomes.includes('missing'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
