// Tests for the credential name resolver and the `search` tool action
// (issue #36, T2). Only public behaviour: what a query resolves to, and what
// the tool returns for `list` / `search` / `get` without ever exposing a secret.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { matchedBy, resolveName, searchEntries } from '../lib/resolve.js'
import { apply, TOOL_NAME } from '../index.js'
import { createVaultStore } from '../lib/vault-store.js'
import { readAudit } from '../lib/audit.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-resolve-test-'))
}

function fakeContext() {
  const registered = { tools: [], sections: [], routes: [] }
  return {
    registered,
    systemPrompt: { section: (section) => registered.sections.push(section) },
    effect(fn) { fn() },
    tools: { register: (tool) => registered.tools.push(tool) },
    webServer: { register: (route) => registered.routes.push(route) },
  }
}

/** A fixed in-memory entry set shaped like `store.list()` output. */
function entries() {
  return [
    {
      name: 'github token',
      slug: 'github-token',
      kind: 'token',
      service: 'github',
      aliases: ['gh', 'git'],
      username: null,
      url: 'https://github.com',
      note: 'CI deploy token',
    },
    {
      name: 'prod mysql root',
      slug: 'prod-mysql-root',
      kind: 'database',
      service: 'mysql',
      aliases: ['db', 'prod db'],
      username: 'root',
      url: 'mysql://10.0.0.5:3306/shop',
      note: null,
    },
    {
      name: 'openai key',
      slug: 'openai-key',
      kind: 'api-key',
      service: 'openai',
      aliases: ['oa'],
      username: null,
      url: null,
      note: null,
    },
  ]
}

test('an exact name wins over every other rule', () => {
  const result = resolveName(entries(), 'github token')
  assert.equal(result.status, 'resolved')
  assert.equal(result.name, 'github token')
  assert.equal(result.resolvedBy, 'exact')
})

test('a different spelling reaches the same credential by slug', () => {
  for (const query of ['github-token', 'GitHub_Token', '  GitHub  Token ']) {
    const result = resolveName(entries(), query)
    assert.equal(result.status, 'resolved', query)
    assert.equal(result.name, 'github token', query)
    assert.equal(result.resolvedBy, 'slug', query)
  }
})

test('an alias reaches the same credential', () => {
  for (const query of ['gh', 'git']) {
    const result = resolveName(entries(), query)
    assert.equal(result.status, 'resolved', query)
    assert.equal(result.name, 'github token', query)
    assert.equal(result.resolvedBy, 'alias', query)
  }
})

test('the service name reaches its credential when it is the only one', () => {
  const result = resolveName(entries(), 'openai')
  assert.equal(result.status, 'resolved')
  assert.equal(result.name, 'openai key')
  assert.equal(result.resolvedBy, 'service')
})

test('keyword matching requires every query word to be found', () => {
  const hit = resolveName(entries(), 'mysql root')
  assert.equal(hit.status, 'resolved')
  assert.equal(hit.name, 'prod mysql root')
  assert.equal(hit.resolvedBy, 'keyword')

  const miss = resolveName(entries(), 'mysql nonexistent')
  assert.equal(miss.status, 'missing')
})

test('a service shared by two credentials is ambiguous and names both', () => {
  const shared = [
    { name: 'github ci', slug: 'github-ci', kind: 'token', service: 'github', aliases: [], url: null, note: null },
    { name: 'github deploy', slug: 'github-deploy', kind: 'token', service: 'github', aliases: [], url: null, note: null },
  ]
  const result = resolveName(shared, 'github')
  assert.equal(result.status, 'ambiguous')
  assert.deepEqual(result.candidates.map((c) => c.name).sort(), ['github ci', 'github deploy'])
})

test('an ambiguous result never picks a winner', () => {
  const shared = [
    ...entries(),
    { name: 'prod redis cache', slug: 'prod-redis-cache', kind: 'database', service: 'redis', aliases: [], url: null, note: null },
  ]
  const result = resolveName(shared, 'prod')
  assert.equal(result.status, 'ambiguous')
  assert.equal(result.name, undefined)
  assert.deepEqual(result.candidates.map((c) => c.name).sort(), ['prod mysql root', 'prod redis cache'])
})

test('a blank query and a miss both report missing', () => {
  assert.equal(resolveName(entries(), '').status, 'missing')
  assert.equal(resolveName(entries(), '   ').status, 'missing')
  assert.equal(resolveName(entries(), 'nothing here').status, 'missing')
  assert.deepEqual(resolveName(entries(), 'nothing here').candidates, [])
})

