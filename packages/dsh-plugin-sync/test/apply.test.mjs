/**
 * Wiring tests for `apply()`: route registration, the off switch, and the
 * guarantee that a missing web server does not throw.
 *
 * The fake context registers effects eagerly and records routes, so these
 * tests never boot a harness. `skipBoot: true` keeps every case off the
 * network: the boot check is the only thing that would clone.
 *
 * Run: node --test test/*.test.mjs
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { apply, CHECK_ROUTE, STATE_ROUTE, inject, name } from '../index.js'

/** A Cordis-ish context that runs effects immediately and records routes. */
function makeCtx({ withWebServer = true } = {}) {
  const routes = []
  const infos = []
  const warnings = []
  const cleanups = []
  const ctx = {
    logger: { info: (m) => infos.push(m), warn: (m) => warnings.push(m) },
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
      return () => {}
    },
    webServer: withWebServer
      ? {
          register: (route) => {
            routes.push(route)
            return () => {}
          },
        }
      : undefined,
  }
  return { ctx, routes, infos, warnings, cleanups }
}

/** Minimal request/response pair that captures the JSON a handler writes. */
function callRoute(route) {
  let status
  let body
  const res = {
    writeHead: (code) => {
      status = code
    },
    end: (chunk) => {
      body = chunk
    },
  }
  return Promise.resolve(route.handler({ method: 'GET', url: route.path }, res)).then(() => ({
    status,
    json: body === undefined ? undefined : JSON.parse(body),
  }))
}

describe('apply', () => {
  it('declares the bundle name and its web-server dependency', () => {
    assert.equal(name, 'dsh-plugin-sync')
    assert.deepEqual(inject, ['webServer'])
  })

  it('exposes the two documented routes', () => {
    assert.equal(STATE_ROUTE, '/plugin-sync/state')
    assert.equal(CHECK_ROUTE, '/plugin-sync/check')
  })

  it('idles without touching the network when no repo is configured', () => {
    const { ctx, routes, infos } = makeCtx()
    apply(ctx, {})
    assert.deepEqual(routes, [])
    assert.equal(infos.length, 1)
    assert.match(infos[0], /no repo configured, idle/)
  })

  it('registers both routes once a repo is configured', () => {
    const { ctx, routes } = makeCtx()
    apply(ctx, { repo: 'https://example.invalid/repo.git', skipBoot: true })
    assert.deepEqual(routes.map((r) => r.path).sort(), [CHECK_ROUTE, STATE_ROUTE])
    assert.ok(routes.every((r) => r.kind === 'exact'))
  })

  it('reports idle before the first check has run', async () => {
    const { ctx, routes } = makeCtx()
    apply(ctx, { repo: 'https://example.invalid/repo.git', skipBoot: true })
    const state = routes.find((r) => r.path === STATE_ROUTE)
    const { status, json } = await callRoute(state)
    assert.equal(status, 200)
    assert.equal(json.idle, true)
    assert.equal(json.repo, 'https://example.invalid/repo.git')
    assert.equal(json.apply, false)
  })

  it('does not throw when the web server service is absent', () => {
    const { ctx, routes } = makeCtx({ withWebServer: false })
    apply(ctx, { repo: 'https://example.invalid/repo.git', skipBoot: true })
    assert.deepEqual(routes, [])
  })

  it('schedules the boot check unless skipBoot is set', () => {
    const { ctx, cleanups } = makeCtx({ withWebServer: false })
    apply(ctx, { repo: 'https://example.invalid/repo.git' })
    // The effect returns a disposer that clears the pending timer.
    assert.equal(cleanups.length, 1)
    assert.equal(typeof cleanups[0], 'function')
    cleanups[0]()
  })

  it('registers no boot effect when skipBoot is true', () => {
    const { ctx, cleanups } = makeCtx({ withWebServer: false })
    apply(ctx, { repo: 'https://example.invalid/repo.git', skipBoot: true })
    assert.deepEqual(cleanups, [])
  })
})
