import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'

import { isForbiddenOrigin } from '../lib/http-guard.js'

function makeReq(headers) {
  return { headers }
}

test('isForbiddenOrigin: cross-site sec-fetch-site header is rejected', () => {
  assert.equal(isForbiddenOrigin(makeReq({ 'sec-fetch-site': 'cross-site' })), true)
  assert.equal(isForbiddenOrigin(makeReq({ 'sec-fetch-site': 'Cross-Site', origin: 'http://127.0.0.1:26927', host: '127.0.0.1:26927' })), true)
  assert.equal(isForbiddenOrigin(makeReq({ 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:26927', host: '127.0.0.1:26927' })), false)
})

test('isForbiddenOrigin: malicious or mismatched Origin is rejected', () => {
  // Origin that does not parse as a URL.
  assert.equal(isForbiddenOrigin(makeReq({ origin: 'not a url', host: '127.0.0.1:26927' })), true)
  // Origin present but empty.
  assert.equal(isForbiddenOrigin(makeReq({ origin: '', host: '127.0.0.1:26927' })), true)
  // Different host than the request Host.
  assert.equal(isForbiddenOrigin(makeReq({ origin: 'http://evil.example.com', host: '127.0.0.1:26927' })), true)
  // Valid URL origin, but no Host header at all.
  assert.equal(isForbiddenOrigin(makeReq({ origin: 'http://127.0.0.1:26927' })), true)
  // Same-origin passes.
  assert.equal(isForbiddenOrigin(makeReq({ origin: 'http://127.0.0.1:26927', host: '127.0.0.1:26927' })), false)
})

test('isForbiddenOrigin: plain curl without Origin or sec-fetch-site passes', () => {
  assert.equal(isForbiddenOrigin(makeReq({ host: '127.0.0.1:26927' })), false)
  assert.equal(isForbiddenOrigin(makeReq({})), false)
})

test('registered non-GET routes answer 403 forbidden-origin and pass plain curl through', async () => {
  const { apply, ASSIGN_ROUTE } = await import('../index.js')
  const routes = []
  const ctx = {
    baseUrl: 'file:///C:/does-not-exist-profile/',
    logger: { warn() {}, info() {}, error() {} },
    get() {
      return undefined
    },
    effect(fn) {
      return fn()
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
  }
  apply(ctx)
  const route = routes.find((r) => r.path === ASSIGN_ROUTE)
  assert.ok(route, 'ASSIGN route registered')

  const post = (headers, body) => {
    const req = { method: 'POST', url: ASSIGN_ROUTE, headers }
    // Minimal async-iterable body so readBody() sees an empty payload on pass-through.
    req[Symbol.asyncIterator] = async function* () {
      if (body !== undefined) yield body
    }
    return req
  }
  const call = (req) => {
    const chunks = []
    return {
      chunks,
      promise: new Promise((resolve, reject) => {
        const res = {
          writeHead(code, head) {
            resolve({ status: code, headers: head })
          },
          end(chunk) {
            if (chunk) chunks.push(chunk)
          },
        }
        route.handler(req, res).catch(reject)
      }),
    }
  }

  // Cross-site: rejected before the body is even read.
  const blockedCall = call(post({ 'sec-fetch-site': 'cross-site', origin: 'http://evil.example.com', host: '127.0.0.1:26927' }, '{}'))
  const blocked = await blockedCall.promise
  assert.equal(blocked.status, 403)
  assert.match(String(blocked.headers['content-type']), /application\/json/)
  assert.equal(JSON.parse(blockedCall.chunks.join('')).error, 'forbidden-origin')

  // Plain curl (no Origin): allowed past the guard, fails later on a missing profile instead.
  const allowedCall = call(post({ host: '127.0.0.1:26927' }, '{}'))
  const allowed = await allowedCall.promise
  assert.notEqual(allowed.status, 403)
  assert.notEqual(JSON.parse(allowedCall.chunks.join('')).error, 'forbidden-origin')
})

test('the guard rejects a real cross-site request against a live http server', async () => {
  const server = createServer((req, res) => {
    res.writeHead(isForbiddenOrigin(req) ? 403 : 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: !isForbiddenOrigin(req) }))
  })
  await once(server.listen(0, '127.0.0.1'), 'listening')
  const { port } = server.address()
  try {
    const evil = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { origin: 'http://evil.example.com' },
    })
    assert.equal(evil.status, 403)
    assert.equal((await evil.json()).ok, false)

    const curlLike = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' })
    assert.equal(curlLike.status, 200)
    assert.equal((await curlLike.json()).ok, true)
  } finally {
    server.close()
  }
})
