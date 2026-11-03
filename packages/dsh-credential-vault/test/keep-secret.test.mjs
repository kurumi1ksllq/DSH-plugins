// Tests for keeping the stored secret when an edit submits an empty one.
//
// The panel advertises "leave empty to keep the stored secret" and the editor
// allows submitting an empty secret on an existing entry. The host used to
// reject that outright with 400, so editing any metadata always failed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createApiHandler, API_BASE } from '../lib/api.mjs'
import { createVaultStore } from '../lib/vault-store.js'

const sameOriginHeaders = { host: '127.0.0.1:10100', origin: 'http://127.0.0.1:10100' }

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
      if (stream !== null) for await (const chunk of stream) yield chunk
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

async function call(handler, method, url, body) {
  const res = makeRes()
  await handler(makeReq(method, url, body, method === 'GET' ? {} : sameOriginHeaders), res)
  return { status: res.statusCode, json: JSON.parse(res.body || '{}') }
}

function withVault(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'vault-keep-secret-'))
  return Promise.resolve(fn(createApiHandler({ store: createVaultStore(dir) }))).finally(() => rmSync(dir, { recursive: true, force: true }))
}

test('editing an existing entry with an empty secret keeps the stored secret', async () => {
  await withVault(async (handler) => {
    await call(handler, 'POST', `${API_BASE}/set`, { name: 'token-a', kind: 'api-key', secret: 'sk-original-value' })
    const before = await call(handler, 'GET', `${API_BASE}/entry?name=token-a`)
    assert.equal(before.status, 200)
    const previewBefore = before.json.entry.preview

    const edited = await call(handler, 'POST', `${API_BASE}/set`, {
      name: 'token-a', kind: 'api-key', secret: '', username: 'alice', note: 'rotated host',
    })
    assert.equal(edited.status, 200, 'an empty secret on an existing entry must be accepted')

    const after = await call(handler, 'GET', `${API_BASE}/entry?name=token-a`)
    assert.equal(after.json.entry.preview, previewBefore, 'the stored secret must be unchanged')
    assert.equal(after.json.entry.username, 'alice', 'metadata must be updated')
    assert.equal(after.json.entry.note, 'rotated host')
  })
})

test('an omitted secret on an existing entry also keeps the stored secret', async () => {
  await withVault(async (handler) => {
    await call(handler, 'POST', `${API_BASE}/set`, { name: 'token-b', kind: 'api-key', secret: 'sk-keep-me' })
    const before = await call(handler, 'GET', `${API_BASE}/entry?name=token-b`)

    const edited = await call(handler, 'POST', `${API_BASE}/set`, { name: 'token-b', note: 'only note' })
    assert.equal(edited.status, 200)

    const after = await call(handler, 'GET', `${API_BASE}/entry?name=token-b`)
    assert.equal(after.json.entry.preview, before.json.entry.preview)
  })
})

test('creating a NEW entry with an empty secret is still rejected', async () => {
  await withVault(async (handler) => {
    const res = await call(handler, 'POST', `${API_BASE}/set`, { name: 'brand-new', kind: 'api-key', secret: '' })
    assert.equal(res.status, 400)
    assert.equal(res.json.error, 'invalid-secret')

    const list = await call(handler, 'GET', `${API_BASE}/list`)
    assert.deepEqual(list.json.entries, [], 'a rejected create must not leave an entry behind')
  })
})

test('updating a missing name with an empty secret does not secretly create it', async () => {
  await withVault(async (handler) => {
    const res = await call(handler, 'POST', `${API_BASE}/set`, { name: 'ghost', kind: 'api-key', secret: '' })
    assert.equal(res.status, 400)
    const list = await call(handler, 'GET', `${API_BASE}/list`)
    assert.deepEqual(list.json.entries, [])
  })
})

test('an explicit new secret still replaces the old one', async () => {
  await withVault(async (handler) => {
    await call(handler, 'POST', `${API_BASE}/set`, { name: 'token-c', kind: 'api-key', secret: 'sk-first' })
    const before = await call(handler, 'GET', `${API_BASE}/entry?name=token-c`)
    const edited = await call(handler, 'POST', `${API_BASE}/set`, { name: 'token-c', kind: 'api-key', secret: 'sk-second' })
    assert.equal(edited.status, 200)
    const after = await call(handler, 'GET', `${API_BASE}/entry?name=token-c`)
    assert.notEqual(after.json.entry.preview, before.json.entry.preview)
  })
})

test('a store failure never echoes the secret in the response', async () => {
  // A future throw that happens to interpolate the secret must not reach the wire.
  const dir = mkdtempSync(join(tmpdir(), 'vault-leak-'))
  try {
    const real = createVaultStore(dir)
    const leaky = {
      ...real,
      set() { throw new Error('leaked sk-super-secret-value') },
      list: () => [],
    }
    const handler = createApiHandler({ store: leaky })
    const res = await call(handler, 'POST', `${API_BASE}/set`, { name: 'x', kind: 'api-key', secret: 'sk-super-secret-value' })
    assert.equal(res.status, 400)
    assert.equal(JSON.stringify(res.json).includes('sk-super-secret-value'), false, 'the response must not carry the secret')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
