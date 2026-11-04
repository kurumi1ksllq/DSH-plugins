// Hotfix 0.4.1 (issues #52 #53 #54 #55 #56 #57 #50 #58).
//
// Every case below reproduces a defect found by the post-merge review of #49 on
// the SHIPPED 0.4.0 build. Each test names the issue it pins so a failure points
// straight at the ticket.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createCipheriv, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CONTROL_CHARS, isValidName, readVault } from '../lib/store.js'
import { createVaultStore } from '../lib/vault-store.js'
import { buildHintText } from '../lib/hint.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-hotfix-'))
}

/** Seal a value the way the store does, so a fixture vault is readable. */
function seal(key, value) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final(), cipher.getAuthTag()])
  return Buffer.concat([nonce, body]).toString('base64')
}

/** Write a legacy (0.4.0-era) vault whose entries are keyed by `names`. */
function writeLegacyVault(dir, names) {
  const key = randomBytes(32)
  writeFileSync(join(dir, 'master.key'), key, { mode: 0o600 })
  const entries = {}
  for (const name of names) {
    entries[name] = {
      kind: 'token',
      secret: seal(key, `secret-of-${name}`),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
  }
  // Raw text: an object literal would set the prototype for a `__proto__` key.
  writeFileSync(join(dir, 'vault.json'), JSON.stringify({ version: 2, entries }))
}

// ---- #53: the control-character check must run BEFORE trim ----------------

test('#53 a trailing newline in service is refused, not trimmed away', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    assert.throws(() => store.set('a', { kind: 'token', secret: 'v', service: 'github\n' }), /service/)
    assert.throws(() => store.set('a', { kind: 'token', secret: 'v', service: '\ngithub' }), /service/)
    assert.throws(() => store.set('a', { kind: 'token', secret: 'v', service: 'github\r\n' }), /service/)
    assert.deepEqual(Object.keys(readVault(dir).entries), [], 'nothing may be written')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#53 a trailing newline in username or url is refused too', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    assert.throws(() => store.set('a', { kind: 'password', secret: 'v', username: 'root\n' }), /username/)
    assert.throws(() => store.set('a', { kind: 'password', secret: 'v', url: 'https://x\n' }), /url/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#53 surrounding spaces are still trimmed', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('a', { kind: 'token', secret: 'v', service: '  github  ', username: ' root ' })
    assert.equal(store.get('a').service, 'github')
    assert.equal(store.get('a').username, 'root')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- #54: isValidName must share the one control-character definition ----

test('#54 names containing Unicode separators or zero-width marks are refused', () => {
  for (const name of ['a\u2028b', 'a\u2029b', 'a\u0085b', 'a\u200bb', 'a\u202eb', 'a\ufeffb']) {
    assert.equal(isValidName(name), false, `${JSON.stringify(name)} must be refused`)
  }
})

test('#54 ordinary, non-ASCII and long names stay usable', () => {
  for (const name of ['github token', 'prod-server', '阿里云 ECS 密码', 'a'.repeat(128)]) {
    assert.equal(isValidName(name), true, `${name} must stay usable`)
  }
})

test('#54 one control-character definition is shared by names and metadata', () => {
  // The name check must not keep its own narrow regex: whatever CONTROL_CHARS
  // rejects in metadata must also be rejected in a name.
  for (const code of [0x0009, 0x000a, 0x000d, 0x007f, 0x0085, 0x2028, 0x2029, 0x200b, 0x202e, 0xfeff]) {
    const char = String.fromCodePoint(code)
    assert.ok(CONTROL_CHARS.test(`a${char}b`), `CONTROL_CHARS must match U+${code.toString(16)}`)
    assert.equal(isValidName(`a${char}b`), false, `name check must reject U+${code.toString(16)}`)
  }
})

// ---- #52: a dangerous-name entry is KEPT, flagged, and never deleted -----

test('#52 an existing constructor entry is listed and flagged, not dropped', () => {
  const dir = tempDir()
  try {
    writeLegacyVault(dir, ['constructor', 'real'])
    const store = createVaultStore(dir)
    const listed = store.listMeta()
    assert.deepEqual(listed.map((entry) => entry.name).sort(), ['constructor', 'real'])
    const unsafe = listed.find((entry) => entry.name === 'constructor')
    assert.equal(unsafe.unsafeName, true)
    assert.equal(listed.find((entry) => entry.name === 'real').unsafeName, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#52 get/reveal on an unsafe name fail loudly instead of returning null', () => {
  const dir = tempDir()
  try {
    writeLegacyVault(dir, ['constructor', 'real'])
    const store = createVaultStore(dir)
    assert.throws(() => store.get('constructor'), /unsafe name/)
    assert.throws(() => store.reveal('constructor'), /unsafe name/)
    // A healthy entry still works.
    assert.equal(store.reveal('real').secret, 'secret-of-real')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#52 an unrelated write must NOT delete the unsafe entry from disk', () => {
  const dir = tempDir()
  try {
    writeLegacyVault(dir, ['constructor', 'real'])
    const store = createVaultStore(dir)
    store.set('unrelated', { kind: 'token', secret: 'x' })
    const onDisk = JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8'))
    assert.ok(Object.hasOwn(onDisk.entries, 'constructor'), 'the legacy entry must survive a write')
    assert.ok(Object.hasOwn(onDisk.entries, 'real'))
    assert.ok(Object.hasOwn(onDisk.entries, 'unrelated'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#52 an unsafe name still cannot be created, but can be deleted explicitly', () => {
  const dir = tempDir()
  try {
    writeLegacyVault(dir, ['constructor'])
    const store = createVaultStore(dir)
    assert.throws(() => store.set('constructor', { kind: 'token', secret: 'v' }), /invalid credential name/)
    assert.throws(() => store.set('toString', { kind: 'token', secret: 'v' }), /invalid credential name/)
    assert.equal(store.delete('constructor'), true)
    assert.deepEqual(Object.keys(readVault(dir).entries), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- #55 + #56: the prompt index must keep names distinguishable ----------

test('#55 two different 128-character names render as different lines', () => {
  const first = 'a'.repeat(128)
  const second = `${'a'.repeat(120)}bcdefgh`
  const text = buildHintText([
    { name: first, kind: 'token', service: null, aliases: [], url: null, note: null },
    { name: second, kind: 'token', service: null, aliases: [], url: null, note: null },
  ])
  const lines = text.split('\n').filter((line) => line.startsWith('- '))
  assert.equal(lines.length, 2)
  assert.notEqual(lines[0], lines[1], 'different names must not collapse into one line')
  assert.ok(lines[0].includes(first), 'the full name must survive')
  assert.ok(lines[1].includes(second), 'the full name must survive')
})

test('#56 every legal metadata field is visible on its line', () => {
  const name = 'n'.repeat(128)
  const service = 's'.repeat(64)
  const aliases = Array.from({ length: 8 }, (_, index) => `${'a'.repeat(63)}${index}`)
  const text = buildHintText([{ name, kind: 'token', service, aliases, url: null, note: null }])
  const line = text.split('\n').find((candidate) => candidate.startsWith('- '))
  assert.ok(line.includes(name))
  assert.ok(line.includes(service))
  for (const alias of aliases) assert.ok(line.includes(alias), `alias ${alias} must be visible`)
})

test('#56 a large vault fits the budget and reports how many were folded', () => {
  const entries = Array.from({ length: 50 }, (_, index) => ({
    name: `entry-${index}`,
    kind: 'token',
    service: 's'.repeat(64),
    aliases: Array.from({ length: 8 }, (_, alias) => `${'a'.repeat(60)}${alias}`),
    url: null,
    note: null,
  }))
  const text = buildHintText(entries)
  // The budget bounds the INDEX, not the surrounding rules text.
  const indexLines = text.split('\n').filter((line) => line.startsWith('- '))
  const indexChars = indexLines.join('\n').length
  assert.ok(indexChars <= 8000 + 200, `index must respect the budget, got ${indexChars}`)
  assert.match(text, /…and \d+ more/, 'folded entries must be reported')
  // Whatever fits must actually be rendered, and the count must be honest.
  const rendered = indexLines.filter((line) => line.startsWith('- entry-')).length
  const folded = Number(text.match(/…and (\d+) more/)[1])
  assert.ok(rendered > 0)
  assert.equal(rendered + folded, entries.length, 'rendered + folded must equal the vault size')
})

// ---- #57: an edit that keeps the secret must keep the metadata too --------

import { API_BASE, createApiHandler } from '../lib/api.mjs'

/** Drive the API handler with a fake request/response pair. */
async function callApi(handler, body, path = '/set') {
  const req = {
    method: 'POST',
    url: `${API_BASE}${path}`,
    headers: { host: 'h:1', origin: 'http://h:1', 'sec-fetch-site': 'same-origin' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body))
    },
  }
  const captured = { status: 0, payload: null }
  await handler(req, {
    writeHead(status) { captured.status = status },
    end(text) { captured.payload = JSON.parse(text) },
  })
  return captured
}

test('#57 saving with an empty secret keeps every metadata field', async () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    const handler = createApiHandler({ store })

    await callApi(handler, {
      name: 'gh', kind: 'token', secret: 'v',
      service: 'github', aliases: ['gh'], username: 'root', url: 'https://x', note: 'keep me',
    })
    const before = store.get('gh')
    assert.equal(before.service, 'github')

    // The panel's edit form submits an empty secret to mean "keep the stored one".
    const edited = await callApi(handler, { name: 'gh', kind: 'token', secret: '' })
    assert.equal(edited.status, 200)
    const after = store.get('gh')
    assert.equal(after.service, 'github', 'service must survive a keep-secret edit')
    assert.deepEqual(after.aliases, ['gh'])
    assert.equal(after.username, 'root')
    assert.equal(after.url, 'https://x')
    assert.equal(after.note, 'keep me')
    assert.equal(store.reveal('gh').secret, 'v')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#57 an explicitly empty field still clears it', async () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    const handler = createApiHandler({ store })
    await callApi(handler, { name: 'gh', kind: 'token', secret: 'v', service: 'github', username: 'root' })

    await callApi(handler, { name: 'gh', kind: 'token', secret: '', service: '', username: '' })
    const after = store.get('gh')
    assert.equal(after.service, null, 'an explicit empty string must clear the field')
    assert.equal(after.username, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- #50: rotating the key must not pile up old key copies ----------------

test('#50 rotating three times leaves at most one master.key.bak', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('a', { kind: 'token', secret: 'v1' })
    for (let round = 0; round < 3; round += 1) store.rotateKey()

    const backups = readdirSync(dir).filter((name) => name.startsWith('master.key.bak'))
    assert.ok(backups.length <= 1, `expected at most one backup, found ${backups.length}: ${backups.join(', ')}`)
    // The live key must still decrypt everything.
    assert.equal(store.reveal('a').secret, 'v1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#50 a pre-existing fixed-name backup is cleaned up on the next rotation', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('a', { kind: 'token', secret: 'v1' })
    writeFileSync(join(dir, 'master.key.bak'), randomBytes(32), { mode: 0o600 })
    store.rotateKey()

    const backups = readdirSync(dir).filter((name) => name.startsWith('master.key.bak'))
    assert.ok(backups.length <= 1, `legacy backup must be cleaned, found: ${backups.join(', ')}`)
    assert.equal(store.reveal('a').secret, 'v1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
