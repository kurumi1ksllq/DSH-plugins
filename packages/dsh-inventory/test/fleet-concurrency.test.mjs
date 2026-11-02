/**
 * Fleet concurrency: simulated simultaneous publishes over emulated
 * transports, the CAS retry loops, and the failure modes the panel must show
 * honestly. Companion to `fleet.test.mjs` (document semantics).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fleetHasMachine, machineIds, parseFleetDocument } from '../lib/fleet.js'
import { publishHttp, publishManifest } from '../lib/sync-publish.js'
import { syncPublish } from '../lib/sync-service.js'

function section() {
  return {
    manifestVersion: 1,
    generatedAt: 100,
    repo: 'o/r',
    ref: 'main',
    plugins: [{ kind: 'plugin', name: 'a', version: '1.0.0', source: 'npm', spec: '1.0.0', platform: 'any' }],
    mcp: [],
    skills: [],
  }
}

const SNAPSHOT = {
  packages: [{ name: 'a', spec: 'npm:1.0.0', version: '1.0.0' }],
  mcp: [],
  skills: [],
}

function state(overrides = {}) {
  return {
    repo: 'http://endpoint/dsh-manifest.json',
    ref: 'main',
    path: 'dsh-manifest.json',
    mode: 'http',
    repoUrl: '',
    token: 't',
    annotations: {},
    lastPullAt: 0,
    lastPushAt: 0,
    machineId: 'machine-a',
    ...overrides,
  }
}

/**
 * An endpoint emulator with real ETag semantics: GET returns the document and
 * its ETag; PUT with If-Match either lands (204 + new ETag) or conflicts (412).
 * This is the object the whole feature stands on.
 */
function httpEndpoint(initial = null) {
  let body = initial
  let etag = initial === null ? null : '"e0"'
  const calls = { get: 0, put: 0, conflicts: 0 }
  const fetchImpl = async (url, init = {}) => {
    if (init?.method === 'PUT') {
      calls.put += 1
      const ifMatch = init.headers?.['If-Match']
      if (typeof ifMatch === 'string' && ifMatch.length > 0) {
        if (ifMatch !== etag) {
          calls.conflicts += 1
          return { ok: false, status: 412, text: async () => 'precondition failed' }
        }
      }
      body = init.body
      etag = `"e${calls.put}"`
      return { ok: true, status: 204, text: async () => '' }
    }
    calls.get += 1
    if (body === null) return { ok: false, status: 404, text: async () => '' }
    // Snapshot the ETag into the response at construction time, the way a real
    // HTTP response carries it: a lazy closure here would let a write that
    // lands mid-race retroactively change the tag the client already received,
    // and the conflict under test would never happen.
    const etagSnapshot = etag
    const bodySnapshot = body
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name.toLowerCase() === 'etag' ? etagSnapshot : null) },
      text: async () => bodySnapshot,
    }
  }
  return { fetchImpl, calls, current: () => body }
}

test('two machines publishing in sequence both keep their sections (http)', async () => {
  const endpoint = httpEndpoint()
  const first = await syncPublish({ snapshot: SNAPSHOT, state: state({ machineId: 'machine-a' }), now: 1, options: { fetchImpl: endpoint.fetchImpl } })
  assert.equal(first.ok, true)
  const second = await syncPublish({ snapshot: SNAPSHOT, state: state({ machineId: 'machine-b' }), now: 2, options: { fetchImpl: endpoint.fetchImpl } })
  assert.equal(second.ok, true)
  const parsed = parseFleetDocument(endpoint.current())
  assert.deepEqual(machineIds(parsed.fleet).sort(), ['machine-a', 'machine-b'])
})

