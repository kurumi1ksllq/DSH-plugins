// Tests for the dynamic system-prompt section (issue #36, T3).
//
// The section must be re-evaluated on every assembly (so the index follows the
// vault), must carry only names and metadata, and must state the rules that stop
// the model from asking the user for a password that is already stored.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../index.js'
import { HINT_SECTION_NAME, buildHintText } from '../lib/hint.js'
import { createVaultStore } from '../lib/vault-store.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-hint-test-'))
}

function fakeContext() {
  const registered = { tools: [], sections: [], routes: [] }
  return {
    registered,
    systemPrompt: { section: (section) => registered.sections.push(section) },
    effect(fn) { fn() },
    tools: { register: (tool) => registered.tools.push(tool) },
    webServer: { register: () => {} },
  }
}

function entry(name, overrides = {}) {
  return {
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    kind: 'token',
    service: null,
    aliases: [],
    username: null,
    url: null,
    note: null,
    ...overrides,
  }
}

test('an empty vault says so instead of listing nothing', () => {
  const text = buildHintText([])
  assert.match(text, /empty|no credentials/i)
})

test('the index lists every credential with its metadata', () => {
  const text = buildHintText([
    entry('github token', { service: 'github', aliases: ['gh', 'git'] }),
    entry('prod mysql root', { kind: 'database', service: 'mysql' }),
  ])
  assert.match(text, /github token/)
  assert.match(text, /github/)
  assert.match(text, /gh/)
  assert.match(text, /prod mysql root/)
  assert.match(text, /database/)
  assert.match(text, /mysql/)
})

test('the section never contains a secret value or preview', () => {
  const text = buildHintText([{ ...entry('github token'), preview: 'gho_…Xx', hasSecret: true }])
  assert.equal(text.includes('gho_…Xx'), false)
  assert.equal(text.includes('preview'), false)
})

test('the index is capped and points at search when truncated', () => {
  const many = Array.from({ length: 60 }, (_, index) => entry(`credential-${index}`))
  const text = buildHintText(many)
  assert.ok(text.length < 8000)
  assert.match(text, /search/)
  assert.equal(text.includes('credential-59'), false)
})

test('the rules forbid asking the user before checking the vault', () => {
  const text = buildHintText([entry('github token')])
  assert.match(text, /before (asking|ask)/i)
  assert.match(text, /list|search/)
})

test('the rules route secrets through the environment variable path', () => {
  const text = buildHintText([entry('github token')])
  assert.match(text, /DSH_CRED_/)
  assert.match(text, /"use"/)
})

test('the rules forbid echoing and file writes', () => {
  const text = buildHintText([entry('github token')])
  assert.match(text, /never (echo|print)/i)
  assert.match(text, /file/i)
})

test('reveal is described as an explicit escape hatch only', () => {
  const text = buildHintText([entry('github token')])
  assert.match(text, /reveal/)
  assert.match(text, /audit/i)
})

test('the registered section re-evaluates, so new credentials appear', () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const section = ctx.registered.sections.find((item) => item.name === HINT_SECTION_NAME)
    assert.ok(section)
    assert.equal(typeof section.text, 'function', 'the section text must be a function')

    const before = section.text()
    assert.equal(before.includes('late arrival'), false)

    createVaultStore(dir).set('late arrival', { kind: 'token', secret: 'v', service: 'github' })

    const after = section.text()
    assert.match(after, /late arrival/)
    assert.notEqual(before, after)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
