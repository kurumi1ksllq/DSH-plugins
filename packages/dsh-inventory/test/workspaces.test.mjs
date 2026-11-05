import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../index.js'
import { collectWorkspaces, projectSkillRoots, readDefaultWorkspace, readWorkspaceMcp } from '../lib/workspaces.js'
import { assignSkill } from '../lib/assign.js'

/**
 * Per-workspace view: the MCP a workspace declares plus the skills reachable
 * from its project roots, grouped by source. Offline only — every filesystem
 * read here targets a temp directory, and the skill scanner is injected.
 */

const created = []

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'inv-ws-'))
  created.push(dir)
  return dir
}

function workspaceWith(declaration) {
  const dir = scratch()
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  if (declaration !== undefined) {
    writeFileSync(join(dir, '.dsh', 'mcp.json'), typeof declaration === 'string' ? declaration : JSON.stringify(declaration))
  }
  return dir
}

test.after(() => {
  for (const dir of created) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows may still hold a handle; temp leftovers are harmless.
    }
  }
})

/** A scanner that reports one skill per root, without touching the disk. */
function fakeScan(roots) {
  return {
    skills: roots.map((root) => ({
      name: `skill-of-${root.source}`,
      description: `from ${root.source}`,
      path: join(root.dir, 'SKILL.md'),
      source: root.source,
      rank: root.rank,
      modelInvocable: true,
      bodyBytes: 10,
    })),
    diagnostics: [],
  }
}

const VALID = {
  servers: { officecli: { transport: 'stdio', command: 'officecli.exe', args: ['mcp'] } },
}

test('readWorkspaceMcp reports a missing declaration', () => {
  const dir = scratch()
  const result = readWorkspaceMcp(dir)
  assert.equal(result.status, 'missing')
  assert.equal(result.file, null)
  assert.deepEqual(result.servers, [])
})

test('readWorkspaceMcp reports a valid declaration with the mounted name', () => {
  const dir = workspaceWith(VALID)
  const result = readWorkspaceMcp(dir, { serverNameSuffix: '-ws' })
  assert.equal(result.status, 'ok')
  assert.match(result.file, /mcp\.json$/)
  assert.equal(result.servers.length, 1)
  assert.equal(result.servers[0].name, 'officecli')
  assert.equal(result.servers[0].mountedAs, 'officecli-ws')
  assert.equal(result.servers[0].transport, 'stdio')
  assert.equal(result.servers[0].detail, 'officecli.exe')
})

/**
 * Issue #74: a hand-written `{"servers": {}}` is valid JSON with a valid
 * structure — the panel must show an empty "ok" state, not a parse error.
 * (assign.js even deletes an emptied declaration file so the panel reads it as
 * missing; a manual empty object must not read as broken either.)
 */
test('readWorkspaceMcp reports an empty-but-valid declaration as ok with no servers', () => {
  const dir = workspaceWith('{ "servers": {} }')
  const result = readWorkspaceMcp(dir)
  assert.equal(result.status, 'ok')
  assert.match(result.file, /mcp\.json$/)
  assert.deepEqual(result.servers, [])
  assert.equal(result.error, undefined)
})

test('readWorkspaceMcp reports an invalid declaration instead of throwing', () => {
  const dir = workspaceWith('{ "servers": ')
  const result = readWorkspaceMcp(dir)
  assert.equal(result.status, 'invalid')
  assert.match(result.error, /invalid JSON/)
})

test('collectWorkspaces without a registry yields nothing but a warning', () => {
  const warnings = []
  const result = collectWorkspaces({ warnings, scan: fakeScan })
  assert.deepEqual(result.workspaces, [])
  assert.equal(result.registryAvailable, false)
  assert.ok(warnings.some((warning) => warning.code === 'workspaces-unavailable'))
})

