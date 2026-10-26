import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { apply, ASSIGN_ROUTE, GLOBAL_ROUTE, SNAPSHOT_ROUTE } from '../index.js'

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
  assert.deepEqual(ctx.routes.map((route) => route.path).sort(), [ASSIGN_ROUTE, GLOBAL_ROUTE, SNAPSHOT_ROUTE].sort())
  for (const route of ctx.routes) assert.equal(route.kind, 'exact')
  assert.equal(SNAPSHOT_ROUTE, '/inventory/snapshot')
  assert.equal(ASSIGN_ROUTE, '/inventory/workspace')
  assert.equal(GLOBAL_ROUTE, '/inventory/global')
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
