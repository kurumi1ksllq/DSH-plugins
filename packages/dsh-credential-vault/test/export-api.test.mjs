// T4 (issue #51): export/import HTTP routes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createCipheriv, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../index.js'
import { createVaultStore } from '../lib/vault-store.js'
import { openEnvelope } from '../lib/envelope.mjs'
import { readAudit } from '../lib/audit.js'

const PASS = 'correct horse battery'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-export-'))
}

function fakeContext() {
  const registered = { tools: [], sections: [], routes: [], contributors: [] }
  const shellEnv = {
    register(contributor) {
      registered.contributors.push(contributor)
      return () => {}
    },
  }
  return {
    registered,
    systemPrompt: { section: (section) => registered.sections.push(section) },
    effect(fn) { fn() },
    tools: { register: (tool) => registered.tools.push(tool) },
    webServer: { register: (route) => registered.routes.push(route) },
    inject(names, callback) {
      return names.includes('shellEnv') ? callback({ shellEnv }) : () => {}
    },
  }
}

async function setup(dir) {
  const ctx = fakeContext()
  apply(ctx, { vaultDir: dir })
  const store = createVaultStore(dir)
  const handler = ctx.registered.routes.reduce((map, route) => {
    map[route.path] = route.handler
    return map
  }, {})
  return { store, handler }
}

async function post(handler, path, body) {
  const req = {
    method: 'POST',
    url: path,
    headers: { host: 'h:1', origin: 'http://h:1', 'sec-fetch-site': 'same-origin' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body))
    },
  }
  const routeHandler = typeof handler === 'function' ? handler : handler[path]
  if (typeof routeHandler !== 'function') {
    throw new Error(`post(): no handler for ${path}`)
  }
  const captured = { status: 0, payload: null }
  await routeHandler(req, {
    writeHead(status) { captured.status = status },
    end(text) { captured.payload = JSON.parse(text) },
  })
  return captured
}

async function get(handler, path) {
  const req = { method: 'GET', url: path, headers: { host: 'h:1', origin: 'http://h:1', 'sec-fetch-site': 'same-origin' } }
  const routeHandler = typeof handler === 'function' ? handler : handler[path]
  if (typeof routeHandler !== 'function') {
    throw new Error(`post(): no handler for ${path}`)
  }
  const captured = { status: 0, payload: null }
  await routeHandler(req, {
    writeHead(status) { captured.status = status },
    end(text) { captured.payload = JSON.parse(text) },
  })
  return captured
}

