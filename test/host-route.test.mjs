import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, ASSIGN_ROUTE, SNAPSHOT_ROUTE } from '../index.js'

/**
 * Host-half route contract, with an empty loader/tool registry: the routes must
 * still answer, and each must refuse the wrong method.
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

test('registers one exact route per surface', () => {
  const ctx = makeContext()
  apply(ctx)
  assert.deepEqual(ctx.routes.map((route) => route.path).sort(), [ASSIGN_ROUTE, SNAPSHOT_ROUTE].sort())
  for (const route of ctx.routes) assert.equal(route.kind, 'exact')
  assert.equal(SNAPSHOT_ROUTE, '/inventory/snapshot')
  assert.equal(ASSIGN_ROUTE, '/inventory/workspace')
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

// ---- POST /inventory/workspace ------------------------------------------

function makeAssignContext({ skillName = 'demo-skill' } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'inv-route-home-'))
  const skillDir = join(home, 'skills', skillName)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${skillName}\ndescription: route fixture\n---\nbody\n`, 'utf8')
  const workspace = mkdtempSync(join(tmpdir(), 'inv-route-ws-'))
  const previous = { DSH_HOME: process.env.DSH_HOME, DSH_AGENTS_HOME: process.env.DSH_AGENTS_HOME, DSH_CUSTOM_SKILL_DIRS: process.env.DSH_CUSTOM_SKILL_DIRS }
  process.env.DSH_HOME = home
  process.env.DSH_AGENTS_HOME = join(home, 'agents')
  process.env.DSH_CUSTOM_SKILL_DIRS = ''
  const routes = []
  const ctx = {
    routes,
    baseUrl: 'file:///C:/nope/',
    logger: { warn() {}, info() {}, error() {} },
    get(name) {
      if (name === 'loader') {
        return {
          entries: () => [
            {
              id: 'mcp-officecli',
              options: {
                name: '@deepseek-ai/dsh-mcp-client',
                config: { serverName: 'officecli', transport: 'stdio', command: 'officecli', args: ['mcp'], env: { SECRET: 'x' } },
              },
            },
          ],
        }
      }
      if (name === 'tools') return { schemas: () => [] }
      if (name === 'workspaceRegistry') return { list: () => [{ id: 'ws-1', title: 'fixture', path: workspace }] }
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
  return {
    workspace,
    routes,
    route: routes.find((item) => item.path === ASSIGN_ROUTE),
    snapshotRoute: routes.find((item) => item.path === SNAPSHOT_ROUTE),
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    },
  }
}

async function post(handler, body, { method = 'POST' } = {}) {
  const emitter = new EventEmitter()
  let status = 0
  let text = ''
  const req = { method, url: ASSIGN_ROUTE, on: (event, fn) => emitter.on(event, fn) }
  const res = {
    writeHead(code) {
      status = code
    },
    end(chunk) {
      text = chunk ?? ''
    },
  }
  const pending = handler(req, res)
  if (method === 'POST') {
    emitter.emit('data', Buffer.from(JSON.stringify(body)))
    emitter.emit('end')
  }
  await pending
  return { status, body: text.length > 0 ? JSON.parse(text) : null }
}

test('assign route rejects the wrong method and malformed bodies', async () => {
  const fixture = makeAssignContext()
  try {
    assert.equal((await post(fixture.route.handler, null, { method: 'GET' })).status, 405)
    assert.equal((await post(fixture.route.handler, { kind: 'nope', action: 'add', name: 'x', workspace: fixture.workspace })).status, 400)
    assert.equal((await post(fixture.route.handler, { kind: 'mcp', action: 'nope', name: 'x', workspace: fixture.workspace })).status, 400)
    assert.equal((await post(fixture.route.handler, { kind: 'mcp', action: 'add', name: '', workspace: fixture.workspace })).status, 400)
    const unregistered = await post(fixture.route.handler, { kind: 'mcp', action: 'add', name: 'officecli', workspace: 'C:/not/a/workspace' })
    assert.equal(unregistered.status, 404)
    assert.match(unregistered.body.error, /未登记/)
    const unknown = await post(fixture.route.handler, { kind: 'mcp', action: 'add', name: 'ghost', workspace: fixture.workspace })
    assert.equal(unknown.status, 404)
    assert.match(unknown.body.error, /没有已安装的 MCP/)
  } finally {
    fixture.restore()
  }
})

test('assigning an MCP writes the declaration and invalidates the snapshot cache', async () => {
  const fixture = makeAssignContext()
  try {
    // Prime the cache, then write: the next GET must show the new declaration.
    const before = await call(fixture.snapshotRoute.handler, { method: 'GET', url: `${SNAPSHOT_ROUTE}?refresh=1` })
    assert.equal(before.body.workspaces[0].mcp.status, 'missing')

    const added = await post(fixture.route.handler, { kind: 'mcp', action: 'add', name: 'officecli', workspace: fixture.workspace })
    assert.equal(added.status, 200)
    assert.equal(added.body.ok, true)
    assert.equal(existsSync(join(fixture.workspace, '.dsh', 'mcp.json')), true)

    const after = await call(fixture.snapshotRoute.handler, { method: 'GET', url: SNAPSHOT_ROUTE })
    assert.equal(after.body.workspaces[0].mcp.status, 'ok')
    assert.equal(after.body.workspaces[0].mcp.servers[0].name, 'officecli')

    const removed = await post(fixture.route.handler, { kind: 'mcp', action: 'remove', name: 'officecli', workspace: fixture.workspace })
    assert.equal(removed.status, 200)
    assert.equal(existsSync(join(fixture.workspace, '.dsh', 'mcp.json')), false)
  } finally {
    fixture.restore()
  }
})

test('assigning a skill links it into the workspace project root', async () => {
  const fixture = makeAssignContext({ skillName: 'demo-skill' })
  try {
    const added = await post(fixture.route.handler, { kind: 'skill', action: 'add', name: 'demo-skill', workspace: fixture.workspace })
    assert.equal(added.status, 200)
    assert.equal(added.body.path, join(fixture.workspace, '.dsh', 'skills', 'demo-skill'))

    const snapshot = await call(fixture.snapshotRoute.handler, { method: 'GET', url: `${SNAPSHOT_ROUTE}?refresh=1` })
    const projectDsh = snapshot.body.workspaces[0].skills.find((group) => group.source === 'project-dsh')
    assert.deepEqual(projectDsh.skills.map((skill) => skill.name), ['demo-skill'])

    const removed = await post(fixture.route.handler, { kind: 'skill', action: 'remove', name: 'demo-skill', workspace: fixture.workspace })
    assert.equal(removed.status, 200)

    const unknown = await post(fixture.route.handler, { kind: 'skill', action: 'add', name: 'nope', workspace: fixture.workspace })
    assert.equal(unknown.status, 404)
  } finally {
    fixture.restore()
  }
})
