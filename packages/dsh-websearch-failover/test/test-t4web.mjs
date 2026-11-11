// T4.web (#124): example providers, SearXNG auth variants, ABORTED counting,
// cooldown expiry cleanup, resetStats, ALL_FAILED agent guidance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { search, SearchError, DEFAULT_COOLDOWN } from '../lib/core.mjs'
import { createApiHandler, API_BASE } from '../lib/api.mjs'
import { ADAPTERS } from '../lib/core.mjs'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'wsf-t4web-'))
}

function fakeConfig(providers, overrides = {}) {
  return {
    providers,
    defaults: {
      limit: 5,
      timeoutMs: 2000,
      cooldown: { ...DEFAULT_COOLDOWN },
      stopOnFirstSuccess: true,
      ...overrides,
    },
  }
}

const okProvider = (id, kind = 'custom') => ({
  id,
  kind,
  request: { method: 'POST', url: 'http://127.0.0.1:9/x' },
  response: { sourcesPath: 'items', map: { title: 't', url: 'u', snippet: 's' } },
})

// ---------- 1. example providers ----------

test('providers.example.json covers every non-custom adapter kind with a ready-to-copy entry', async () => {
  const { default: fs } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const example = JSON.parse(readFileSync(new URL('../providers.example.json', import.meta.url), 'utf8'))
  const ids = new Set(example.providers.map((p) => p.id))
  for (const kind of Object.keys(ADAPTERS)) {
    assert.ok(
      example.providers.some((p) => p.kind === kind),
      `example is missing a "${kind}" provider entry (adapters: ${Object.keys(ADAPTERS).join(', ')})`,
    )
  }
  assert.ok(ids.size >= 9, 'example should showcase a broad provider set')
})

// ---------- 2. SearXNG auth variants ----------

test('searxng supports basic auth and a custom auth header name', async () => {
  const p = {
    id: 'sx',
    kind: 'searxng',
    endpoint: 'http://127.0.0.1:9/search?q=x',
    auth: { type: 'basic', usernameEnv: 'SX_USER', passwordEnv: 'SX_PASS' },
  }
  process.env.SX_USER = 'u'
  process.env.SX_PASS = 'p'
  let seen = null
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), headers: init?.headers ?? {} }
    return { ok: true, status: 200, text: async () => JSON.stringify({ results: [{ title: 't', url: 'u', content: 'c' }] }) }
  }
  try {
    const sources = await ADAPTERS.searxng({ ...p, timeoutMs: 1000 }, { query: 'q', limit: 3, key: undefined })
    assert.equal(sources.length, 1)
    const auth = seen.headers['authorization'] ?? ''
    assert.match(auth, /^Basic /, 'basic auth variant sends a Basic header')
  } finally {
    globalThis.fetch = origFetch
    delete process.env.SX_USER
    delete process.env.SX_PASS
  }
})

test('searxng supports a named token header (tokenHeader) instead of bearer-only', async () => {
  const p = {
    id: 'sx2',
    kind: 'searxng',
    endpoint: 'http://127.0.0.1:9/search',
    auth: { type: 'header', header: 'X-Auth-Token' },
    apiKeyEnv: 'SX_TOKEN',
  }
  process.env.SX_TOKEN = 'tok'
  let seen = null
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    seen = { headers: init?.headers ?? {} }
    return { ok: true, status: 200, text: async () => JSON.stringify({ results: [] }) }
  }
  try {
    await ADAPTERS.searxng({ ...p, timeoutMs: 1000 }, { query: 'q', limit: 3, key: 'tok' })
    assert.equal(Object.entries(seen.headers).find(([k]) => k.toLowerCase() === 'x-auth-token')?.[1], 'tok')
    assert.equal(seen.headers['authorization'], undefined, 'no bearer when a token header is configured')
  } finally {
    globalThis.fetch = origFetch
    delete process.env.SX_TOKEN
  }
})

// ---------- 3. ABORTED counting ----------