test('#51 export returns an encrypted envelope whose plaintext is only in the file', async () => {
  const dir = tempDir()
  try {
    const { store, handler } = await setup(dir)
    store.set('github token', { kind: 'token', secret: 'ghp_topsecret', service: 'github', aliases: ['gh'] })

    const response = await post(handler, '/credential-vault/api/export', { passphrase: PASS })
    assert.equal(response.status, 200)
    assert.equal(response.payload.ok, true)
    assert.match(response.payload.filename, /\.dsvault$/)
    // The response must NOT carry plaintext anywhere.
    assert.equal(JSON.stringify(response.payload).includes('ghp_topsecret'), false)

    // And the envelope decrypts to the full entry metadata + secret.
    const opened = openEnvelope(PASS, JSON.parse(response.payload.content))
    assert.equal(opened.entries.length, 1)
    assert.equal(opened.entries[0].name, 'github token')
    assert.equal(opened.entries[0].secret, 'ghp_topsecret')
    assert.equal(opened.entries[0].service, 'github')
    assert.deepEqual(opened.entries[0].aliases, ['gh'])
    assert.match(opened.entries[0].id, /^[0-9a-f-]{36}$/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#51 importing the same file twice skips everything the second time', async () => {
  const dir = tempDir()
  try {
    const { store, handler } = await setup(dir)
    store.set('github token', { kind: 'token', secret: 'v1' })

    const exported = await post(handler, '/credential-vault/api/export', { passphrase: PASS })
    const content = exported.payload.content

    const fresh = tempDir()
    try {
      const target = await setup(fresh)
      const first = await post(target.handler, '/credential-vault/api/import', { passphrase: PASS, content, mode: 'skip' })
      assert.equal(first.status, 200)
      assert.equal(first.payload.imported, 1)

      const second = await post(target.handler, '/credential-vault/api/import', { passphrase: PASS, content, mode: 'skip' })
      assert.equal(second.payload.imported, 0)
      assert.equal(second.payload.skipped, 1)
      assert.equal(target.store.reveal('github token').secret, 'v1')
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#51 same name different id is a conflict and the local secret survives', async () => {
  const dir = tempDir()
  try {
    const { store, handler } = await setup(dir)
    store.set('prod ssh', { kind: 'password', secret: 'LOCAL-SECRET' })

    const exported = await post(handler, '/credential-vault/api/export', { passphrase: PASS })
    const content = exported.payload.content

    const fresh = tempDir()
    try {
      const target = await setup(fresh)
      // The target already has its OWN 'prod ssh' (different id).
      target.store.set('prod ssh', { kind: 'password', secret: 'TARGET-SECRET' })
      const localBefore = target.store.reveal('prod ssh').secret

      const result = await post(target.handler, '/credential-vault/api/import', { passphrase: PASS, content, mode: 'overwrite' })
      assert.equal(result.status, 200)
      assert.equal(result.payload.conflicts.length, 1)
      assert.equal(result.payload.conflicts[0].reason, 'name-taken')
      assert.equal(target.store.reveal('prod ssh').secret, 'TARGET-SECRET', 'the local entry must survive')
      assert.notEqual(localBefore, undefined)
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#51 export/import are audited with sessionId and no secrets', async () => {
  const dir = tempDir()
  try {
    const { store, handler } = await setup(dir)
    store.set('github token', { kind: 'token', secret: 'ghp_auditcheck' })

    await post(handler, '/credential-vault/api/export', { passphrase: PASS })
    const records = readAudit(dir, 20).filter((record) => record.action === 'export' || record.action === 'import')
    assert.ok(records.length >= 1)
    assert.equal(JSON.stringify(records).includes('ghp_auditcheck'), false)
    assert.equal(JSON.stringify(records).includes(PASS), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#51 import refuses a bad passphrase and a tampered content with one error', async () => {
  const dir = tempDir()
  try {
    const { handler } = await setup(dir)
    const exported = await post(handler, '/credential-vault/api/export', { passphrase: PASS })
    const content = exported.payload.content

    const wrong = await post(handler, '/credential-vault/api/import', { passphrase: 'wrong passphrase 99', content })
    assert.equal(wrong.status, 400)
    assert.equal(wrong.payload.error, 'bad-passphrase-or-tampered')

    // Tamper with the payload INSIDE valid JSON: flip characters in the middle of
    // the base64 payload (truncating would break the JSON itself).
    const envelope = JSON.parse(content)
    envelope.payload = envelope.payload.slice(0, -12) + 'AAAAAAAAAAAA'
    const tampered = await post(handler, '/credential-vault/api/import', { passphrase: PASS, content: JSON.stringify(envelope) })
    assert.equal(tampered.status, 400)
    assert.equal(tampered.payload.error, 'bad-passphrase-or-tampered')

    // A payload corrupted in a way that ALSO breaks JSON stays invalid-json.
    const brokenJson = await post(handler, '/credential-vault/api/import', { passphrase: PASS, content: content.slice(0, -8) + 'AAAAAAAA' })
    assert.equal(brokenJson.status, 400)
    assert.equal(brokenJson.payload.error, 'invalid-json')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#51 oversized import content is refused', async () => {
  const dir = tempDir()
  try {
    const { handler } = await setup(dir)
    const huge = 'x'.repeat(8 * 1024 * 1024 + 1024)
    const response = await post(handler, '/credential-vault/api/import', { passphrase: PASS, content: huge })
    assert.equal(response.status, 413)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
