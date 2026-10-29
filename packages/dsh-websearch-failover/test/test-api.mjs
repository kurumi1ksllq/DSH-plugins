// HTTP API contract for the websearch-failover DSH bundle.
// The sidebar panel is the only client; every route is same-origin only.
import assert from 'node:assert/strict'

const { createApiHandler, API_BASE, MAX_BODY_BYTES } = await import('../lib/api.mjs')

let pass = 0
function ok(name, fn) {
  fn()
  pass += 1
  console.log(`PASS ${name}`)
}

async function okAsync(name, fn) {
  await fn()
  pass += 1
  console.log(`PASS ${name}`)
}

function makeReq({ method = 'GET', url = `${API_BASE}/state`, headers = {}, body } = {}) {
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

async function call(handler, options) {
  const req = makeReq(options)
  const res = makeRes()
  await handler(req, res)
  let json
  try {
    json = res.body ? JSON.parse(res.body) : undefined
  } catch {
    json = undefined
  }
  return { status: res.statusCode, json, headers: res.headers }
}

const FIXTURE = () => ({
  ok: true,
  generatedAt: 1_700_000_000_000,
  providers: [
    { id: 'tavily', kind: 'tavily', label: 'Tavily', enabled: true, rank: 1, keyPresent: true, balance: null, cooldown: { active: false } },
    { id: 'exa', kind: 'exa', label: 'Exa', enabled: true, rank: 2, keyPresent: true, balance: null, cooldown: { active: false } },
  ],
})

function makeHandler(overrides = {}) {
  const calls = { snapshot: 0, reorder: [], refresh: [], enable: [] }
  const handler = createApiHandler({
    snapshot() {
      calls.snapshot += 1
      return FIXTURE()
    },
    reorder(ids) {
      calls.reorder.push(ids)
      return FIXTURE()
    },
    refresh: async (ids) => {
      calls.refresh.push(ids)
      return FIXTURE()
    },
    setEnabled(id, enabled) {
      calls.enable.push([id, enabled])
      return FIXTURE()
    },
    ...overrides,
  })
  return { handler, calls }
}

ok('API_BASE is the documented prefix', () => {
  assert.equal(API_BASE, '/websearch-failover/api')
  assert.ok(MAX_BODY_BYTES >= 4096)
})

await okAsync('GET /state returns the ordered provider snapshot', async () => {
  const { handler, calls } = makeHandler()
  const result = await call(handler, { method: 'GET' })
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(result.json.providers.length, 2)
  assert.equal(calls.snapshot, 1)
  assert.match(result.headers['content-type'], /application\/json/)
})

await okAsync('POST /order forwards the id array and returns the new snapshot', async () => {
  const { handler, calls } = makeHandler()
  const result = await call(handler, { method: 'POST', url: `${API_BASE}/order`, body: { order: ['exa', 'tavily'] } })
  assert.equal(result.status, 200)
  assert.deepEqual(calls.reorder, [['exa', 'tavily']])
  assert.equal(result.json.providers[0].id, 'tavily')
})

await okAsync('POST /order rejects a non-array order without calling reorder', async () => {
  const { handler, calls } = makeHandler()
  const result = await call(handler, { method: 'POST', url: `${API_BASE}/order`, body: { order: 'exa' } })
  assert.equal(result.status, 400)
  assert.equal(result.json.error, 'invalid-order')
  assert.deepEqual(calls.reorder, [])
})

await okAsync('POST /enable forwards id + enabled', async () => {
  const { handler, calls } = makeHandler()
  const result = await call(handler, { method: 'POST', url: `${API_BASE}/enable`, body: { id: 'exa', enabled: false } })
  assert.equal(result.status, 200)
  assert.deepEqual(calls.enable, [['exa', false]])
})

await okAsync('POST /refresh forwards optional ids', async () => {
  const { handler, calls } = makeHandler()
  let result = await call(handler, { method: 'POST', url: `${API_BASE}/refresh`, body: {} })
  assert.equal(result.status, 200)
  await call(handler, { method: 'POST', url: `${API_BASE}/refresh`, body: { ids: ['tavily'] } })
  assert.deepEqual(calls.refresh, [undefined, ['tavily']])
})

await okAsync('GET on a POST-only route answers 405 with an allow header', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, { method: 'GET', url: `${API_BASE}/order` })
  assert.equal(result.status, 405)
  assert.match(String(result.headers.allow), /POST/)
})

await okAsync('unknown paths answer 404', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, { method: 'GET', url: `${API_BASE}/nope` })
  assert.equal(result.status, 404)
  assert.equal(result.json.error, 'not-found')
})

await okAsync('cross-site state changes are rejected', async () => {
  const { handler, calls } = makeHandler()
  const result = await call(handler, {
    method: 'POST',
    url: `${API_BASE}/order`,
    headers: { 'sec-fetch-site': 'cross-site' },
    body: { order: ['exa'] },
  })
  assert.equal(result.status, 403)
  assert.equal(result.json.error, 'forbidden-origin')
  assert.deepEqual(calls.reorder, [])
})

await okAsync('a foreign Origin is rejected, a same-origin one is accepted', async () => {
  const { handler, calls } = makeHandler()
  const bad = await call(handler, {
    method: 'POST',
    url: `${API_BASE}/order`,
    headers: { origin: 'http://evil.test', host: '127.0.0.1:50913' },
    body: { order: ['exa'] },
  })
  assert.equal(bad.status, 403)
  assert.deepEqual(calls.reorder, [])

  const good = await call(handler, {
    method: 'POST',
    url: `${API_BASE}/order`,
    headers: { origin: 'http://127.0.0.1:50913', host: '127.0.0.1:50913' },
    body: { order: ['exa'] },
  })
  assert.equal(good.status, 200)
  assert.deepEqual(calls.reorder, [['exa']])
})

await okAsync('malformed JSON answers 400', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, { method: 'POST', url: `${API_BASE}/order`, body: '{oops' })
  assert.equal(result.status, 400)
  assert.equal(result.json.error, 'invalid-json')
})

await okAsync('an oversized body answers 413', async () => {
  const { handler } = makeHandler({ maxBodyBytes: 64 })
  const result = await call(handler, { method: 'POST', url: `${API_BASE}/order`, body: { order: ['x'.repeat(200)] } })
  assert.equal(result.status, 413)
  assert.equal(result.json.error, 'payload-too-large')
})

await okAsync('a throwing service becomes a 500 with the error message', async () => {
  const handler = createApiHandler({
    snapshot() {
      throw new Error('boom')
    },
    reorder() {},
    refresh: async () => {},
    setEnabled() {},
  })
  const result = await call(handler, { method: 'GET' })
  assert.equal(result.status, 500)
  assert.equal(result.json.error, 'internal-error')
  assert.match(result.json.message, /boom/)
})

console.log(`\n${pass} PASS — API contract holds`)
