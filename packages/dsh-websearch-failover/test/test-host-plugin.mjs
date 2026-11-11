// Host plugin contract for the websearch-failover DSH bundle.
// Boots the real index.js against a stub Cordis context and a stubbed
// HTTP layer, so the search provider and the sidebar API are exercised end to end
// without touching the live DSH runtime.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeProbeBundle } from './probe-bundle.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

let pass = 0
async function ok(name, fn) {
  await fn()
  pass += 1
  console.log(`PASS ${name}`)
}

/** Generated bundle lib: index.js imports ./lib/*.mjs, so mirror the
 *  sources into a probe directory outside the checkout. Writing them into
 *  lib/ here would repair the artifact under test and hide a stale build. */
const probe = makeProbeBundle(repoRoot)

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-plugin-'))
// #182: node --test runs each file in its own process. The gate now covers
// this file, so without an exit hook it leaks one temp directory per run.
process.on('exit', () => fs.rmSync(tempRoot, { recursive: true, force: true }))
const configPath = path.join(tempRoot, 'providers.json')
const runtimePath = path.join(tempRoot, 'runtime.json')
const statePath = path.join(tempRoot, 'state.json')
const logPath = path.join(tempRoot, 'plugin.log')

fs.writeFileSync(
  configPath,
  JSON.stringify({
    defaults: { limit: 4, timeoutMs: 5000, cooldown: { quota: 60, auth: 60, error: 20 } },
    providers: [
      { id: 'tavily', kind: 'tavily', apiKey: 'k-tavily' },
      { id: 'exa', kind: 'exa', apiKey: 'k-exa' },
    ],
  }),
  'utf8',
)