test('collectWorkspaces groups project skills before shared skills', () => {
  const dir = workspaceWith(VALID)
  const result = collectWorkspaces({
    registry: { list: () => [{ id: 'ws-1', title: 'Demo', path: dir }] },
    globalMcp: ['officecli'],
    serverNameSuffix: '-ws',
    scan: fakeScan,
  })
  assert.equal(result.workspaces.length, 1)
  const workspace = result.workspaces[0]
  assert.equal(workspace.title, 'Demo')
  assert.equal(workspace.available, true)
  assert.equal(workspace.mcp.status, 'ok')
  assert.equal(workspace.counts.declared, 1)
  // Shared roots belong to every workspace equally, so they are reported once
  // at the top level instead of being repeated inside all 14 cards.
  const sources = workspace.skills.map((group) => group.source)
  assert.deepEqual(sources, ['project-dsh', 'project-agents'], 'a workspace lists only its own project roots')
  assert.equal(workspace.counts.projectSkills, 2)
  assert.equal(
    workspace.counts.sharedSkills,
    result.sharedSkillCount,
    'the shared count stays available so a card can say "0 own (+28 shared)"',
  )
  assert.ok(Array.isArray(result.sharedSkills), 'shared skill groups must be reported at the top level')
  assert.ok(
    result.sharedSkills.some((group) => group.source === 'user-dsh'),
    'top-level shared groups must include the user roots',
  )
  assert.deepEqual(result.globalMcp, ['officecli'])
})

test('shared skill roots are scanned once for all workspaces', () => {
  const first = workspaceWith(VALID)
  const second = scratch()
  let calls = 0
  const countingScan = (roots) => {
    calls += roots.length
    return fakeScan(roots)
  }
  const result = collectWorkspaces({
    registry: {
      list: () => [
        { id: 'a', title: 'A', path: first },
        { id: 'b', title: 'B', path: second },
      ],
    },
    scan: countingScan,
  })
  assert.equal(result.workspaces.length, 2)
  const projectRoots = projectSkillRoots(first).length + projectSkillRoots(second).length
  const sharedRoots = result.sharedSkills.length
  assert.equal(calls, projectRoots + sharedRoots, 'shared roots must not be rescanned per workspace')
  // The shared groups are identical for every workspace by construction.
  assert.ok(sharedRoots > 0, 'shared roots must be reported once')
})

test('a workspace whose directory vanished is still listed, marked unavailable', () => {
  const gone = join(scratch(), 'never-created')
  const result = collectWorkspaces({
    registry: { list: () => [{ id: 'gone', title: 'Gone', path: gone }] },
    scan: fakeScan,
  })
  assert.equal(result.workspaces.length, 1)
  assert.equal(result.workspaces[0].available, false)
  assert.equal(result.workspaces[0].mcp.status, 'missing')
})

