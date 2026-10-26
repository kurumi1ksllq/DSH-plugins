import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../index.js'
import { collectWorkspaces, projectSkillRoots, readWorkspaceMcp } from '../lib/workspaces.js'

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
