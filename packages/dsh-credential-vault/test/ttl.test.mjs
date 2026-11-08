// T4.vault (#122): credential-level TTL metadata, reveal-audit retention,
// export audit attribution, and the hint's envVar/re-use guidance.
//
// Red-first: each test pins behaviour that did not exist before this ticket.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../index.js'
import { createVaultStore } from '../lib/vault-store.js'
import { createGrantTable } from '../lib/env-injection.js'
import { appendAudit, trimAudit, readAudit, AUDIT_FILE, AUDIT_MAX_LINES } from '../lib/audit.js'
import { buildHintText } from '../lib/hint.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-ttl-test-'))
}

function fakeContext() {
  const registered = { tools: [], sections: [], routes: [], contributors: [], disposed: 0 }
  const ctx = {
    registered,
    systemPrompt: { section: (s) => registered.sections.push(s) },
    effect(fn) { fn() },
    on() { return () => {} },
    tools: { register: (tool) => registered.tools.push(tool) },
    webServer: { register: () => {} },
  }
  const shellEnv = {
    register(contributor) {
      registered.contributors.push(contributor)
      return () => {
        const i = registered.contributors.indexOf(contributor)
        if (i >= 0) registered.contributors.splice(i, 1)
      }
    },
  }
  // Mirror cordis: ctx.inject(['shellEnv'], cb) delivers the service or skips.
  ctx.inject = (names, cb) => {
    if (Array.isArray(names) && names.includes('shellEnv') && shellEnv) {
      ctx.effect(() => cb({ shellEnv }))
    }
    return () => {}
  }
  return ctx
}

// ---------- 1. credential-level TTL metadata ----------