test('the snapshot route exposes the per-workspace view', async () => {
  const routes = []
  const dir = workspaceWith(VALID)
  // Isolate DSH_HOME: the route also reads the default workspace from
  // `$DSH_HOME/storages/workspace.json`, and the real one must not leak in here.
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = scratch()
  try {
    const ctx = {
      baseUrl: 'file:///C:/nope/',
      logger: { warn() {}, info() {}, error() {} },
      get(name) {
        if (name === 'loader') return { entries: () => [] }
        if (name === 'tools') return { schemas: () => [] }
        if (name === 'workspaceRegistry') {
          return { list: () => [{ id: 'ws-route', title: 'Route Workspace', path: dir }] }
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
    let body = ''
    await routes[0].handler({ method: 'GET', url: '/inventory/snapshot?refresh=1' }, {
      writeHead() {},
      end(chunk) {
        body = chunk ?? ''
      },
    })
    const snapshot = JSON.parse(body)
    assert.ok(Array.isArray(snapshot.workspaces), 'snapshot.workspaces must be an array')
    assert.equal(snapshot.workspaces.length, 1)
    assert.equal(snapshot.workspaces[0].title, 'Route Workspace')
    assert.equal(snapshot.workspaces[0].mcp.status, 'ok')
    assert.equal(snapshot.workspaces[0].mcp.servers[0].name, 'officecli')
    assert.ok(snapshot.workspaces[0].skills.length > 0, 'skill groups must be present')
    // The page shows "declared" and "globally registered" side by side, so the
    // snapshot must carry the global list too — not just the per-workspace rows.
    assert.ok(Array.isArray(snapshot.globalMcp), 'snapshot.globalMcp must be an array')
    assert.deepEqual(snapshot.globalMcp, [])
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})

test('the snapshot lists globally registered MCP servers next to workspace ones', async () => {
  const routes = []
  const ctx = {
    baseUrl: 'file:///C:/nope/',
    logger: { warn() {}, info() {}, error() {} },
    get(name) {
      if (name === 'loader') {
        return {
          entries: () => [
            {
              id: 'mcp-codegraph',
              options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'codegraph' } },
              disabled: false,
            },
            {
              id: 'mcp-context7',
              options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'context7' } },
              disabled: false,
            },
          ],
        }
      }
      if (name === 'tools') return { schemas: () => [] }
      if (name === 'workspaceRegistry') return { list: () => [] }
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
  let body = ''
  await routes[0].handler({ method: 'GET', url: '/inventory/snapshot?refresh=1' }, {
    writeHead() {},
    end(chunk) {
      body = chunk ?? ''
    },
  })
  const snapshot = JSON.parse(body)
  assert.deepEqual(snapshot.globalMcp, ['codegraph', 'context7'])
})

/**
 * Discoverability: without a prompt section, a model in an unrelated session
 * has no way to learn that a workspace can declare its own MCP servers. The
 * gate alone is invisible — it only decides what to mount, it never explains
 * itself to the model.
 */
test('registers a system-prompt section explaining workspace-scoped MCP', () => {
  const sections = []
  const ctx = {
    baseUrl: 'file:///C:/nope/',
    logger: { warn() {}, info() {}, error() {} },
    get() {
      return undefined
    },
    effect(fn) {
      return fn()
    },
    inject(deps, callback) {
      assert.ok(Array.isArray(deps), 'inject must receive a dependency list')
      if (deps.includes('systemPrompt')) {
        callback({ systemPrompt: { section: (section) => sections.push(section) } })
      }
    },
    webServer: {
      register() {
        return () => {}
      },
    },
  }
  apply(ctx)
  assert.equal(sections.length, 1, 'exactly one prompt section must be contributed')
  const section = sections[0]
  assert.equal(typeof section.name, 'string')
  assert.ok(section.name.length > 0, 'a section needs a stable name')
  assert.equal(typeof section.order, 'number')
  assert.match(section.text, /\.dsh\/mcp\.json/, 'the section must name the declaration file')
  assert.match(section.text, /mcp__/, 'the section must name the tool prefix the model will see')
  assert.match(section.text, /next session|new session/i, 'the section must say when an edit takes effect')
  // Issue #69: the mounted name is `<name>` + the suffix the snapshot reports,
  // which is empty on a default install. The section must never promise a
  // concrete `-ws` suffix again — gate.js ships with serverNameSuffix '' and the
  // old unconditional claim made the model expect `mcp__<name>-ws__*` tools.
  assert.match(section.text, /gateServerNameSuffix/, 'the section must point at the snapshot field that carries the suffix')
  assert.doesNotMatch(section.text, /`-ws`/, 'no unconditional -ws suffix claim (it is a deployment override, not the default)')
  // Issue #69: duplicate serverName is rejected by the runtime, so re-declaring
  // a globally enabled server must be called out, not described as "a second copy".
  assert.match(section.text, /never re-declare|do not re-declare/i, 'the section must warn against re-declaring a globally enabled server')
  // Issue #70: the "workspace switch is the only control" rule holds for MCP,
  // but NOT for skills — global-root skills are overview-owned whatever their state.
  assert.match(section.text, /SKILLS/, 'the section must split the rule per capability')
  assert.match(section.text, /only vault skills can be enabled per workspace/i, 'the skill rule must say vault-only')
  // Issue #73: the vault also holds single-file skills; the link instruction must cover both.
  assert.match(section.text, /<name>\.md/, 'the section must name the single-file vault form')
})

test('project skill roots follow the nearest .git, not the workspace directory', () => {
  const repo = scratch()
  mkdirSync(join(repo, '.git'))
  const nested = join(repo, 'packages', 'app')
  mkdirSync(nested, { recursive: true })
  const roots = projectSkillRoots(nested)
  assert.deepEqual(
    roots.map((root) => root.dir),
    [join(repo, '.dsh', 'skills'), join(repo, '.agents', 'skills')],
  )
})

test('a linked skill is flagged linked, a copied one is not', () => {
  const home = scratch()
  const source = join(home, 'demo-skill')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'SKILL.md'), '---\nname: demo-skill\ndescription: linked\n---\n', 'utf8')
  const dir = scratch()
  assignSkill({ workspaceDir: dir, name: 'demo-skill', sourcePath: join(source, 'SKILL.md') })
  const copied = join(dir, '.dsh', 'skills', 'copied')
  mkdirSync(copied, { recursive: true })
  writeFileSync(join(copied, 'SKILL.md'), '---\nname: copied\ndescription: copied\n---\n', 'utf8')

  const view = collectWorkspaces({ registry: { list: () => [{ id: 'ws', title: 'ws', path: dir }] } })
  const projectDsh = view.workspaces[0].skills.find((group) => group.source === 'project-dsh')
  const byName = new Map(projectDsh.skills.map((skill) => [skill.name, skill]))
  assert.equal(byName.get('demo-skill').linked, true)
  assert.equal(byName.get('copied').linked, false)
})

