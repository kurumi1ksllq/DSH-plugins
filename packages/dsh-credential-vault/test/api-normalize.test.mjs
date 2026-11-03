// Tests for the HTTP surface accepting the normalized metadata (issue #36, T6).
//
// The panel is the only writer of `service` and `aliases`, so the API it talks to
// must accept both and echo them back on the read routes — while still never
// returning a secret.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { API_BASE, createApiHandler } from '../lib/api.mjs'
import { createVaultStore } from '../lib/vault-store.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-api-normalize-'))
}

/** Drive the handler with a fake request/response pair. */
async function call(handler, { method = 'GET', path, body }) {
  const url = `${API_BASE}${path}`
  const req = {
    method,
    url,
    headers: { host: 'localhost:3080', origin: 'http://localhost:3080', 'sec-fetch-site': 'same-origin' },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    },
  }
  const captured = { status: 0, payload: null }
  const res = {
    writeHead(status) {
      captured.status = status
    },
    end(text) {
      captured.payload = JSON.parse(text)
    },
  }
  await handler(req, res)
  return captured
}

test('set stores service and aliases and list returns them', async () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    const handler = createApiHandler({ store })

    const created = await call(handler, {
      method: 'POST',
      path: '/set',
      body: { name: 'github token', kind: 'token', secret: 'ghp_value', service: 'github', aliases: ['gh', 'git'] },
    })
    assert.equal(created.status, 200)

    const listed = await call(handler, { path: '/list' })
    const entry = listed.payload.entries.find((item) => item.name === 'github token')
    assert.equal(entry.service, 'github')
    assert.deepEqual(entry.aliases, ['gh', 'git'])
    assert.equal(entry.slug, 'github-token')
    assert.equal(JSON.stringify(listed.payload).includes('ghp_value'), false)

    const single = await call(handler, { path: '/entry?name=github%20token' })
    assert.equal(single.payload.entry.service, 'github')
    assert.deepEqual(single.payload.entry.aliases, ['gh', 'git'])
    assert.equal(JSON.stringify(single.payload).includes('ghp_value'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('aliases are sanitized and a bad kind is rejected', async () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    const handler = createApiHandler({ store })

    await call(handler, {
      method: 'POST',
      path: '/set',
      body: { name: 'db', kind: 'database', secret: 'pw', aliases: [' db ', '', 42, 'db'] },
    })
    const entry = (await call(handler, { path: '/entry?name=db' })).payload.entry
    assert.deepEqual(entry.aliases, ['db'])
    assert.equal(entry.kind, 'database')

    const rejected = await call(handler, {
      method: 'POST',
      path: '/set',
      body: { name: 'x', kind: 'nonsense', secret: 'v' },
    })
    assert.equal(rejected.payload.ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('editing metadata without a secret keeps service and aliases intact', async () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    const handler = createApiHandler({ store })

    await call(handler, { method: 'POST', path: '/set', body: { name: 'kept', kind: 'token', secret: 'v1', service: 'github', aliases: ['gh'] } })
    const edited = await call(handler, { method: 'POST', path: '/set', body: { name: 'kept', kind: 'token', service: 'github-enterprise', aliases: ['gh', 'ge'] } })
    assert.equal(edited.status, 200)

    const entry = (await call(handler, { path: '/entry?name=kept' })).payload.entry
    assert.equal(entry.service, 'github-enterprise')
    assert.deepEqual(entry.aliases, ['gh', 'ge'])
    assert.equal(store.reveal('kept').secret, 'v1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
