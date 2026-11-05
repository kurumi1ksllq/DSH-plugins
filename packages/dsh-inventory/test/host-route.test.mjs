import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dshHome } from '../lib/dsh-home.js'

import {
  apply,
  ASSIGN_ROUTE,
  GLOBAL_ROUTE,
  SNAPSHOT_ROUTE,
  PLUGIN_UPDATE_APPLY_ROUTE,
  PLUGIN_UPDATE_ROUTE,
  SYNC_APPLY_ROUTE,
  SYNC_CONFIG_ROUTE,
  SYNC_PREVIEW_ROUTE,
  SYNC_ROUTE,
  VAULT_ROUTE,
} from '../index.js'

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
  assert.deepEqual(
    ctx.routes.map((route) => route.path).sort(),
    [
      ASSIGN_ROUTE,
      GLOBAL_ROUTE,
      SNAPSHOT_ROUTE,
      SYNC_APPLY_ROUTE,
      SYNC_CONFIG_ROUTE,
      SYNC_PREVIEW_ROUTE,
      SYNC_ROUTE,
      VAULT_ROUTE,
      PLUGIN_UPDATE_ROUTE,
      PLUGIN_UPDATE_APPLY_ROUTE,
    ].sort(),
  )
  for (const route of ctx.routes) assert.equal(route.kind, 'exact')
  assert.equal(SNAPSHOT_ROUTE, '/inventory/snapshot')
  assert.equal(ASSIGN_ROUTE, '/inventory/workspace')
  assert.equal(GLOBAL_ROUTE, '/inventory/global')
  assert.equal(VAULT_ROUTE, '/inventory/vault')
  assert.equal(SYNC_ROUTE, '/inventory/sync')
  assert.equal(SYNC_CONFIG_ROUTE, '/inventory/sync/config')
  assert.equal(SYNC_PREVIEW_ROUTE, '/inventory/sync/preview')
  assert.equal(SYNC_APPLY_ROUTE, '/inventory/sync/apply')
  assert.equal(PLUGIN_UPDATE_ROUTE, '/inventory/plugin-update')
  assert.equal(PLUGIN_UPDATE_APPLY_ROUTE, '/inventory/plugin-update/apply')
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
  // The global-toggle capability is always reported, even when nothing is mounted.
  assert.equal(typeof body.globalToggle.mcp, 'boolean')
  assert.equal(typeof body.globalToggle.skill, 'boolean')
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

function makeAssignContext({ skillName = 'demo-skill', scope = 'vault' } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'inv-route-home-'))
  // `vault` is the only scope a workspace link may target; `global` is a
  // machine-wide root that every workspace already sees.
  const skillDir = scope === 'global' ? join(home, 'skills', skillName) : join(home, 'inventory', 'skills', skillName)
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
      if (fixture.registryOverride !== undefined && name === 'workspaceRegistry') return fixture.registryOverride
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
  const fixture = {
    workspace,
    routes,
    ctx,
    route: routes.find((item) => item.path === ASSIGN_ROUTE),
    snapshotRoute: routes.find((item) => item.path === SNAPSHOT_ROUTE),
    registryOverride: undefined,
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    },
  }
  return fixture
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

/**
 * Issue #71: the snapshot must read the gate row's `serverNameSuffix` back
 * from the loader (index.js reads the `dsh-inventory/gate` row's config), so
 * the panel's `mountedAs` matches what the gate will actually mount — the
 * contract README:303 promises. A broken read-back must turn this red.
 */
test('the snapshot carries the gate suffix on mcp rows and as a top-level field', async () => {
  const fixture = makeAssignContext()
  try {
    // Wrap get() so the loader also reports the gate row with a suffix config.
    const get = fixture.ctx.get.bind(fixture.ctx)
    fixture.ctx.get = (name) => {
      if (name === 'loader') {
        return {
          entries: () => [
            ...get(name).entries(),
            {
              id: 'inventory-gate',
              options: { name: 'dsh-inventory/gate', config: { serverNameSuffix: '-ws' } },
            },
          ],
        }
      }
      return get(name)
    }

    const added = await post(fixture.route.handler, { kind: 'mcp', action: 'add', name: 'officecli', workspace: fixture.workspace })
    assert.equal(added.status, 200)

    const snapshot = await call(fixture.snapshotRoute.handler, { method: 'GET', url: `${SNAPSHOT_ROUTE}?refresh=1` })
    assert.equal(snapshot.body.gateServerNameSuffix, '-ws', 'the suffix must be read back from the gate row')
    const row = snapshot.body.workspaces[0].mcp.servers.find((server) => server.name === 'officecli')
    assert.ok(row, 'the declaration must be listed')
    assert.equal(row.mountedAs, 'officecli-ws', 'mountedAs must carry the same suffix the gate will use')
  } finally {
    fixture.restore()
  }
})

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

/**
 * Issue #72: the snapshot synthesizes the default workspace from
 * `$DSH_HOME/storages/workspace.json` when the registry does not list it, but
 * `findWorkspace` only matched the registry — the card was visible while its
 * switches always answered 404. The write path must fall back to the same
 * default record (and relink must cover it) so every card the panel shows can
 * complete an add/remove round trip.
 */
