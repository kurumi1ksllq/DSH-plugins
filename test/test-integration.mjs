// Live HTTP integration for the sidebar API: boots the real plugin against a
// real node:http server on loopback, then talks to it over fetch with genuine
// same-origin/cross-site headers. Proves the prefix route + JSON contract work
// through the transport the DSH web server uses, not just through stubs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

let pass = 0
async function ok(name, fn) {
  await fn()
  pass += 1
  console.log(`PASS ${name}`)
}

// Keep the bundle self-contained the same way scripts/build-plugin.mjs will.
const bundleLib = path.join(repoRoot, 'plugin', 'lib')
fs.mkdirSync(bundleLib, { recursive: true })
for (const name of ['core.mjs', 'runtime.mjs', 'balance.mjs', 'api.mjs', 'http.mjs']) {
  const source = path.join(repoRoot, 'lib', name)
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(bundleLib, name))
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-http-'))
const configPath = path.join(tempRoot, 'providers.json')
const runtimePath = path.join(tempRoot, 'runtime.json')
const statePath = path.join(tempRoot, 'state.json')
const logPath = path.join(tempRoot, 'plugin.log')

fs.writeFileSync(
  configPath,
  JSON.stringify({
    defaults: { limit: 3, timeoutMs: 4000 },
    providers: [
      { id: 'tavily', kind: 'tavily', apiKey: 'k-tavily' },
      { id: 'exa', kind: 'exa', apiKey: 'k-exa' },
    ],
  }),
  'utf8',
)

const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  const target = String(url)
  if (target.startsWith('http://127.0.0.1')) return realFetch(url, init)
  if (target.includes('api.tavily.com/usage')) {
    return new Response(JSON.stringify({ account: { plan_usage: 250, plan_limit: 1000 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (target.includes('api.exa.ai')) {
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  throw new Error(`unexpected outbound call: ${target}`)
}

const routes = []
const ctx = {
  web: { registerSearchProvider: () => () => {} },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  effect: (fn) => fn(),
  on() {},
  emit() {},
  logger: { info() {}, warn() {}, error() {} },
}

const plugin = await import(`${pathToFileURL(path.join(repoRoot, 'plugin', 'index.js')).href}?http=1`)
await plugin.apply(ctx, { configPath, runtimePath, statePath, logPath })

const handler = routes[0].handler
const server = http.createServer((req, res) => {
  if (String(req.url ?? '').startsWith(plugin.API_BASE)) {
    handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('nope')
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const origin = `http://127.0.0.1:${port}`

try {
  await ok('GET /state works over real HTTP', async () => {
    const response = await realFetch(`${origin}${plugin.API_BASE}/state`)
    assert.equal(response.status, 200)
    assert.match(String(response.headers.get('content-type')), /application\/json/)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.deepEqual(payload.providers.map((p) => p.id), ['tavily', 'exa'])
    assert.equal(payload.providers[0].rank, 1)
  })

  await ok('same-origin POST /order reorders over real HTTP', async () => {
    const response = await realFetch(`${origin}${plugin.API_BASE}/order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ order: ['exa', 'tavily'] }),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.deepEqual(payload.providers.map((p) => p.id), ['exa', 'tavily'])
    assert.equal(payload.providers[0].rank, 1)
    // persisted for the engine, not just echoed back
    const stored = JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
    assert.deepEqual(stored.order, ['exa', 'tavily'])
  })

  await ok('cross-site POST /order is refused over real HTTP', async () => {
    const response = await realFetch(`${origin}${plugin.API_BASE}/order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.test', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ order: ['tavily'] }),
    })
    assert.equal(response.status, 403)
    const payload = await response.json()
    assert.equal(payload.error, 'forbidden-origin')
  })

  await ok('POST /refresh fills balances for the requested provider', async () => {
    const response = await realFetch(`${origin}${plugin.API_BASE}/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ ids: ['tavily'] }),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    const tavily = payload.providers.find((p) => p.id === 'tavily')
    assert.equal(tavily.balance.status, 'ok')
    assert.equal(tavily.balance.remaining, 750)
    assert.equal(tavily.balance.ratio, 0.75)
    const exa = payload.providers.find((p) => p.id === 'exa')
    assert.equal(exa.balance, null)
  })

  await ok('POST /enable disables a provider and /state reflects it', async () => {
    const disable = await realFetch(`${origin}${plugin.API_BASE}/enable`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ id: 'exa', enabled: false }),
    })
    assert.equal(disable.status, 200)
    const state = await (await realFetch(`${origin}${plugin.API_BASE}/state`)).json()
    assert.equal(state.providers.find((p) => p.id === 'exa').enabled, false)
  })

  await ok('unknown API paths answer 404 through the real server', async () => {
    const response = await realFetch(`${origin}${plugin.API_BASE}/bogus`)
    assert.equal(response.status, 404)
    assert.equal((await response.json()).error, 'not-found')
  })
} finally {
  await new Promise((resolve) => server.close(resolve))
  globalThis.fetch = realFetch
}

console.log(`\n${pass} PASS — live HTTP integration holds`)
