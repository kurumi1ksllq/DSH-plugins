/**
 * Regression test for the open sync issue:
 *   #11  index.js claims the sync handlers read the cached snapshot, but every
 *        one of them forced `refresh: true` — a full rebuild per panel poll.
 *
 * The sync status route answers with an empty diff unless a repository is
 * configured, so the rebuild it performed is observed on the snapshot route
 * instead: the snapshot carries `generatedAt`, which only advances when a
 * rebuild happened. Serving the cache therefore freezes it; a rebuild moves it.
 *
 * The cache is module-level state, so every case here starts from a cold cache
 * (the snapshot route with `?refresh=1` is the one path allowed to force one).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, SNAPSHOT_ROUTE, SYNC_ROUTE } from '../index.js'

/** A context with an empty loader/tool registry and a throwaway base URL. */
function makeContext(routes) {
  return {
    baseUrl: 'file:///C:/does-not-exist-profile/',
    logger: { warn() {}, info() {}, error() {} },
    get(name) {
      if (name === 'loader') return { entries: () => [] }
      if (name === 'tools') return { schemas: () => [] }
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
}

async function call(handler, request) {
  let status = 0
  let body = ''
  await handler(request, {
    writeHead(code) {
      status = code
    },
    end(chunk) {
      body = chunk ?? ''
    },
  })
  return { status, body: body.length > 0 ? JSON.parse(body) : null }
}

/**
 * A request with a body: the route reads `data` / `end` events off the request,
 * so a POST fixture has to look like an EventEmitter that has a body queued.
 */
function requestBody(text, extra = {}) {
  const emitter = new EventEmitter()
  emitter.headers = {}
  emitter.destroy = () => {}
  for (const [key, value] of Object.entries(extra)) emitter[key] = value
  // Emit on the next tick so the route's listeners are attached first.
  setImmediate(() => {
    emitter.emit('data', Buffer.from(text, 'utf8'))
    emitter.emit('end')
  })
  return emitter
}

function handlerFor(routes, path) {
  const route = routes.find((r) => r.path === path)
  assert.ok(route !== undefined, `route ${path} must be registered`)
  return route.handler
}

/**
 * Run `fn` with the DSH home pointed at a throwaway directory, then restore the
 * environment. The snapshot and the sync state file both live under the home,
 * so a test must never touch the developer's real one.
 */
async function withHome(fn) {
  const saved = { DSH_HOME: process.env.DSH_HOME, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
  const home = mkdtempSync(join(tmpdir(), 'inv-sync-cache-'))
  process.env.DSH_HOME = home
  process.env.HOME = home
  try {
    return await fn(home)
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/** Write a vaulted skill under the throwaway home. */
function writeVaultedSkill(home, name) {
  const dir = join(home, 'inventory', 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: cache fixture\n---\nbody\n`, 'utf8')
}

/**
 * Poll the sync status route, then report the snapshot timestamp it left
 * behind. A poll that rebuilt leaves a fresh `generatedAt`; a poll served from
 * the cache leaves the previous one, because nothing rebuilt the snapshot.
 */
async function pollThenReadSnapshot(routes) {
  const poll = await call(handlerFor(routes, SYNC_ROUTE), { method: 'GET', url: SYNC_ROUTE })
  assert.equal(poll.status, 200)
  const snap = await call(handlerFor(routes, SNAPSHOT_ROUTE), { method: 'GET', url: SNAPSHOT_ROUTE })
  assert.equal(snap.status, 200)
  return { poll: poll.body, generatedAt: snap.body.generatedAt }
}

test('#11 the sync status route serves the cached snapshot instead of rebuilding', async () => {
  await withHome(async (home) => {
    const routes = []
    apply(makeContext(routes))
    writeVaultedSkill(home, 'first-skill')

    // Cold cache: the first poll has to build one.
    const first = await pollThenReadSnapshot(routes)
    assert.equal(first.poll.capabilities.canPull, false, 'no repository is configured in this fixture')
    const cold = first.generatedAt

    // Nothing on disk changed that this plugin was told about. A second poll
    // must reuse that snapshot rather than pay for another full scan — which is
    // exactly what the issue reports the handlers never did.
    const second = await pollThenReadSnapshot(routes)
    assert.equal(second.generatedAt, cold, 'a polling sync status must not rebuild the snapshot')

    // The payload the poll returns is unaffected by serving it from cache.
    assert.deepEqual(second.poll.counts, first.poll.counts)
  })
})

test('#11 an explicit refresh request still rebuilds the snapshot', async () => {
  await withHome(async () => {
    const routes = []
    apply(makeContext(routes))

    const first = await pollThenReadSnapshot(routes)
    const refreshed = await call(handlerFor(routes, SNAPSHOT_ROUTE), { method: 'GET', url: `${SNAPSHOT_ROUTE}?refresh=1` })
    assert.equal(refreshed.status, 200)
    assert.ok(refreshed.body.generatedAt >= first.generatedAt,
      'refresh=1 is the escape hatch and must stay able to rebuild')
  })
})

test('#11 a write that invalidates the cache brings the next poll a fresh snapshot', async () => {
  await withHome(async () => {
    const routes = []
    apply(makeContext(routes))
    const stale = (await pollThenReadSnapshot(routes)).generatedAt

    // Saving the sync configuration is a write on this plugin's own state; the
    // panel expects the next poll to reflect it rather than a frozen snapshot.
    const saved = await call(handlerFor(routes, `${SYNC_ROUTE}/config`),
      requestBody(JSON.stringify({ ref: 'trunk' }), { method: 'POST', url: `${SYNC_ROUTE}/config` }))
    assert.equal(saved.status, 200, JSON.stringify(saved.body))

    const after = await call(handlerFor(routes, SYNC_ROUTE), { method: 'GET', url: SYNC_ROUTE })
    assert.equal(after.status, 200)
    assert.equal(after.body.state.ref, 'trunk', 'the poll reports the state it just saved')
    assert.ok(stale > 0)
  })
})

test('#11 the sync status route still refuses non-GET methods', async () => {
  await withHome(async () => {
    const routes = []
    apply(makeContext(routes))
    const { status, body } = await call(handlerFor(routes, SYNC_ROUTE), { method: 'POST', url: SYNC_ROUTE })
    assert.equal(status, 405)
    assert.equal(body.error, 'method-not-allowed')
  })
})
