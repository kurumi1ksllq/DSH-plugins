/** Git-host half of the concurrency suite: sha conflicts and fleet limits. */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { publishManifest } from '../lib/sync-publish.js'
import { syncPublish } from '../lib/sync-service.js'

function section(name = 'a') {
  return {
    manifestVersion: 1,
    generatedAt: 100,
    repo: 'o/r',
    ref: 'main',
    plugins: [{ kind: 'plugin', name, version: '1.0.0', source: 'npm', spec: '1.0.0', platform: 'any' }],
    mcp: [],
    skills: [],
  }
}

function snapshot(name = 'a') {
  return { packages: [{ name, spec: `npm:1.0.0`, version: '1.0.0' }], mcp: [], skills: [] }
}

function state(overrides = {}) {
  return {
    repo: 'o/r',
    ref: 'main',
    path: 'dsh-manifest.json',
    mode: 'github',
    repoUrl: '',
    token: 't',
    annotations: {},
    lastPullAt: 0,
    lastPushAt: 0,
    machineId: 'machine-a',
    ...overrides,
  }
}

test('a stale-sha contents write is a conflict, and syncPublish retries it (github)', async () => {
  // The remote holds only another machine's section (so our publish is a real
  // change), and the remote moves between our read and our write: the first
  // PUT carries the old sha and must be answered 409; the retry re-reads,
  // re-merges, and lands — the other section intact.
  let stored = JSON.stringify({ fleetVersion: 2, generatedAt: 0, machines: { 'box-b': section('b') } })
  let puts = 0
  const fetchImpl = async (url, init = {}) => {
    if (init?.method === 'PUT') {
      puts += 1
      const payload = JSON.parse(init.body)
      const doc = JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8'))
      if (puts === 1) {
        // Stale sha: someone else committed between our read and our write.
        stored = JSON.stringify({ fleetVersion: 2, generatedAt: 1, machines: { 'box-b': section('b'), 'ghost': section('g') } })
        return { ok: false, status: 409, json: async () => ({ message: 'sha does not match' }) }
      }
      stored = JSON.stringify(doc)
      return { ok: true, status: 200, json: async () => ({ content: { sha: `sha-${puts}` } }) }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ sha: 'sha-1', content: Buffer.from(stored, 'utf8').toString('base64'), encoding: 'base64' }),
    }
  }
  const result = await syncPublish({
    snapshot: snapshot('a'),
    state: state({ machineId: 'machine-a' }),
    now: 5,
    options: { fetchImpl },
  })
  assert.equal(result.ok, true)
  assert.equal(puts >= 2, true)
  const final = JSON.parse(stored)
  assert.deepEqual(Object.keys(final.machines).sort(), ['box-b', 'ghost', 'machine-a'])
})

test('publishManifest marks 409/422 as conflicts', async () => {
  const fetchImpl = async (url, init = {}) => {
    if (init?.method === 'PUT') return { ok: false, status: 422, json: async () => ({ message: 'invalid sha' }) }
    return { ok: true, status: 200, json: async () => ({ sha: 's', content: Buffer.from('{}').toString('base64'), encoding: 'base64' }) }
  }
  const result = await publishManifest({ owner: 'o', repo: 'r', token: 't', manifest: { fleetVersion: 2 }, fetchImpl })
  assert.equal(result.conflict, true)
})

test('syncPublish reports a full fleet instead of clobbering', async () => {
  const machines = {}
  for (let i = 0; i < 32; i += 1) machines[`m${i}`] = section(`p${i}`)
  const text = JSON.stringify({ fleetVersion: 2, machines })
  const fetchImpl = async (url, init = {}) => {
    if (init?.method === 'PUT') return { ok: true, status: 200, json: async () => ({ content: { sha: 'sha-2' } }) }
    return { ok: true, status: 200, json: async () => ({ sha: 's', content: Buffer.from(text, 'utf8').toString('base64'), encoding: 'base64' }) }
  }
  const result = await syncPublish({
    snapshot: snapshot('a'),
    state: state({ machineId: 'fresh' }),
    now: 6,
    options: { fetchImpl },
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /已满/)
})

test('a hard read failure before publish is reported, never blind-written over', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ message: 'write blocked' }) })
  const result = await syncPublish({
    snapshot: snapshot('a'),
    state: state(),
    now: 7,
    options: { fetchImpl },
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /发布前读取远端失败/)
})