test('searchEntries returns every match, never a single winner', () => {
  const matches = searchEntries(entries(), 'github')
  assert.deepEqual(matches.map((m) => m.name).sort(), ['github token'])
  const both = searchEntries(entries(), 'token')
  assert.ok(both.some((m) => m.name === 'github token'))
})

test('the search action reports match status and never a secret', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const store = createVaultStore(dir)
    store.set('github token', { kind: 'token', secret: 'ghp_topsecret', service: 'github', aliases: ['gh'] })

    const tool = ctx.registered.tools[0]
    assert.equal(tool.name, TOOL_NAME)

    const found = await tool.execute({ action: 'search', query: 'gh' })
    assert.equal(found.action, 'search')
    assert.equal(found.status, 'resolved')
    assert.equal(found.matches.length, 1)
    assert.equal(found.matches[0].name, 'github token')
    assert.equal(found.matches[0].service, 'github')
    assert.deepEqual(found.matches[0].aliases, ['gh'])
    assert.equal(JSON.stringify(found).includes('ghp_topsecret'), false)

    const nowhere = await tool.execute({ action: 'search', query: 'zzz' })
    assert.equal(nowhere.status, 'missing')
    assert.deepEqual(nowhere.matches, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('search without a query is rejected and audited', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const tool = ctx.registered.tools[0]
    await assert.rejects(() => tool.execute({ action: 'search' }), /query/)
    const audit = readAudit(dir, 10)
    assert.equal(audit[0].outcome, 'rejected')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('get resolves a looser spelling and hides the secret', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const store = createVaultStore(dir)
    store.set('github token', { kind: 'token', secret: 'ghp_topsecret', service: 'github', aliases: ['gh'] })

    const tool = ctx.registered.tools[0]
    const got = await tool.execute({ action: 'get', name: 'gh' })
    assert.equal(got.name, 'github token')
    assert.equal(got.resolvedBy, 'alias')
    assert.equal(JSON.stringify(got).includes('ghp_topsecret'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an ambiguous name is refused with the candidate list, not guessed', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const store = createVaultStore(dir)
    store.set('github ci', { kind: 'token', secret: 'a', service: 'github' })
    store.set('github deploy', { kind: 'token', secret: 'b', service: 'github' })

    const tool = ctx.registered.tools[0]
    await assert.rejects(() => tool.execute({ action: 'get', name: 'github' }), (error) => {
      assert.match(error.message, /github ci/)
      assert.match(error.message, /github deploy/)
      return true
    })
    const audit = readAudit(dir, 10)
    assert.equal(audit[0].outcome, 'ambiguous')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('list exposes the normalized metadata for every entry', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const store = createVaultStore(dir)
    store.set('github token', { kind: 'token', secret: 'ghp_topsecret', service: 'github', aliases: ['gh'] })

    const tool = ctx.registered.tools[0]
    const listed = await tool.execute({ action: 'list' })
    assert.equal(listed.count, 1)
    const entry = listed.entries[0]
    assert.equal(entry.slug, 'github-token')
    assert.equal(entry.service, 'github')
    assert.deepEqual(entry.aliases, ['gh'])
    assert.equal(JSON.stringify(listed).includes('ghp_topsecret'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- review round: P2-1 (cross-entry rule priority must be pinned) ----

test('an alias beats a service that matches another credential', () => {
  // A is reachable by the alias `shared`; B owns the service `shared`.
  // alias (rule 3) is stronger than service (rule 4), so A must win — this is
  // the only way to catch the two rules being swapped.
  const entries = [
    { name: 'bank token', slug: 'bank-token', kind: 'token', service: 'bank', aliases: ['shared'], url: null, note: null },
    { name: 'shared service key', slug: 'shared-service-key', kind: 'api-key', service: 'shared', aliases: [], url: null, note: null },
  ]
  const result = resolveName(entries, 'shared')
  assert.equal(result.status, 'resolved')
  assert.equal(result.name, 'bank token')
  assert.equal(result.resolvedBy, 'alias')
})

test('a slug hit stops the cascade before aliases are considered', () => {
  const entries = [
    { name: 'github-token', slug: 'github-token', kind: 'token', service: null, aliases: [], url: null, note: null },
    { name: 'other thing', slug: 'other-thing', kind: 'token', service: null, aliases: ['github token'], url: null, note: null },
  ]
  const result = resolveName(entries, 'github token')
  assert.equal(result.resolvedBy, 'slug')
  assert.equal(result.name, 'github-token')
})

test('search reports the rule that produced the matches', () => {
  assert.equal(matchedBy(entries(), 'gh'), 'alias')
  assert.equal(matchedBy(entries(), 'openai'), 'service')
  assert.equal(matchedBy(entries(), 'zzz'), null)
})