test('an interleaved publish hits 412, retries, and keeps every section (http)', async () => {
  // The endpoint already holds machine-a's section. A "ghost" writer wins a
  // whole read+write cycle between machine-b's read and machine-b's PUT:
  // machine-b must see one 412, re-read the ghost's document, re-merge, and
  // land — without erasing the ghost or machine-a.
  const endpoint = httpEndpoint(JSON.stringify({
    fleetVersion: 2,
    generatedAt: 0,
    machines: { 'machine-a': section() },
  }))
  // The ghost is a well-behaved fleet member: it starts from the real
  // endpoint's current document (machine-a's section already there), merges
  // its own section in, and wins a full read+write cycle mid-race. Its
  // document is what machine-b's stale If-Match then collides with.
  const ghost = httpEndpoint(endpoint.current())
  const ghostResult = await syncPublish({ snapshot: SNAPSHOT, state: state({ machineId: 'ghost' }), now: 0, options: { fetchImpl: ghost.fetchImpl } })
  assert.equal(ghostResult.ok, true)
  assert.deepEqual(Object.keys(JSON.parse(ghost.current()).machines).sort(), ['ghost', 'machine-a'])

  let raceArmed = false
  const racing = {
    fetchImpl: async (url, init = {}) => {
      const isPut = init?.method === 'PUT'
      if (!isPut && !raceArmed) {
        // machine-b's read. The response body is read lazily (`response.text()`
        // happens back in the caller), so the ghost's write must be injected
        // INSIDE that lazy read: that is the only point that is both after our
        // read started and before we use the result. Injecting it after
        // returning would let machine-b pick up the ghost's ETag and its body
        // together — no conflict, and the test would prove nothing.
        raceArmed = true
        const response = await endpoint.fetchImpl(url, init)
        return {
          ...response,
          text: async () => {
            const body = await response.text()
            const landed = await endpoint.fetchImpl(url, { method: 'PUT', headers: {}, body: ghost.current() })
            assert.equal(landed.ok, true)
            return body
          },
        }
      }
      return endpoint.fetchImpl(url, init)
    },
  }
  const result = await syncPublish({
    snapshot: SNAPSHOT,
    state: state({ machineId: 'machine-b' }),
    now: 3,
    options: { fetchImpl: racing.fetchImpl },
  })
  assert.equal(result.ok, true)
  assert.equal(endpoint.calls.conflicts >= 1, true)
  const parsed = parseFleetDocument(endpoint.current())
  assert.equal(fleetHasMachine(parsed.fleet, 'ghost'), true)
  assert.equal(fleetHasMachine(parsed.fleet, 'machine-b'), true)
  assert.equal(fleetHasMachine(parsed.fleet, 'machine-a'), true)
})

test('publishHttp sends If-Match from the read ETag and reports 412 as a conflict', async () => {
  const seen = []
  const fetchImpl = async (url, init = {}) => {
    if (init?.method === 'PUT') {
      seen.push(init.headers?.['If-Match'])
      return { ok: false, status: 412, text: async () => '' }
    }
    return { ok: true, status: 200, headers: { get: () => '"current"' }, text: async () => '{}' }
  }
  const result = await publishHttp({ url: 'http://x/m.json', token: 't', manifest: { fleetVersion: 2 }, etag: '"current"', fetchImpl })
  assert.equal(result.conflict, true)
  assert.deepEqual(seen, ['"current"'])
})

test('an endpoint that ignores If-Match is caught by the post-write verification', async () => {
  // This endpoint accepts any PUT (204) but always answers GET with the other
  // machine's document, so machine-b's section never survives a write. The
  // verify pass must catch it and exhaust the attempts instead of lying.
  const fetchImpl = async (url, init = {}) => {
    if (init?.method === 'PUT') return { ok: true, status: 204, text: async () => '' }
    return {
      ok: true,
      status: 200,
      headers: { get: () => '"v"' },
      text: async () => JSON.stringify({ fleetVersion: 2, generatedAt: 0, machines: { other: section() } }),
    }
  }
  const result = await syncPublish({
    snapshot: SNAPSHOT,
    state: state({ machineId: 'machine-b' }),
    now: 4,
    options: { fetchImpl },
  })
  assert.equal(result.ok, false)
  assert.equal(result.conflict, true)
  assert.match(result.error, /发布冲突/)
})

test('publishHttp without an ETag still writes (endpoint with no validator)', async () => {
  const seen = []
  const fetchImpl = async (url, init = {}) => {
    if (init?.method === 'PUT') {
      seen.push(init.headers?.['If-Match'])
      return { ok: true, status: 204, text: async () => '' }
    }
    return { ok: false, status: 404, text: async () => '' }
  }
  const result = await publishHttp({ url: 'http://x/m.json', token: 't', manifest: { fleetVersion: 2 }, fetchImpl })
  assert.equal(result.ok, true)
  assert.equal(seen[0], undefined)
})