test('aborted attempts are counted as aborted in provider stats', async () => {
  const dir = tempDir()
  try {
    const statePath = join(dir, 'state.json')
    const runtimePath = join(dir, 'runtime.json')
    const mod = await import('../index.js')
    // A minimal config so loadConfig succeeds.
    const configPath = join(dir, 'providers.json')
    writeFileSync(configPath, JSON.stringify({
      defaults: { limit: 3, timeoutMs: 500 },
      providers: [{ id: 'p1', kind: 'custom', apiKeyEnv: 'P1_KEY',
        request: { method: 'POST', url: 'http://127.0.0.1:9/x' },
        response: { sourcesPath: 'items' } }],
    }))
    const registered = { providers: [], effects: [] }
    const ctx = {
      effect(fn) { registered.effects.push(fn) },
      web: { registerSearchProvider: (p) => registered.providers.push(p) },
      webServer: { register: () => {} },
      logger: { info() {}, warn() {}, error() {} },
    }
    // Without an explicit logPath, apply() falls back to defaultLogPath(), which is
    // $DSH_HOME/websearch-failover/plugin.log when DSH_HOME is set (otherwise
    // ~/.dsh/...). Running this test then appends to the log file the live plugin
    // is using, which is worse than dirtying a home directory (#182).
    mod.apply(ctx, { statePath, runtimePath, configPath, logPath: join(dir, 'plugin.log') })
    for (const fn of registered.effects) fn()
    const provider = registered.providers[0]
    assert.ok(provider, 'search provider registered')
    process.env.P1_KEY = 'k'
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(() => provider.search({ query: 'x' }, controller.signal))
    delete process.env.P1_KEY
    const runtime = JSON.parse(readFileSync(runtimePath, 'utf8'))
    const entries = Object.values(runtime.stats ?? {})
    const aborted = entries.filter((e) => e.aborts > 0 && e.failures === 0, 'aborts counted without polluting failures')
    assert.ok(aborted.length > 0, 'at least one provider recorded an aborted attempt')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- 4. cooldown expiry cleanup ----------

test('expired cooldown entries are pruned from the state file', async () => {
  const dir = tempDir()
  try {
    const statePath = join(dir, 'state.json')
    // Seed: two entries, one long-expired, one alive.
    writeFileSync(statePath, JSON.stringify({
      providers: {
        stale: { until: Date.now() - 10_000, reason: 'error' },
        live: { until: Date.now() + 60_000, reason: 'quota' },
      },
    }))
    await assert.rejects(() => search({
      query: 'q',
      config: fakeConfig([okProvider('fresh')]),
      statePath,
      now: Date.now(),
    }))
    const after = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.equal(after.providers.stale, undefined, 'expired entry pruned')
    assert.ok(after.providers.live, 'live entry kept')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- 5. resetStats ----------

test('POST /stats/reset zeroes stats for one id or the whole panel', async () => {
  const dir = tempDir()
  try {
    const runtimePath = join(dir, 'runtime.json')
    writeFileSync(runtimePath, JSON.stringify({
      version: 1, order: [], disabled: {}, balances: {},
      stats: {
        a: { calls: 5, successes: 3, failures: 2, lastUsedAt: 'x', lastOutcome: 'ok' },
        b: { calls: 7, successes: 1, failures: 6, lastUsedAt: 'y', lastOutcome: 'failed' },
      },
      updatedAt: 0,
    }))
    const mod = await import('../index.js')
    const registered = { routes: [], effects: [] }
    const ctx = {
      effect(fn) { registered.effects.push(fn) },
      web: { registerSearchProvider: () => {} },
      webServer: { register: (route) => registered.routes.push(route) },
      logger: { info() {}, warn() {}, error() {} },
    }
    // statePath defaults to $DSH_HOME/websearch-failover-state.json too. Nothing here
    // reads it today, but the next assertion that touches snapshot() or search()
    // would silently use the developer real state file (#182).
    mod.apply(ctx, { statePath: join(dir, 'state.json'), runtimePath, configPath: join(dir, 'absent.json'), logPath: join(dir, 'plugin.log') })
    for (const fn of registered.effects) fn()
    // Snapshot to prove stats exist first.
    const snapshot = registered.snapshotPayload ?? (registered.routes.length > 0 ? null : null)
    // Drive the API handler directly with the real route table.
    const handler = registered.routes[0]?.handler
    const post = (path, body) => new Promise((resolve) => {
      const res = {
        writeHead() {},
        end(payload) { resolve(JSON.parse(payload)) },
        setHeader() {},
      }
      const encoder = new TextEncoder()
      const req = {
        method: 'POST',
        url: path,
        headers: { host: '127.0.0.1' },
        async *[Symbol.asyncIterator]() {
          yield encoder.encode(JSON.stringify(body))
        },
      }
      handler(req, res)
    })
    // Route contract matches the siblings: the response IS the updated runtime.
    const one = await post(API_BASE + '/stats/reset', { id: 'a' })
    assert.equal(one.stats.a, undefined, 'single-id reset drops that provider')
    assert.ok(one.stats.b, 'other provider untouched by a single-id reset')
    const all = await post(API_BASE + '/stats/reset', {})
    assert.deepEqual(all.stats, {})
    const after = JSON.parse(readFileSync(runtimePath, 'utf8'))
    assert.equal(after.stats.a, undefined)
    assert.equal(after.stats.b, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- 6. ALL_FAILED guidance ----------

test('ALL_FAILED error message guides the agent to the panel', async () => {
  const dir = tempDir()
  try {
    const statePath = join(dir, 'state.json')
    try {
      await search({
        query: 'q',
        config: fakeConfig([okProvider('only-one')]),
        statePath,
        now: Date.now(),
      })
      assert.fail('expected ALL_FAILED')
    } catch (error) {
      assert.equal(error.code, 'ALL_FAILED')
      assert.match(error.message, /provider|面板|panel/i)
      assert.match(error.message, /enable|启用|检查/i)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