test('the synthesized default workspace is assignable when the registry omits it', async () => {
  const fixture = makeAssignContext()
  try {
    // Simulate a registry outage: an empty list, plus a default-workspace
    // record in DSH storage that only the snapshot's synthesis reads.
    fixture.registryOverride = { list: () => [] }
    mkdirSync(join(fixture.workspace, 'storages'), { recursive: true })
    writeFileSync(
      join(fixture.workspace, 'storages', 'workspace.json'),
      JSON.stringify({ global: { defaultWorkspaceId: 'default-ws' }, tables: { workspaces: { 'default-ws': { path: fixture.workspace, title: 'default' } } } }),
    )
    // DSH_HOME must point at the storage the snapshot reads.
    process.env.DSH_HOME = fixture.workspace

    const snapshot = await call(fixture.snapshotRoute.handler, { method: 'GET', url: `${SNAPSHOT_ROUTE}?refresh=1` })
    const card = snapshot.body.workspaces.find((entry) => entry.id === 'default-ws')
    assert.ok(card !== undefined, 'the default workspace must be synthesized into the snapshot')
    assert.equal(card.default, true)

    const added = await post(fixture.route.handler, { kind: 'mcp', action: 'add', name: 'officecli', workspace: fixture.workspace })
    assert.equal(added.status, 200, `the default workspace must be assignable, got: ${JSON.stringify(added.body)}`)

    const removed = await post(fixture.route.handler, { kind: 'mcp', action: 'remove', name: 'officecli', workspace: fixture.workspace })
    assert.equal(removed.status, 200)
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

/**
 * A skill on `$DSH_HOME/skills` is served to every workspace by the skill
 * filesystem provider. Linking it into a project root is not "enable it here":
 * it duplicates the skill (rank 100 shadows rank 400), and for a globally
 * shadowed skill the link points at the same `disable-model-invocation: true`
 * file, so the switch would read "on" while the model still cannot see it.
 */
test('assign route refuses to link a skill that a global root already serves', async () => {
  const fixture = makeAssignContext({ skillName: 'global-skill', scope: 'global' })
  try {
    const added = await post(fixture.route.handler, { kind: 'skill', action: 'add', name: 'global-skill', workspace: fixture.workspace })
    assert.equal(added.status, 400)
    assert.match(added.body.error, /全局根/)
    assert.equal(existsSync(join(fixture.workspace, '.dsh', 'skills', 'global-skill')), false, 'no link may be written')
  } finally {
    fixture.restore()
  }
})

// ---- POST /inventory/global ---------------------------------------------

const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client'

function writeSkillFixture(root, name, description) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'SKILL.md')
  writeFileSync(path, `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\nbody\n`, 'utf8')
  return path
}

/**
 * A profile-shaped context for the global toggle route: one global MCP row, one
 * user skill, one project skill, an optional runtime skill, and a profile patch
 * file. The process cwd moves into the temp project so the project skill roots
 * resolve there instead of inside this repository.
 */
function makeGlobalContext({
  pluginManager,
  mcpServers = [{ id: 'mcp-officecli', server: 'officecli' }],
  runtimeSkills = [],
} = {}) {
  const home = mkdtempSync(join(tmpdir(), 'inv-global-home-'))
  const userSkillFile = writeSkillFixture(join(home, 'skills'), 'demo-skill', 'global fixture')

  const projectDir = mkdtempSync(join(tmpdir(), 'inv-global-project-'))
  const projectSkillFile = writeSkillFixture(join(projectDir, '.dsh', 'skills'), 'project-skill', 'project fixture')

  const profileDir = mkdtempSync(join(tmpdir(), 'inv-global-profile-'))
  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify({ name: 'fixture-profile', dependencies: {}, dsh: { profile: { bundles: [] } } }),
  )
  const patchPath = join(profileDir, 'cordis.patch.yml')
  writeFileSync(patchPath, '# profile patch (fixture)\n- id: dsh-inventory\n  disabled: false\n', 'utf8')

  const previous = {
    DSH_HOME: process.env.DSH_HOME,
    DSH_AGENTS_HOME: process.env.DSH_AGENTS_HOME,
    DSH_CUSTOM_SKILL_DIRS: process.env.DSH_CUSTOM_SKILL_DIRS,
    DSH_BUNDLED_SKILL_DIR: process.env.DSH_BUNDLED_SKILL_DIR,
    cwd: process.cwd(),
  }
  process.env.DSH_HOME = home
  process.env.DSH_AGENTS_HOME = join(home, 'agents')
  process.env.DSH_CUSTOM_SKILL_DIRS = ''
  delete process.env.DSH_BUNDLED_SKILL_DIR
  process.chdir(projectDir)

  const calls = []
  const entries = mcpServers.map(({ id, server, disabled = false }) => ({
    id,
    disabled,
    options: { name: MCP_CLIENT, config: { serverName: server, transport: 'stdio', command: 'fixture-mcp' } },
  }))
  // A real plugin manager flips the live loader row; the fixture must too, or
  // the route's post-write readback cannot report `live: true`.
  const pluginManagerService =
    pluginManager === undefined
      ? undefined
      : {
          setPluginEnabled(id, enabled) {
            calls.push([id, enabled])
            const entry = entries.find((item) => item.id === id)
            if (entry !== undefined) entry.disabled = !enabled
            return pluginManager.setPluginEnabled(id, enabled)
          },
        }
  const routes = []
  const ctx = {
    routes,
    calls,
    baseUrl: pathToFileURL(profileDir).href,
    logger: { warn() {}, info() {}, error() {} },
    get(name) {
      if (name === 'loader') return { entries: () => entries }
      if (name === 'tools') return { schemas: () => [] }
      if (name === 'pluginManager') return pluginManagerService
      if (name === 'profileContext') return { patchPath }
      if (name === 'skills') {
        return {
          list: async () => runtimeSkills,
          get: async (skillName) => ({ name: skillName, body: '' }),
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
  return {
    ctx,
    routes,
    calls,
    home,
    projectDir,
    profileDir,
    patchPath,
    userSkillFile,
    projectSkillFile,
    route: routes.find((item) => item.path === GLOBAL_ROUTE),
    snapshotRoute: routes.find((item) => item.path === SNAPSHOT_ROUTE),
    restore() {
      process.chdir(previous.cwd)
      for (const key of ['DSH_HOME', 'DSH_AGENTS_HOME', 'DSH_CUSTOM_SKILL_DIRS', 'DSH_BUNDLED_SKILL_DIR']) {
        const value = previous[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    },
  }
}

test('global route rejects the wrong method and malformed bodies', async () => {
  const fixture = makeGlobalContext()
  try {
    assert.equal((await post(fixture.route.handler, null, { method: 'GET' })).status, 405)
    assert.equal((await post(fixture.route.handler, null, { method: 'PUT' })).status, 405)

    const invalid = [
      { kind: 'nope', name: 'officecli', enabled: false },
      { kind: 'mcp', name: 'officecli', enabled: 'false' },
      { kind: 'mcp', name: 'officecli', enabled: 0 },
      { kind: 'mcp', name: 'officecli' },
      { kind: 'mcp', name: '', enabled: false },
      { kind: 'mcp', name: '   ', enabled: false },
      { kind: 'skill', name: '', enabled: false },
      { kind: 'skill', name: 'demo-skill', enabled: 'yes' },
    ]
    for (const body of invalid) {
      const { status } = await post(fixture.route.handler, body)
      assert.equal(status, 400, `expected 400 for ${JSON.stringify(body)}`)
    }
  } finally {
    fixture.restore()
  }
})

test('global route 404s unknown targets', async () => {
  const fixture = makeGlobalContext()
  try {
    const unknownMcp = await post(fixture.route.handler, { kind: 'mcp', name: 'ghost', enabled: false })
    assert.equal(unknownMcp.status, 404)
    assert.equal(unknownMcp.body.ok, false)

    const unknownSkill = await post(fixture.route.handler, { kind: 'skill', name: 'ghost-skill', enabled: false })
    assert.equal(unknownSkill.status, 404)
    assert.equal(unknownSkill.body.ok, false)
  } finally {
    fixture.restore()
  }
})

test('global route 400s a project-scope skill', async () => {
  const fixture = makeGlobalContext()
  try {
    const project = await post(fixture.route.handler, { kind: 'skill', name: 'project-skill', enabled: false })
    assert.equal(project.status, 400, 'a project-scope skill is not globally toggleable')
    assert.equal(project.body.ok, false)
    // A refused target must not have been written.
    assert.equal(readFileSync(fixture.projectSkillFile, 'utf8').includes('disable-model-invocation'), false)
  } finally {
    fixture.restore()
  }
})

test('global route 400s a runtime-registered skill', async () => {
  const fixture = makeGlobalContext({
    runtimeSkills: [{ name: 'runtime-skill', description: 'runtime fixture', invocation: { modelInvocable: true } }],
  })
  try {
    const runtime = await post(fixture.route.handler, { kind: 'skill', name: 'runtime-skill', enabled: false })
    assert.equal(runtime.status, 400, 'a runtime-registered skill has no file to toggle')
    assert.equal(runtime.body.ok, false)
  } finally {
    fixture.restore()
  }
})

test('global MCP toggles go through pluginManager when the service exists', async () => {
  const fixture = makeGlobalContext({ pluginManager: { setPluginEnabled: () => true } })
  try {
    const off = await post(fixture.route.handler, { kind: 'mcp', name: 'officecli', enabled: false })
    assert.equal(off.status, 200)
    assert.equal(off.body.ok, true)
    assert.equal(off.body.kind, 'mcp')
    assert.equal(off.body.name, 'officecli')
    assert.equal(off.body.enabled, false)
    assert.equal(off.body.changed, true)
    assert.equal(off.body.live, true)
    assert.equal(off.body.via, 'pluginManager')
    assert.deepEqual(fixture.calls, [['mcp-officecli', false]])

    const on = await post(fixture.route.handler, { kind: 'mcp', name: 'officecli', enabled: true })
    assert.equal(on.status, 200)
    assert.equal(on.body.enabled, true)
    assert.equal(on.body.live, true)
    assert.deepEqual(fixture.calls, [
      ['mcp-officecli', false],
      ['mcp-officecli', true],
    ])
    // The live path must not fall back to the patch file.
    assert.equal(readFileSync(fixture.patchPath, 'utf8').includes('mcp-officecli'), false)
  } finally {
    fixture.restore()
  }
})

test('without pluginManager the MCP toggle falls back to cordis.patch.yml', async () => {
  const fixture = makeGlobalContext()
  try {
    const off = await post(fixture.route.handler, { kind: 'mcp', name: 'officecli', enabled: false })
    assert.equal(off.status, 200)
    assert.equal(off.body.ok, true)
    assert.equal(off.body.enabled, false)
    assert.equal(off.body.changed, true)
    assert.equal(off.body.live, false)
    assert.equal(off.body.via, 'patch')
    assert.equal(off.body.path, fixture.patchPath)

    const written = readFileSync(fixture.patchPath, 'utf8')
    assert.ok(written.includes('# profile patch (fixture)'), 'existing comments were dropped')
    assert.match(written, /- id: mcp-officecli\n[ \t]+disabled: true/)
    assert.match(written, /- id: dsh-inventory\n[ \t]+disabled: false/)
  } finally {
    fixture.restore()
  }
})

test('the patch fallback can re-enable what it disabled', async () => {
  const fixture = makeGlobalContext()
  try {
    await post(fixture.route.handler, { kind: 'mcp', name: 'officecli', enabled: false })

    const on = await post(fixture.route.handler, { kind: 'mcp', name: 'officecli', enabled: true })
    assert.equal(on.status, 200)
    assert.equal(on.body.enabled, true)
    assert.equal(on.body.live, false, 'a patch-only write is not live until the next start')
    assert.equal(on.body.via, 'patch')
    // The persisted state must follow the request; otherwise the server comes
    // back disabled after the next restart.
    assert.match(readFileSync(fixture.patchPath, 'utf8'), /- id: mcp-officecli\n[ \t]+disabled: false/)
  } finally {
    fixture.restore()
  }
})

test('global skill toggles rewrite SKILL.md and can be turned back on', async () => {
  const fixture = makeGlobalContext()
  try {
    const off = await post(fixture.route.handler, { kind: 'skill', name: 'demo-skill', enabled: false })
    assert.equal(off.status, 200)
    assert.equal(off.body.ok, true)
    assert.equal(off.body.kind, 'skill')
    assert.equal(off.body.name, 'demo-skill')
    assert.equal(off.body.enabled, false)
    assert.equal(off.body.changed, true)
    assert.equal(off.body.live, true)
    assert.equal(off.body.path, fixture.userSkillFile)

    const disabledText = readFileSync(fixture.userSkillFile, 'utf8')
    assert.match(disabledText, /^disable-model-invocation: true$/m)
    assert.ok(disabledText.includes('description: global fixture'), disabledText)
    assert.ok(disabledText.endsWith('# demo-skill\n\nbody\n'), disabledText)

    // The snapshot must show the toggle immediately (the write invalidates the cache).
    const afterOff = await call(fixture.snapshotRoute.handler, { method: 'GET', url: `${SNAPSHOT_ROUTE}?refresh=1` })
    const offRow = afterOff.body.skills.find((skill) => skill.name === 'demo-skill')
    assert.equal(offRow.disabled, true)
    assert.equal(offRow.modelInvocable, false)

    const on = await post(fixture.route.handler, { kind: 'skill', name: 'demo-skill', enabled: true })
    assert.equal(on.status, 200)
    assert.equal(on.body.enabled, true)
    assert.equal(on.body.changed, true)
    const enabledText = readFileSync(fixture.userSkillFile, 'utf8')
    assert.equal(/disable-model-invocation/.test(enabledText), false, 'flag line survived the re-enable')
    assert.ok(enabledText.includes('# demo-skill\n\nbody\n'), enabledText)

    const again = await post(fixture.route.handler, { kind: 'skill', name: 'demo-skill', enabled: true })
    assert.equal(again.status, 200)
    assert.equal(again.body.changed, false, 'a no-op toggle must report changed:false')
  } finally {
    fixture.restore()
  }
})

test('the snapshot carries global toggle metadata on MCP and skill rows', async () => {
  const fixture = makeGlobalContext({
    pluginManager: { setPluginEnabled: () => true },
    runtimeSkills: [{ name: 'runtime-skill', description: 'runtime fixture', invocation: { modelInvocable: true } }],
  })
  try {
    const { status, body } = await call(fixture.snapshotRoute.handler, { method: 'GET', url: `${SNAPSHOT_ROUTE}?refresh=1` })
    assert.equal(status, 200)
    assert.equal(body.globalToggle.mcp, true)
    assert.equal(body.globalToggle.skill, true)

    const mcpRow = body.mcp.find((row) => row.server === 'officecli')
    assert.ok(mcpRow, `fixture MCP row missing: ${JSON.stringify(body.mcp)}`)
    assert.equal(mcpRow.toggleable, true)
    assert.equal(mcpRow.disabledReason, null)

    const byName = new Map(body.skills.map((skill) => [skill.name, skill]))

    const global = byName.get('demo-skill')
    assert.ok(global, 'global skill row missing')
    assert.equal(global.global, true)
    assert.equal(global.toggleable, true)
    assert.equal(global.disabledReason, null)

    const project = byName.get('project-skill')
    assert.ok(project, 'project skill row missing')
    assert.equal(project.global, false)
    assert.equal(project.toggleable, false)
    assert.equal(project.disabledReason, 'project-scope')

    const runtime = byName.get('runtime-skill')
    assert.ok(runtime, 'runtime skill row missing')
    assert.equal(runtime.global, false)
    assert.equal(runtime.toggleable, false)
    assert.equal(runtime.disabledReason, 'runtime')
  } finally {
    fixture.restore()
  }
})

// ---- POST /inventory/vault (registered-but-inactive skills) --------------

/**
 * A profile-shaped context with one global MCP row, one disabled ("registered
 * only") MCP row, skills on every root the vault can see (user-dsh, user-agents,
 * bundled), one project skill, and one registered workspace.
 */
function makeVaultContext() {
  const home = mkdtempSync(join(tmpdir(), 'inv-vault-route-home-'))
  const userSkills = join(home, 'skills')
  writeSkillFixture(userSkills, 'alpha-skill', 'user alpha')
  writeSkillFixture(userSkills, 'beta-skill', 'user beta')
  const agentsSkills = join(home, 'agents', 'skills')
  writeSkillFixture(agentsSkills, 'agents-skill', 'agents root')

  const bundledDir = join(home, 'bundled-skills')
  writeSkillFixture(bundledDir, 'bundled-skill', 'bundled fixture')

  const projectDir = mkdtempSync(join(tmpdir(), 'inv-vault-route-project-'))
  writeSkillFixture(join(projectDir, '.dsh', 'skills'), 'project-skill', 'project fixture')

  const workspace = mkdtempSync(join(tmpdir(), 'inv-vault-route-ws-'))
  // Pin the workspace's project root to itself (DSH walks up to the nearest .git).
  mkdirSync(join(workspace, '.git'), { recursive: true })

  const profileDir = mkdtempSync(join(tmpdir(), 'inv-vault-route-profile-'))
  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify({ name: 'fixture-profile', dependencies: {}, dsh: { profile: { bundles: [] } } }),
  )
  const patchPath = join(profileDir, 'cordis.patch.yml')
  writeFileSync(patchPath, '# profile patch (fixture)\n', 'utf8')

  const previous = {
    DSH_HOME: process.env.DSH_HOME,
    DSH_AGENTS_HOME: process.env.DSH_AGENTS_HOME,
    DSH_CUSTOM_SKILL_DIRS: process.env.DSH_CUSTOM_SKILL_DIRS,
    DSH_BUNDLED_SKILL_DIR: process.env.DSH_BUNDLED_SKILL_DIR,
    cwd: process.cwd(),
  }
  process.env.DSH_HOME = home
  process.env.DSH_AGENTS_HOME = join(home, 'agents')
  process.env.DSH_CUSTOM_SKILL_DIRS = ''
  process.env.DSH_BUNDLED_SKILL_DIR = bundledDir
  process.chdir(projectDir)

  // `enabled` mirrors `disabled` so a fixture row reads correctly whichever
  // field the host trusts for "is this registration active".
  const entries = [
    {
      id: 'mcp-officecli',
      enabled: true,
      disabled: false,
      options: { name: MCP_CLIENT, config: { serverName: 'officecli', transport: 'stdio', command: 'fixture-mcp' } },
    },
    {
      id: 'mcp-legacy',
      enabled: false,
      disabled: true,
      options: { name: MCP_CLIENT, config: { serverName: 'legacy', transport: 'stdio', command: 'legacy-mcp' } },
    },
  ]
  const routes = []
  const ctx = {
    routes,
    baseUrl: pathToFileURL(profileDir).href,
    logger: { warn() {}, info() {}, error() {} },
    get(name) {
      if (name === 'loader') return { entries: () => entries }
      if (name === 'tools') return { schemas: () => [] }
      if (name === 'workspaceRegistry') return { list: () => [{ id: 'ws-1', title: 'fixture', path: workspace }] }
      if (name === 'profileContext') return { patchPath }
      if (name === 'skills') {
        return {
          list: async () => [],
          get: async (skillName) => ({ name: skillName, body: '' }),
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
  return {
    ctx,
    routes,
    home,
    userSkills,
    agentsSkills,
    bundledDir,
    projectDir,
    workspace,
    patchPath,
    vaultSkills: join(home, 'inventory', 'skills'),
    route: routes.find((item) => item.path === VAULT_ROUTE),
    assignRoute: routes.find((item) => item.path === ASSIGN_ROUTE),
    snapshotRoute: routes.find((item) => item.path === SNAPSHOT_ROUTE),
    restore() {
      process.chdir(previous.cwd)
      for (const key of ['DSH_HOME', 'DSH_AGENTS_HOME', 'DSH_CUSTOM_SKILL_DIRS', 'DSH_BUNDLED_SKILL_DIR']) {
        const value = previous[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    },
  }
}

async function snapshotOf(fixture) {
  const { status, body } = await call(fixture.snapshotRoute.handler, {
    method: 'GET',
    url: `${SNAPSHOT_ROUTE}?refresh=1`,
  })
  assert.equal(status, 200)
  return body
}

test('vault route rejects the wrong method and malformed bodies', async () => {
  const fixture = makeVaultContext()
  try {
    assert.equal((await post(fixture.route.handler, null, { method: 'GET' })).status, 405)
    const invalid = [
      { action: 'nope' },
      {},
      { action: 'in' },
      { action: 'in', name: '' },
      { action: 'in', name: '   ' },
      { action: 'out' },
      { action: 'out', name: '' },
    ]
    for (const body of invalid) {
      const { status } = await post(fixture.route.handler, body)
      assert.equal(status, 400, `expected 400 for ${JSON.stringify(body)}`)
    }
  } finally {
    fixture.restore()
  }
})

test('vault route 404s skills that are not on a movable root', async () => {
  const fixture = makeVaultContext()
  try {
    assert.equal((await post(fixture.route.handler, { action: 'in', name: 'ghost-skill' })).status, 404)
    assert.equal((await post(fixture.route.handler, { action: 'out', name: 'ghost-skill' })).status, 404)
    // A project-scoped skill is not a global root: it cannot be parked.
    assert.equal((await post(fixture.route.handler, { action: 'in', name: 'project-skill' })).status, 404)
    assert.equal(existsSync(join(fixture.projectDir, '.dsh', 'skills', 'project-skill', 'SKILL.md')), true)
  } finally {
    fixture.restore()
  }
})

test('vault route 400s a read-only bundled skill and refuses overwrites', async () => {
  const fixture = makeVaultContext()
  try {
    // A bundled skill exists but is read-only: 400, not "not found".
    const bundled = await post(fixture.route.handler, { action: 'in', name: 'bundled-skill' })
    assert.equal(bundled.status, 400)
    assert.match(bundled.body.error, /只读|不能移动/)
    assert.equal(existsSync(join(fixture.bundledDir, 'bundled-skill', 'SKILL.md')), true)

    // `in` onto an occupied vault slot: 400, and the source stays put.
    mkdirSync(join(fixture.vaultSkills, 'alpha-skill'), { recursive: true })
    writeFileSync(join(fixture.vaultSkills, 'alpha-skill', 'SKILL.md'), '---\nname: alpha-skill\ndescription: vault copy\n---\n')
    const exists = await post(fixture.route.handler, { action: 'in', name: 'alpha-skill' })
    assert.equal(exists.status, 400)
    assert.equal(typeof exists.body.error, 'string')
    assert.equal(existsSync(join(fixture.userSkills, 'alpha-skill', 'SKILL.md')), true, 'the global copy must stay')

    // `out` onto an occupied global slot: 400, and the vault copy stays put.
    const into = await post(fixture.route.handler, { action: 'in', name: 'beta-skill' })
    assert.equal(into.status, 200)
    writeSkillFixture(fixture.userSkills, 'beta-skill', 'user beta again')
    const outExists = await post(fixture.route.handler, { action: 'out', name: 'beta-skill' })
    assert.equal(outExists.status, 400)
    assert.equal(existsSync(join(fixture.vaultSkills, 'beta-skill', 'SKILL.md')), true, 'the vault copy must stay')
  } finally {
    fixture.restore()
  }
})

test('moving a global skill into the vault flips the snapshot and back', async () => {
  const fixture = makeVaultContext()
  try {
    const before = await snapshotOf(fixture)
    assert.equal(before.vault.dir, fixture.vaultSkills)
    assert.equal(before.vault.count, 0)
    const beforeRow = before.skills.find((skill) => skill.name === 'alpha-skill')
    assert.ok(beforeRow, 'global skill row missing')
    assert.equal(beforeRow.source, 'user-dsh')
    assert.equal(beforeRow.vaulted, false, 'every skill row must carry a boolean vaulted flag')

    const into = await post(fixture.route.handler, { action: 'in', name: 'alpha-skill' })
    assert.equal(into.status, 200)
    assert.equal(into.body.ok, true)
    assert.deepEqual(into.body.moved, ['alpha-skill'])
    assert.deepEqual(into.body.skipped, [])
    assert.equal(existsSync(join(fixture.vaultSkills, 'alpha-skill', 'SKILL.md')), true)
    assert.equal(existsSync(join(fixture.userSkills, 'alpha-skill')), false)

    const afterIn = await snapshotOf(fixture)
    assert.equal(afterIn.vault.count, 1)
    const vaultedRow = afterIn.skills.find((skill) => skill.name === 'alpha-skill')
    assert.ok(vaultedRow, 'vaulted skill row missing')
    assert.equal(vaultedRow.source, 'vault')
    assert.equal(vaultedRow.vaulted, true)
    assert.equal(vaultedRow.global, false)
    assert.equal(vaultedRow.toggleable, false)
    assert.equal(vaultedRow.disabledReason, 'vaulted')

    const out = await post(fixture.route.handler, { action: 'out', name: 'alpha-skill' })
    assert.equal(out.status, 200)
    assert.deepEqual(out.body.moved, ['alpha-skill'])
    assert.equal(existsSync(join(fixture.userSkills, 'alpha-skill', 'SKILL.md')), true)

    const afterOut = await snapshotOf(fixture)
    assert.equal(afterOut.vault.count, 0)
    const restored = afterOut.skills.find((skill) => skill.name === 'alpha-skill')
    assert.equal(restored.source, 'user-dsh')
    assert.equal(restored.vaulted, false)
    assert.equal(restored.toggleable, true)
    assert.equal(restored.disabledReason, null)
  } finally {
    fixture.restore()
  }
})

test('in-all moves every movable global skill and skips bundled ones', async () => {
  const fixture = makeVaultContext()
  try {
    const all = await post(fixture.route.handler, { action: 'in-all' })
    assert.equal(all.status, 200)
    assert.equal(all.body.ok, true)
    assert.deepEqual([...all.body.moved].sort(), ['agents-skill', 'alpha-skill', 'beta-skill'])
    const skippedBundled = all.body.skipped.find((item) => item.name === 'bundled-skill')
    assert.ok(skippedBundled, `bundled skill not reported as skipped: ${JSON.stringify(all.body.skipped)}`)
    assert.equal(skippedBundled.reason, 'bundled')

    for (const name of ['agents-skill', 'alpha-skill', 'beta-skill']) {
      assert.equal(existsSync(join(fixture.vaultSkills, name, 'SKILL.md')), true, `${name} was not moved`)
      assert.equal(existsSync(join(fixture.userSkills, name)), false, `${name} left a copy behind`)
    }
    assert.equal(existsSync(join(fixture.bundledDir, 'bundled-skill', 'SKILL.md')), true, 'a bundled skill must stay put')
    assert.equal(existsSync(join(fixture.projectDir, '.dsh', 'skills', 'project-skill', 'SKILL.md')), true, 'a project skill must stay put')

    const snapshot = await snapshotOf(fixture)
    assert.equal(snapshot.vault.count, 3)

    // Already vaulted skills are not moved twice.
    const again = await post(fixture.route.handler, { action: 'in-all' })
    assert.equal(again.status, 200)
    assert.deepEqual(again.body.moved, [])
  } finally {
    fixture.restore()
  }
})

test('a disabled mcp-client row is registered but not globally mounted', async () => {
  const fixture = makeVaultContext()
  try {
    const snapshot = await snapshotOf(fixture)
    assert.deepEqual([...snapshot.globalMcp].sort(), ['officecli'], 'a disabled row must not count as globally mounted')

    const legacy = snapshot.mcp.find((row) => row.server === 'legacy')
    assert.ok(legacy, 'disabled MCP row missing from mcp[]')
    assert.equal(legacy.enabled, false)
    const officecli = snapshot.mcp.find((row) => row.server === 'officecli')
    assert.equal(officecli.enabled, true)
  } finally {
    fixture.restore()
  }
})

test('a vaulted skill can be assigned to a workspace', async () => {
  const fixture = makeVaultContext()
  try {
    const into = await post(fixture.route.handler, { action: 'in', name: 'alpha-skill' })
    assert.equal(into.status, 200)

    const added = await post(fixture.assignRoute.handler, {
      kind: 'skill',
      action: 'add',
      name: 'alpha-skill',
      workspace: fixture.workspace,
    })
    assert.equal(added.status, 200, JSON.stringify(added.body))
    assert.equal(added.body.ok, true)
    assert.equal(added.body.path, join(fixture.workspace, '.dsh', 'skills', 'alpha-skill'))
    assert.equal(lstatSync(added.body.path).isSymbolicLink(), true, 'assignment must be a link to the vault copy')

    const snapshot = await snapshotOf(fixture)
    const projectDsh = snapshot.workspaces[0].skills.find((group) => group.source === 'project-dsh')
    assert.deepEqual(projectDsh.skills.map((skill) => skill.name), ['alpha-skill'])
  } finally {
    fixture.restore()
  }
})

// ---- default workspace ---------------------------------------------------

/**
 * The default workspace lives in DSH's own storage, not necessarily in the
 * workspace registry: the snapshot must still pin it first and name it.
 */
function makeDefaultWorkspaceContext() {
  const home = mkdtempSync(join(tmpdir(), 'inv-default-home-'))
  const defaultDir = mkdtempSync(join(tmpdir(), 'inv-default-ws-'))
  const otherDir = mkdtempSync(join(tmpdir(), 'inv-default-other-'))
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(
    join(home, 'storages', 'workspace.json'),
    JSON.stringify({
      global: { defaultWorkspaceId: 'ws-default' },
      tables: {
        workspaces: {
          'ws-default': { path: defaultDir, title: 'Default Workspace' },
          'ws-other': { path: otherDir, title: 'Other Workspace' },
        },
      },
    }),
    'utf8',
  )

  const profileDir = mkdtempSync(join(tmpdir(), 'inv-default-profile-'))
  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify({ name: 'fixture-profile', dependencies: {}, dsh: { profile: { bundles: [] } } }),
  )

  const previous = {
    DSH_HOME: process.env.DSH_HOME,
    DSH_AGENTS_HOME: process.env.DSH_AGENTS_HOME,
    DSH_CUSTOM_SKILL_DIRS: process.env.DSH_CUSTOM_SKILL_DIRS,
    DSH_BUNDLED_SKILL_DIR: process.env.DSH_BUNDLED_SKILL_DIR,
  }
  process.env.DSH_HOME = home
  process.env.DSH_AGENTS_HOME = join(home, 'agents')
  process.env.DSH_CUSTOM_SKILL_DIRS = ''
  delete process.env.DSH_BUNDLED_SKILL_DIR

  const routes = []
  const ctx = {
    routes,
    baseUrl: pathToFileURL(profileDir).href,
    logger: { warn() {}, info() {}, error() {} },
    get(name) {
      if (name === 'loader') return { entries: () => [] }
      if (name === 'tools') return { schemas: () => [] }
      if (name === 'workspaceRegistry') {
        // The registry deliberately lists the default second.
        return {
          list: () => [
            { id: 'ws-other', title: 'Other Workspace', path: otherDir },
            { id: 'ws-default', title: 'Default Workspace', path: defaultDir },
          ],
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
  return {
    routes,
    defaultDir,
    otherDir,
    snapshotRoute: routes.find((item) => item.path === SNAPSHOT_ROUTE),
    restore() {
      for (const key of ['DSH_HOME', 'DSH_AGENTS_HOME', 'DSH_CUSTOM_SKILL_DIRS', 'DSH_BUNDLED_SKILL_DIR']) {
        const value = previous[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    },
  }
}

test('the snapshot pins the default workspace first and names it', async () => {
  const fixture = makeDefaultWorkspaceContext()
  try {
    const snapshot = await snapshotOf(fixture)

    assert.equal(snapshot.defaultWorkspaceId, 'ws-default')
    assert.equal(snapshot.workspaces[0].id, 'ws-default', 'the default workspace must be first')
    assert.equal(snapshot.workspaces[0].default, true)
    assert.equal(snapshot.workspaces[0].title, 'Default Workspace')

    const other = snapshot.workspaces.find((workspace) => workspace.id === 'ws-other')
    assert.ok(other, 'the other workspace row is missing')
    assert.equal(other.default, false)
  } finally {
    fixture.restore()
  }
})

test('the apply route refuses the wrong method without touching the checkout', async () => {
  // The sequence itself is covered by `plugin-update-apply.test.mjs` on throwaway
  // repositories. This handler resolves the checkout the RUNNING plugin was
  // loaded from, so exercising its POST path here would `git fetch` the real
  // repository and rewrite the real last.json — one such test once overwrote a
  // user's genuine update result (issue #60).
  const ctx = makeContext()
  apply(ctx)
  const route = ctx.routes.find((entry) => entry.path === PLUGIN_UPDATE_APPLY_ROUTE)
  assert.ok(route, 'apply route not registered')
  const { status, body } = await call(route.handler, { method: 'GET', url: PLUGIN_UPDATE_APPLY_ROUTE })
  assert.equal(status, 405)
  assert.equal(body.error, 'method-not-allowed')
})

test('the apply route updates the checkout it is pointed at, and only that one', async () => {
  // End-to-end on throwaway directories: the route's real POST path runs, but the
  // repository and the state directory are both injected, so nothing outside the
  // temporary tree is touched (issue #60).
  const origin = mkdtempSync(join(tmpdir(), 'hr-origin-'))
  const g = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  g(origin, 'init', '-q', '-b', 'main')
  g(origin, 'config', 'user.email', 't@example.com')
  g(origin, 'config', 'user.name', 'T')
  mkdirSync(join(origin, 'packages', 'dsh-inventory'), { recursive: true })
  writeFileSync(join(origin, 'packages', 'dsh-inventory', 'package.json'), JSON.stringify({ name: 'dsh-inventory', version: '0.1.0' }))
  writeFileSync(join(origin, 'packages', 'dsh-inventory', 'index.js'), 'export const a = 1\n')
  g(origin, 'add', '.')
  g(origin, 'commit', '-q', '-m', 'one')

  const repo = mkdtempSync(join(tmpdir(), 'hr-repo-'))
  g(origin, 'clone', '-q', origin, repo)
  g(repo, 'config', 'user.email', 't@example.com')
  g(repo, 'config', 'user.name', 'T')
  writeFileSync(join(origin, 'packages', 'dsh-inventory', 'package.json'), JSON.stringify({ name: 'dsh-inventory', version: '0.2.0' }))
  g(origin, 'add', '.')
  g(origin, 'commit', '-q', '-m', 'bump')

  const home = mkdtempSync(join(tmpdir(), 'hr-home-'))
  // Snapshot the real things this test must NOT touch, so "and only that one" is
  // a claim with an assertion behind it.
  const realLast = join(dshHome(), 'plugin-update', 'last.json')
  const realBefore = (() => {
    try {
      return statSync(realLast).mtimeMs
    } catch {
      return null
    }
  })()
  const realHeadBefore = (() => {
    try {
      return execFileSync('git', ['-C', join(import.meta.dirname, '..', '..', '..'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    } catch {
      return null
    }
  })()

  const previous = { repo: process.env.DSH_INVENTORY_UPDATE_REPO, home: process.env.DSH_HOME }
  process.env.DSH_INVENTORY_UPDATE_REPO = repo
  // The whole safety of this test rests on that override: without it the handler
  // falls back to the checkout this plugin was loaded from, which is the REAL
  // repository. Assert it rather than trusting the assignment above.
  assert.equal(process.env.DSH_INVENTORY_UPDATE_REPO, repo, 'the checkout override must be in place')
  process.env.DSH_HOME = home
  try {
    const ctx = makeContext()
    apply(ctx)
    const route = ctx.routes.find((entry) => entry.path === PLUGIN_UPDATE_APPLY_ROUTE)
    let status = 0
    let body = ''
    const res = {
      // A real ServerResponse reports this after end(); the route relies on it to
      // avoid answering twice, so the fake has to model it too.
      writableEnded: false,
      writeHead(code) {
        status = code
      },
      end(chunk) {
        body = chunk ?? ''
        res.writableEnded = true
      },
    }
    await route.handler({ method: 'POST', url: PLUGIN_UPDATE_APPLY_ROUTE }, res)
    assert.equal(status, 200, `the route must answer, got ${status} ${body}`)
    assert.equal(JSON.parse(body).accepted, true, `the update must be accepted: ${body}`)
    const last = JSON.parse(readFileSync(join(home, 'plugin-update', 'last.json'), 'utf8'))
    assert.equal(last.ok, true)
    assert.deepEqual(last.changed, [{ name: 'dsh-inventory', from: '0.1.0', to: '0.2.0' }])
    assert.equal(g(repo, 'rev-parse', 'HEAD').trim(), g(origin, 'rev-parse', 'HEAD').trim(), 'the injected checkout moved')

    // The real state directory and the real checkout are untouched: that is the
    // property issue #60 is about.
    const realAfter = (() => {
      try {
        return statSync(realLast).mtimeMs
      } catch {
        return null
      }
    })()
    assert.equal(realAfter, realBefore, 'the real last.json must not be rewritten')
    const realHeadAfter = (() => {
      try {
        return execFileSync('git', ['-C', join(import.meta.dirname, '..', '..', '..'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      } catch {
        return null
      }
    })()
    assert.equal(realHeadAfter, realHeadBefore, 'the real checkout must not move')
  } finally {
    for (const dir of [origin, repo, home]) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* a leftover temp dir is not worth failing over */
      }
    }
    if (previous.repo === undefined) delete process.env.DSH_INVENTORY_UPDATE_REPO
    else process.env.DSH_INVENTORY_UPDATE_REPO = previous.repo
    if (previous.home === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous.home
  }
})
