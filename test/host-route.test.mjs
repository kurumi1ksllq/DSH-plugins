import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply, SNAPSHOT_ROUTE } from '../index.js'

/**
 * Host-half route contract, with an empty loader/tool registry: the route must
 * still answer, and it must refuse anything but GET.
 */

function makeContext() {
  const routes = []
  return {
    routes,
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

test('registers exactly one exact-match route', () => {
  const ctx = makeContext()
  apply(ctx)
  assert.equal(ctx.routes.length, 1)
  assert.equal(ctx.routes[0].kind, 'exact')
  assert.equal(ctx.routes[0].path, SNAPSHOT_ROUTE)
  assert.equal(SNAPSHOT_ROUTE, '/inventory/snapshot')
})

test('rejects non-GET methods with 405', async () => {
  const ctx = makeContext()
  apply(ctx)
  const { status, body } = await call(ctx.routes[0].handler, { method: 'POST', url: SNAPSHOT_ROUTE })
  assert.equal(status, 405)
  assert.equal(body.error, 'method-not-allowed')
})

test('serves a well-formed empty snapshot when nothing is composed or registered', async () => {
  const ctx = makeContext()
  apply(ctx)
  const { status, body } = await call(ctx.routes[0].handler, { method: 'GET', url: `${SNAPSHOT_ROUTE}?refresh=1` })
  assert.equal(status, 200)
  for (const key of ['packages', 'rows', 'mcp', 'skills', 'tools', 'edges', 'warnings', 'counts']) {
    assert.ok(key in body, `missing ${key}`)
  }
  assert.equal(body.rows.length, 0)
  assert.equal(body.mcp.length, 0)
  assert.equal(body.tools.length, 0)
  assert.equal(typeof body.generatedAt, 'number')
})

test('a missing webServer service is reported, not thrown', () => {
  const warnings = []
  apply({ logger: { warn: (message) => warnings.push(message) } })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /webServer/)
})

test('tool inventory unions the global plane with the live agent plane', async () => {
  const routes = []
  const agent = { id: 'agent-1' }
  const ctx = {
    baseUrl: 'file:///C:/nope/',
    logger: { warn() {}, info() {}, error() {} },
    get(name) {
      if (name === 'loader') return { entries: () => [] }
      if (name === 'agents') return { list: () => [agent] }
      if (name === 'tools') {
        return {
          schemas(scope) {
            // Core tools live on the agent plane; the global view cannot see them.
            if (scope === agent) return [{ name: 'read' }, { name: 'pwsh' }, { name: 'mcp__x__y' }]
            if (scope === undefined) return [{ name: 'mcp__x__y' }, { name: 'job_list' }]
            return []
          },
        }
      }
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
  const { status, body } = await call(routes[0].handler, { method: 'GET', url: '/inventory/snapshot?refresh=1' })
  assert.equal(status, 200)
  const names = body.tools.map((tool) => tool.name)
  assert.ok(names.includes('read'), `agent-plane tool missing: ${names.join(',')}`)
  assert.ok(names.includes('pwsh'), 'agent-plane tool missing')
  assert.ok(names.includes('job_list'), 'global-plane tool missing')
  assert.ok(names.includes('mcp__x__y'), 'shared tool missing')
  assert.equal(names.filter((name) => name === 'mcp__x__y').length, 1, 'duplicate tool row')
  assert.ok(body.toolPlanes.some((plane) => plane.plane === 'agent'))
})

test('a throwing collector surfaces as a 500 with an error payload', async () => {
  const routes = []
  apply({
    baseUrl: 'file:///C:/nope/',
    logger: { warn() {}, info() {}, error() {} },
    get(name) {
      if (name === 'loader') throw new Error('loader exploded')
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
  })
  const { status, body } = await call(routes[0].handler, { method: 'GET', url: '/inventory/snapshot?refresh=1' })
  assert.equal(status, 500)
  assert.equal(body.error, 'snapshot-failed')
  assert.match(body.message, /loader exploded/)
})