test('store persists an optional ttlSeconds on set and exposes it in metadata', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('db prod', { kind: 'database', secret: 's3cret', ttlSeconds: 300 })
    const meta = store.listMeta().find((e) => e.name === 'db prod')
    assert.equal(meta.ttlSeconds, 300)
    assert.equal(store.get('db prod').ttlSeconds, 300)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('store rejects a ttlSeconds that is not a positive integer or null', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    for (const bad of [0, -5, 1.5, '300', true]) {
      assert.throws(() => store.set('x ' + String(bad), { kind: 'token', secret: 'v', ttlSeconds: bad }), /ttlSeconds/)
    }
    store.set('ok one', { kind: 'token', secret: 'v', ttlSeconds: 60 })
    assert.equal(store.get('ok one').ttlSeconds, 60)
    // null clears back to "no TTL".
    store.update('ok one', { ttlSeconds: null })
    assert.equal(store.get('ok one').ttlSeconds, null)
    store.update('ok one', { ttlSeconds: 120 })
    assert.equal(store.get('ok one').ttlSeconds, 120)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('update leaves ttlSeconds untouched when not supplied', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('k', { kind: 'token', secret: 'v', ttlSeconds: 45 })
    store.update('k', { note: 'hello' })
    assert.equal(store.get('k').ttlSeconds, 45)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('use caps the grant at the credential ttlSeconds and reports the cap', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    createVaultStore(dir).set('short lived', { kind: 'token', secret: 'v', ttlSeconds: 60 })

    const tool = ctx.registered.tools[0]
    const result = await tool.execute({ action: 'use', name: 'short lived' }, { agent: { session: { header: { id: 's1' } } } })
    assert.equal(result.ttlSeconds, 60)
    const ttl = new Date(result.expiresAt).getTime() - Date.now()
    assert.ok(ttl <= 61_000 && ttl > 50_000, 'grant should expire in about 60s, got ' + ttl)
    assert.match(result.note, /action:"use"/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('use without a ttlSeconds keeps the default grant window and reports ttlSeconds null', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    createVaultStore(dir).set('plain', { kind: 'token', secret: 'v' })
    const tool = ctx.registered.tools[0]
    const result = await tool.execute({ action: 'use', name: 'plain' }, { agent: { session: { header: { id: 's1' } } } })
    assert.equal(result.ttlSeconds, null)
    const ttl = new Date(result.expiresAt).getTime() - Date.now()
    assert.ok(ttl > 9 * 60_000, 'default grant window intact, got ' + ttl)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the API set and update routes forward ttlSeconds', async () => {
  const dir = tempDir()
  try {
    const { createApiHandler, API_BASE } = await import('../lib/api.mjs')
    const store = createVaultStore(dir)
    const handler = createApiHandler({ store, dir })
    const encoder = new TextEncoder()
    const makeReq = (body) => ({
      method: 'POST',
      url: API_BASE + '/set',
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
      async *[Symbol.asyncIterator]() {
        yield encoder.encode(JSON.stringify(body))
      },
    })
    const makeRes = () => {
      const res = { statusCode: 0, body: '' }
      res.writeHead = (status) => { res.statusCode = status }
      res.end = (text) => { res.body += text }
      return res
    }
    const post = async (body) => {
      const res = makeRes()
      await handler(makeReq(body), res)
      return { status: res.statusCode, json: JSON.parse(res.body || '{}') }
    }
    const made = await post({ name: 'api ttl', kind: 'token', secret: 'v', ttlSeconds: 90 })
    assert.equal(made.status, 200)
    assert.equal(store.get('api ttl').ttlSeconds, 90)
    const cleared = await post({ name: 'api ttl', kind: 'token', secret: '', ttlSeconds: null })
    assert.equal(cleared.status, 200)
    assert.equal(store.get('api ttl').ttlSeconds, null)
    const bad = await post({ name: 'api ttl', kind: 'token', secret: '', ttlSeconds: -1 })
    assert.equal(bad.status, 400)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- 2. reveal audit survives trimming ----------

test('trimAudit keeps every reveal record even when the log overflows', () => {
  const dir = tempDir()
  try {
    // Pre-seed a log: one reveal near the top, then overflow with ordinary reads.
    appendAudit(dir, { name: 'seeded', outcome: 'ok', source: 'tool', action: 'reveal' })
    for (let i = 0; i < AUDIT_MAX_LINES + 50; i += 1) {
      appendAudit(dir, { name: 'reader ' + i, outcome: 'ok', source: 'tool', action: 'use' })
    }
    trimAudit(dir)
    const kept = readAudit(dir, AUDIT_MAX_LINES + 10)
    const reveals = kept.filter((r) => r.action === 'reveal')
    assert.equal(reveals.length, 1, 'the single reveal must survive the trim')
    assert.equal(reveals[0].name, 'seeded')
    assert.ok(kept.length <= AUDIT_MAX_LINES, 'trim still bounds total size')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- 3. export audit attribution ----------

test('export audit carries the envelope filename and byte size', async () => {
  const dir = tempDir()
  try {
    const { createApiHandler, API_BASE } = await import('../lib/api.mjs')
    const store = createVaultStore(dir)
    store.set('e1', { kind: 'token', secret: 'v' })
    const handler = createApiHandler({ store, dir })
    const encoder = new TextEncoder()
    const res = { statusCode: 0, body: '' }
    res.writeHead = (status) => { res.statusCode = status }
    res.end = (text) => { res.body += text }
    await handler({
      method: 'POST',
      url: API_BASE + '/export',
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
      async *[Symbol.asyncIterator]() {
        yield encoder.encode(JSON.stringify({ passphrase: 'passphrase-123456' }))
      },
    }, res)
    const audit = readAudit(dir, 5).find((r) => r.action === 'export' && r.outcome === 'ok')
    assert.ok(audit, 'export audited')
    assert.equal(typeof audit.bytes, 'number')
    assert.ok(audit.bytes > 0)
    assert.match(audit.filename, /\.dsvault$/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- 4. hint: envVar derivation + re-use guidance ----------

test('hint explains that the envVar comes from the use result and grants need re-use', () => {
  const text = buildHintText([{ name: 'github token', kind: 'token', service: 'github', aliases: ['gh'] }])
  assert.match(text, /envVar field/i)
  assert.match(text, /re-?run|call .*use.*again|again/i)
  assert.match(text, /hash/i)
})