/** Stub Cordis context: records the provider, the HTTP routes, and effects. */
function makeCtx() {
  const providers = []
  const routes = []
  const log = []
  const ctx = {
    web: {
      registerSearchProvider(provider) {
        providers.push(provider)
        return () => {}
      },
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    effect(fn) {
      return fn()
    },
    on() {},
    emit() {},
    logger: {
      info: (...args) => log.push(['info', ...args]),
      warn: (...args) => log.push(['warn', ...args]),
      error: (...args) => log.push(['error', ...args]),
    },
  }
  return { ctx, providers, routes, log }
}

/** Record every provider HTTP call and answer with a fixed payload per host. */
const calls = []
globalThis.fetch = async (url, init = {}) => {
  const target = String(url)
  calls.push({ url: target, init })
  if (target.includes('api.tavily.com')) {
    return new Response(JSON.stringify({ results: [{ title: 'T', url: 'https://t.example/1', content: 'tavily hit' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (target.includes('api.exa.ai')) {
    return new Response(JSON.stringify({ results: [{ title: 'E', url: 'https://e.example/1', text: 'exa hit' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return new Response(JSON.stringify({ error: 'unexpected host' }), { status: 500 })
}

async function loadPlugin(cacheBust) {
  return import(`${probe.url}?v=${cacheBust}`)
}

const plugin = await loadPlugin('a')

await ok('plugin declares its Cordis dependencies', async () => {
  assert.ok(Array.isArray(plugin.inject), 'inject must be an array')
  assert.ok(plugin.inject.includes('web'), 'plugin must inject the web seam')
  assert.ok(plugin.inject.includes('webServer'), 'plugin must inject the web server')
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(plugin.SEARCH_PROVIDER_ID, 'websearch-failover')
})

const boot = makeCtx()
await ok('apply registers one search provider and the API routes', async () => {
  await plugin.apply(boot.ctx, { configPath, runtimePath, statePath, logPath })
  assert.equal(boot.providers.length, 1, 'exactly one search provider')
  assert.equal(boot.providers[0].id, 'websearch-failover')
  assert.equal(typeof boot.providers[0].available, 'function')
  assert.equal(typeof boot.providers[0].search, 'function')
  assert.ok(boot.routes.length >= 1, 'at least one HTTP route')
  const route = boot.routes[0]
  assert.equal(route.path, plugin.API_BASE)
  assert.equal(route.kind, 'prefix')
})

const provider = boot.providers[0]

await ok('available() is synchronous and true with a valid config', async () => {
  const value = provider.available()
  assert.equal(typeof value, 'boolean')
  assert.equal(value, true)
})

await ok('search() calls the top provider, returns sources, and records stats', async () => {
  calls.length = 0
  const result = await provider.search({ query: 'deepseek harness', maxResults: 4 })
  assert.equal(result.sources.length, 1)
  assert.equal(result.sources[0].url, 'https://t.example/1')
  assert.equal(result.truncated, false)
  assert.ok(calls[0].url.includes('api.tavily.com'), 'tavily is first in config order')
  const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
  assert.equal(runtime.stats.tavily.calls, 1)
  assert.equal(runtime.stats.tavily.successes, 1)
  assert.equal(runtime.stats.exa, undefined, 'untouched providers record nothing')
})

await ok('an empty result from the top provider is counted before the next one wins', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('api.tavily.com')) {
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(url, init)
  }
  try {
    const result = await provider.search({ query: 'empty first', maxResults: 3 })
    assert.equal(result.sources[0].url, 'https://e.example/1', 'falls through to exa')
  } finally {
    globalThis.fetch = originalFetch
  }
  const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
  assert.equal(runtime.stats.tavily.lastOutcome, 'empty', 'the empty attempt is recorded')
  assert.equal(runtime.stats.tavily.calls, 2, 'first success + this empty attempt')
  assert.equal(runtime.stats.exa.successes, 1)
})

await ok('the API reorders providers and the next search honours it', async () => {
  const route = boot.routes[0]
  const res = makeRes()
  await route.handler(
    makeReq({ method: 'POST', url: `${plugin.API_BASE}/order`, body: { order: ['exa', 'tavily'] } }),
    res,
  )
  assert.equal(res.statusCode, 200)
  const payload = JSON.parse(res.body)
  assert.deepEqual(payload.providers.map((p) => p.id), ['exa', 'tavily'])
  assert.equal(payload.providers[0].rank, 1)

  calls.length = 0
  const result = await provider.search({ query: 'again', maxResults: 2 })
  assert.ok(calls[0].url.includes('api.exa.ai'), 'exa now leads the attempt order')
  assert.equal(result.sources[0].url, 'https://e.example/1')
})

await ok('the API disables a provider and the next search skips it', async () => {
  const route = boot.routes[0]
  const res = makeRes()
  await route.handler(
    makeReq({ method: 'POST', url: `${plugin.API_BASE}/enable`, body: { id: 'exa', enabled: false } }),
    res,
  )
  assert.equal(res.statusCode, 200)
  calls.length = 0
  const result = await provider.search({ query: 'without exa', maxResults: 2 })
  assert.ok(calls[0].url.includes('api.tavily.com'))
  assert.equal(result.sources.length, 1)
})

await ok('GET /state reports rank, key presence, balance slot and cooldown slot', async () => {
  const route = boot.routes[0]
  const res = makeRes()
  await route.handler(makeReq({ method: 'GET', url: `${plugin.API_BASE}/state` }), res)
  assert.equal(res.statusCode, 200)
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, true)
  const tavily = payload.providers.find((p) => p.id === 'tavily')
  assert.equal(tavily.keyPresent, true)
  assert.equal(tavily.enabled, true)
  assert.equal(typeof tavily.rank, 'number')
  assert.equal(tavily.balance, null, 'balances stay null until refreshed')
  assert.equal(tavily.cooldown.active, false)
  assert.equal(tavily.stats.calls >= 1, true)
  const exa = payload.providers.find((p) => p.id === 'exa')
  assert.equal(exa.enabled, false)
})

await ok('a failing provider cools down and the panel shows the cooldown', async () => {
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      defaults: { limit: 4, timeoutMs: 5000, cooldown: { quota: 60, auth: 60, error: 20 } },
      providers: [
        { id: 'tavily', kind: 'tavily', apiKey: 'k-tavily' },
        { id: 'exa', kind: 'exa', apiKey: 'k-exa' },
      ],
    }),
    'utf8',
  )
  // Re-enable exa and make exa the top provider with a hard 402.
  const route = boot.routes[0]
  await route.handler(makeReq({ method: 'POST', url: `${plugin.API_BASE}/enable`, body: { id: 'exa', enabled: true } }), makeRes())
  await route.handler(makeReq({ method: 'POST', url: `${plugin.API_BASE}/order`, body: { order: ['exa', 'tavily'] } }), makeRes())

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('api.exa.ai')) {
      return new Response(JSON.stringify({ error: 'Insufficient credit in account' }), { status: 402 })
    }
    return originalFetch(url, init)
  }
  try {
    const result = await provider.search({ query: 'quota test', maxResults: 2 })
    assert.equal(result.sources[0].url, 'https://t.example/1', 'falls through to tavily')
  } finally {
    globalThis.fetch = originalFetch
  }

  const res = makeRes()
  await route.handler(makeReq({ method: 'GET', url: `${plugin.API_BASE}/state` }), res)
  const payload = JSON.parse(res.body)
  const exa = payload.providers.find((p) => p.id === 'exa')
  assert.equal(exa.cooldown.active, true)
  assert.ok(exa.cooldown.until > Date.now(), 'cooldown expiry is in the future')
  assert.match(String(exa.cooldown.reason), /quota/)
})

await ok('POST /refresh records a balance for a provider with a balance API', async () => {
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      defaults: { limit: 4, timeoutMs: 5000 },
      providers: [
        { id: 'firecrawl', kind: 'firecrawl', apiKey: 'k-fc' },
        { id: 'exa', kind: 'exa', apiKey: 'k-exa' },
      ],
    }),
    'utf8',
  )
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('api.firecrawl.dev') && target.includes('credit-usage')) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            remainingCredits: 900,
            planCredits: 1000,
            billingPeriodStart: '2026-10-17T03:43:17.842Z',
            billingPeriodEnd: '2026-11-17T03:43:17.842Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (target.includes('api.exa.ai')) {
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const route = boot.routes[0]
    const res = makeRes()
    await route.handler(
      makeReq({ method: 'POST', url: `${plugin.API_BASE}/refresh`, body: { ids: ['firecrawl'] } }),
      res,
    )
    assert.equal(res.statusCode, 200)
    const payload = JSON.parse(res.body)
    const firecrawl = payload.providers.find((p) => p.id === 'firecrawl')
    assert.equal(firecrawl.balance.status, 'ok')
    assert.equal(firecrawl.balance.remaining, 900)
    assert.equal(firecrawl.balance.ratio, 0.9)
    assert.equal(firecrawl.balance.resetKind, 'period-end')
    assert.equal(firecrawl.balance.resetsAt, Date.parse('2026-11-17T03:43:17.842Z'))
    const exa = payload.providers.find((p) => p.id === 'exa')
    assert.equal(exa.balance, null, 'ids limit the refresh')
  } finally {
    globalThis.fetch = originalFetch
  }
})

