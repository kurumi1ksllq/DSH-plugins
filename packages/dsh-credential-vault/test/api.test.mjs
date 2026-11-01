// Tests for lib/api.mjs — route table, origin guard, no secret in responses.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createApiHandler, API_BASE } from '../lib/api.mjs'
import { createVaultStore } from '../lib/vault-store.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-api-test-'))
}

/** Minimal req/res doubles over a Web ReadableStream body. */
function makeReq(method, url, body, headers = {}) {
  const encoder = new TextEncoder()
  const stream = body === undefined
    ? null
    : new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(JSON.stringify(body)))
          controller.close()
        },
      })
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (stream === null) return
      yield encoder.encode(JSON.stringify(body))
    },
  }
}

function makeRes() {
  const res = { statusCode: 0, headers: {}, body: '' }
  res.writeHead = (status, headers) => {
    res.statusCode = status
    res.headers = headers
  }
  res.end = (text) => {
    res.body += text
  }
  return res
}

const sameOriginHeaders = { host: '127.0.0.1:10100', origin: 'http://127.0.0.1:10100' }

async function call(handler, method, url, body, headers) {
  const res = makeRes()
  await handler(makeReq(method, url, body, headers ?? (method === 'GET' ? {} : sameOriginHeaders)), res)
  return { status: res.statusCode, json: JSON.parse(res.body || '{}') }
}

test('API base and route surface', async () => {
  const dir = tempDir()
  try {
    const handler = createApiHandler({ store: createVaultStore(dir) })
    const list = await call(handler, 'GET', `${API_BASE}/list`)
    assert.equal(list.status, 200)
    assert.deepEqual(list.json.entries, [])

    await call(handler, 'POST', `${API_BASE}/set`, { name: 'api-key-1', kind: 'api-key', secret: 'sk-1234567890' })
    const entry = await call(handler, 'GET', `${API_BASE}/entry?name=api-key-1`)
    assert.equal(entry.status, 200)
    assert.equal(entry.json.entry.hasSecret, true)
    assert.equal(JSON.stringify(entry.json).includes('sk-1234567890'), false)

    const audit = await call(handler, 'GET', `${API_BASE}/audit`)
    assert.equal(audit.status, 200)
    assert.deepEqual(audit.json.records, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('set persists and list shows masked preview', async () => {
  const dir = tempDir()
  try {
    const handler = createApiHandler({ store: createVaultStore(dir) })
    const result = await call(handler, 'POST', `${API_BASE}/set`, {
      name: 'github-token', kind: 'token', secret: 'ghp_abcdefghij', note: 'ci',
    })
    assert.equal(result.status, 200)
    assert.equal(result.json.ok, true)
    assert.equal(result.json.updated, false)

    const list = await call(handler, 'GET', `${API_BASE}/list`)
    assert.equal(list.json.entries.length, 1)
    assert.equal(list.json.entries[0].name, 'github-token')
    assert.equal(list.json.entries[0].preview.includes('abcdefghij'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('validation errors surface as 4xx with codes', async () => {
  const dir = tempDir()
  try {
    const handler = createApiHandler({ store: createVaultStore(dir) })
    const noName = await call(handler, 'POST', `${API_BASE}/set`, { secret: 'x' })
    assert.equal(noName.status, 400)
    assert.equal(noName.json.error, 'invalid-name')

    const noSecret = await call(handler, 'POST', `${API_BASE}/set`, { name: 'a' })
    assert.equal(noSecret.status, 400)
    assert.equal(noSecret.json.error, 'invalid-secret')

    const badName = await call(handler, 'POST', `${API_BASE}/set`, { name: 'a/b', secret: 'x' })
    assert.equal(badName.status, 400)
    assert.equal(badName.json.error, 'store-failed')

    const missing = await call(handler, 'GET', `${API_BASE}/entry?name=ghost`)
    assert.equal(missing.status, 404)
    assert.equal(missing.json.error, 'not-found')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cross-site POSTs are rejected with 403', async () => {
  const dir = tempDir()
  try {
    const handler = createApiHandler({ store: createVaultStore(dir) })
    const res = await call(handler, 'POST', `${API_BASE}/set`, { name: 'x', secret: 'y' }, {
      host: '127.0.0.1:10100',
      origin: 'http://evil.example',
      'sec-fetch-site': 'cross-site',
    })
    assert.equal(res.status, 403)
    assert.equal(res.json.error, 'forbidden-origin')
    const list = await call(handler, 'GET', `${API_BASE}/list`)
    assert.equal(list.json.entries.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unknown route 404, wrong method 405', async () => {
  const dir = tempDir()
  try {
    const handler = createApiHandler({ store: createVaultStore(dir) })
    assert.equal((await call(handler, 'GET', `${API_BASE}/nope`)).status, 404)
    assert.equal((await call(handler, 'GET', `${API_BASE}/set`)).status, 405)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('delete and rotate work over HTTP', async () => {
  const dir = tempDir()
  try {
    const handler = createApiHandler({ store: createVaultStore(dir) })
    await call(handler, 'POST', `${API_BASE}/set`, { name: 'a', secret: 'va' })
    await call(handler, 'POST', `${API_BASE}/set`, { name: 'b', secret: 'vb' })
    const rotated = await call(handler, 'POST', `${API_BASE}/rotate`, {})
    assert.equal(rotated.json.resealed, 2)
    const deleted = await call(handler, 'POST', `${API_BASE}/delete`, { name: 'a' })
    assert.equal(deleted.json.deleted, true)
    const list = await call(handler, 'GET', `${API_BASE}/list`)
    assert.deepEqual(list.json.entries.map((entry) => entry.name), ['b'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