/**
 * Default workspace: DSH keeps its identity in `$DSH_HOME/storages/workspace.json`
 * (`global.defaultWorkspaceId` + `tables.workspaces[id]`), which the registry
 * service does not necessarily list. The panel must still show it, first.
 */

function storageHome(defaultId, records) {
  const home = scratch()
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(
    join(home, 'storages', 'workspace.json'),
    JSON.stringify({ global: { defaultWorkspaceId: defaultId }, tables: { workspaces: records } }),
    'utf8',
  )
  return home
}

test('readDefaultWorkspace reads the default id and its record from storage', () => {
  const home = storageHome('ws-default', { 'ws-default': { path: 'D:/demo', title: 'Demo' } })

  const result = readDefaultWorkspace({ dshHome: home })

  assert.deepEqual(result, { id: 'ws-default', path: 'D:/demo', title: 'Demo' })
})

test('readDefaultWorkspace returns undefined for a missing, broken or empty storage file', () => {
  assert.equal(readDefaultWorkspace({ dshHome: scratch() }), undefined, 'a missing file must read as no default')

  const broken = scratch()
  mkdirSync(join(broken, 'storages'), { recursive: true })
  writeFileSync(join(broken, 'storages', 'workspace.json'), '{ not json', 'utf8')
  assert.equal(readDefaultWorkspace({ dshHome: broken }), undefined, 'bad JSON must read as no default')

  const noId = storageHome(undefined, { 'ws-1': { path: 'D:/demo' } })
  assert.equal(readDefaultWorkspace({ dshHome: noId }), undefined, 'a missing defaultWorkspaceId must read as no default')
})

test('the default workspace is flagged and pinned to the top of the list', () => {
  const other = workspaceWith(VALID)
  const defaultDir = workspaceWith(VALID)

  const result = collectWorkspaces({
    registry: {
      list: () => [
        { id: 'ws-other', title: 'Other', path: other },
        { id: 'ws-default', title: 'Default', path: defaultDir },
      ],
    },
    defaultWorkspace: { id: 'ws-default', path: defaultDir, title: 'Default' },
    scan: fakeScan,
  })

  assert.equal(result.defaultWorkspaceId, 'ws-default')
  assert.equal(result.workspaces[0].id, 'ws-default', 'the default workspace must be first')
  assert.equal(result.workspaces[0].default, true)
  assert.equal(result.workspaces[1].id, 'ws-other')
  assert.equal(result.workspaces[1].default, false)
})

test('a default workspace missing from the registry is synthesized from storage', () => {
  const dir = workspaceWith(VALID)

  const synthesized = collectWorkspaces({
    registry: { list: () => [] },
    defaultWorkspace: { id: 'ws-default', path: dir, title: 'Default' },
    scan: fakeScan,
  })

  assert.equal(synthesized.workspaces.length, 1, 'the default must be listed even when the registry omits it')
  assert.equal(synthesized.workspaces[0].id, 'ws-default')
  assert.equal(synthesized.workspaces[0].title, 'Default')
  assert.equal(synthesized.workspaces[0].default, true)
  assert.equal(synthesized.workspaces[0].available, true, 'available follows the directory')

  const gone = join(scratch(), 'never-created')
  const missing = collectWorkspaces({
    registry: { list: () => [] },
    defaultWorkspace: { id: 'ws-gone', path: gone, title: 'Gone' },
    scan: fakeScan,
  })
  assert.equal(missing.workspaces.length, 1)
  assert.equal(missing.workspaces[0].available, false, 'a vanished default directory must read as unavailable')
})

test('without a default workspace nothing is flagged and the id is null', () => {
  const result = collectWorkspaces({
    registry: { list: () => [{ id: 'ws-1', title: 'One', path: workspaceWith(VALID) }] },
    scan: fakeScan,
  })

  assert.equal(result.defaultWorkspaceId, null)
  assert.equal(result.workspaces[0].default, false)
})