await ok('a missing config makes available() false instead of throwing', async () => {
  const plugin2 = await loadPlugin('b')
  const second = makeCtx()
  await plugin2.apply(second.ctx, {
    configPath: path.join(tempRoot, 'missing.json'),
    runtimePath: path.join(tempRoot, 'runtime2.json'),
    statePath: path.join(tempRoot, 'state2.json'),
    logPath: path.join(tempRoot, 'plugin2.log'),
  })
  assert.equal(second.providers[0].available(), false)
  await assert.rejects(() => second.providers[0].search({ query: 'x', maxResults: 1 }), /config|providers/i)
})

await ok('every search writes one line to the plugin log', async () => {
  const text = fs.readFileSync(logPath, 'utf8')
  assert.match(text, /search/)
  assert.match(text, /tavily|exa|firecrawl/)
})

// ---------------------------------------------------------------- helpers

function makeReq({ method = 'GET', url, headers = {}, body } = {}) {
  const payload = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of payload) yield chunk
    },
  }
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    writeHead(code, headers) {
      this.statusCode = code
      Object.assign(this.headers, headers ?? {})
      return this
    },
    end(chunk) {
      if (chunk !== undefined) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      return this
    },
    get body() {
      return Buffer.concat(this.chunks).toString('utf8')
    },
  }
}

probe.cleanup()
console.log(`\n${pass} PASS — host plugin contract holds`)
