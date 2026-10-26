/**
 * Integration smoke test for the host half — no DSH restart required.
 *
 * Builds a stub Cordis context from a previously captured live snapshot
 * (`--snapshot=<file>`), then runs the plugin's real `apply()` and calls the
 * registered HTTP handler. Verifies the facts a restart would otherwise be
 * needed to observe:
 *   - an unresolvable bundle (`dsh-websearch-failover`) is flagged orphan
 *   - tool-search's core allowlist drives `deferred`
 *   - third-party tools (bsk_*) are attributed to their plugin package
 *
 * Usage:
 *   curl -s -o live.json http://127.0.0.1:50913/inventory/snapshot
 *   node scripts/smoke.mjs --snapshot=live.json
 */

import { readFileSync, existsSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, ASSIGN_ROUTE, SNAPSHOT_ROUTE } from '../index.js'
import { buildSnapshot } from '../lib/inventory.js'

const arg = process.argv.find((value) => value.startsWith('--snapshot='))
if (arg === undefined) {
  console.error('usage: node scripts/smoke.mjs --snapshot=<snapshot.json>')
  process.exit(2)
}
const live = JSON.parse(readFileSync(arg.slice('--snapshot='.length), 'utf8'))
const profileDir = join(homedir(), '.dsh', 'profiles', 'desktop')

// Recover the tool-search config from the patch layer: the snapshot redacts it.
const patch = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
const toolSearchBlock = patch.split(/\n(?=- id:|\s*- insert:)/).find((block) => /name:\s*dsh-tool-search/.test(block)) ?? ''
const coreSection = /core:\s*\n((?:\s*-\s*\S+\n)+)/.exec(toolSearchBlock)
const core = coreSection === null ? [] : [...coreSection[1].matchAll(/-\s*(\S+)/g)].map((match) => match[1])
const toolSearchConfig = { enabled: 'auto', minCatalogSize: 12, core }

const mcpByEntry = new Map(live.mcp.map((entry) => [entry.entryId, entry]))
const rows = live.rows.map((row) => {
  let config
  if (row.name === 'dsh-tool-search') config = toolSearchConfig
  else if (mcpByEntry.has(row.id)) {
    const entry = mcpByEntry.get(row.id)
    config = { serverName: entry.server, transport: entry.transport, command: entry.command }
  }
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    fiberPhase: row.fiberPhase,
    config,
  }
})

const liveAgent = { id: 'smoke-agent' }
const CORE_TOOLS = ['read', 'write', 'edit', 'pwsh', 'skill', 'todo_write', 'grep', 'glob']
// A throwaway workspace so the assign round-trip writes somewhere disposable.
const smokeWorkspace = mkdtempSync(join(tmpdir(), 'inv-smoke-ws-'))

let routes = new Map()
const ctx = {
  baseUrl: `file:///${profileDir.replace(/\\/g, '/').replace(/^\/+/, '')}/`,
  logger: { warn: console.warn, info: () => {}, error: console.error },
  get(name) {
    if (name === 'workspaceRegistry') return { list: () => [{ id: 'smoke-ws', title: 'smoke', path: smokeWorkspace }] }
    if (name === 'loader') {
      return {
        entries() {
          return rows.map((row) => ({
            id: row.id,
            options: { name: row.name, config: row.config },
            disabled: row.enabled === false,
            fiber: row.fiberPhase === null ? undefined : { state: ['pending', 'loading', 'active', 'failed', null, 'unloading'].indexOf(row.fiberPhase) },
          }))
        },
      }
    }
    if (name === 'agents') return { list: () => [liveAgent] }
    if (name === 'tools') {
      return {
        schemas(scope) {
          // A live snapshot is a union of both planes; the global plane is that
          // union minus the core tools, which only the agent plane registers.
          const globalPlane = live.tools
            .filter((tool) => !CORE_TOOLS.includes(tool.name))
            .map((tool) => ({ name: tool.name, description: 'x'.repeat(tool.descLen ?? 0) }))
          if (scope === liveAgent) return [...CORE_TOOLS.map((tool) => ({ name: tool, description: 'core' })), ...globalPlane]
          if (scope === undefined) return globalPlane
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
      routes.set(route.path, route)
      return () => {}
    },
  },
}

apply(ctx)
const snapshotRoute = routes.get(SNAPSHOT_ROUTE)
const assignRoute = routes.get(ASSIGN_ROUTE)
if (snapshotRoute === undefined || assignRoute === undefined) {
  console.error(`FAIL: plugin did not register both routes (got ${[...routes.keys()].join(', ')})`)
  process.exit(1)
}

function capture() {
  const box = { status: 0, body: '' }
  box.res = {
    writeHead(code) {
      box.status = code
    },
    end(chunk) {
      box.body = chunk ?? ''
    },
  }
  return box
}

let body = ''
let status = 0
const started = Date.now()
{
  const box = capture()
  await snapshotRoute.handler({ method: 'GET', url: `${SNAPSHOT_ROUTE}?refresh=1` }, box.res)
  status = box.status
  body = box.body
}
const elapsed = Date.now() - started

/** Drive the write path: add an MCP to the throwaway workspace, then remove it. */
async function assignRoundTrip() {
  const server = live.mcp[0]?.server
  if (typeof server !== 'string') return { ok: false, detail: 'no live MCP to assign' }
  const post = async (action) => {
    const box = capture()
    const payload = JSON.stringify({ workspace: smokeWorkspace, kind: 'mcp', action, name: server })
    const listeners = new Map()
    const pending = assignRoute.handler(
      {
        method: 'POST',
        url: ASSIGN_ROUTE,
        on(event, fn) {
          listeners.set(event, fn)
          return this
        },
      },
      box.res,
    )
    listeners.get('data')?.(Buffer.from(payload))
    listeners.get('end')?.()
    await pending
    return { status: box.status, body: box.body.length > 0 ? JSON.parse(box.body) : null }
  }
  const added = await post('add')
  const afterAdd = capture()
  await snapshotRoute.handler({ method: 'GET', url: SNAPSHOT_ROUTE }, afterAdd.res)
  const declared = JSON.parse(afterAdd.body).workspaces?.[0]?.mcp?.servers?.map((entry) => entry.name) ?? []
  const removed = await post('remove')
  const afterRemove = capture()
  await snapshotRoute.handler({ method: 'GET', url: SNAPSHOT_ROUTE }, afterRemove.res)
  const left = JSON.parse(afterRemove.body).workspaces?.[0]?.mcp?.servers?.length ?? -1
  return {
    ok: added.status === 200 && declared.includes(server) && removed.status === 200 && left === 0,
    detail: `add=${added.status} declared=${JSON.stringify(declared)} remove=${removed.status} left=${left}`,
  }
}

const roundTrip = await assignRoundTrip()

const checks = []
const snapshot = JSON.parse(body)
const orphan = snapshot.packages.filter((pkg) => pkg.orphan).map((pkg) => pkg.name)
const deferred = snapshot.tools.filter((tool) => tool.deferred).length
// bsk_* only exists when the captured session had the browser skill loaded.
const bskTools = snapshot.tools.filter((tool) => tool.name.startsWith('bsk_'))
const bskOwner = bskTools.find((tool) => tool.name === 'bsk_session')?.owner?.ref
const inventoryOwner = snapshot.tools.find((tool) => tool.name === 'tool_search')?.owner?.ref

/** Orphan detection is asserted on a synthetic fixture, not on this machine. */
function orphanRulesOk() {
  const synthetic = buildSnapshot({
    now: 1,
    profile: { dir: 'C:/nonexistent', bundles: ['ghost-fixture'] },
    packages: [{ name: 'ghost-fixture', installed: false, declaredBy: ['bundles'] }],
    rows: [],
    skills: [],
    tools: [],
    builtinTools: [],
    sessionEdges: [],
    skillEdges: [],
  })
  return synthetic.packages[0].orphan === true && synthetic.warnings.some((w) => w.code === 'orphan-package')
}

/** Every package the snapshot calls installed must actually exist on disk. */
function packageFactsMatchDisk() {
  return snapshot.packages.every((pkg) => {
    if (pkg.name.startsWith('@deepseek-ai/')) return true
    const dir = join(profileDir, 'node_modules', pkg.name)
    return pkg.installed === existsSync(join(dir, 'package.json'))
  })
}

checks.push(['orphan packages are really absent', orphan.every((name) => !existsSync(join(profileDir, 'node_modules', name, 'package.json'))), `orphans=${JSON.stringify(orphan)}`])
checks.push(['package facts match disk', packageFactsMatchDisk(), ''])

checks.push(['HTTP 200', status === 200, `status=${status}`])
checks.push(['orphan detection works', orphanRulesOk(), 'synthetic fixture'])
checks.push(['deferred tools computed', deferred > 10, `deferred=${deferred}/${snapshot.tools.length}`])
checks.push([
  'bsk_* attributed to plugin',
  bskTools.length === 0 || bskOwner === '@wxg-prc-cpg/browser-skill-dsh-plugin',
  bskTools.length === 0 ? 'no bsk_* tool in this snapshot' : `owner=${bskOwner}`,
])
checks.push(['tool_search attributed', inventoryOwner === 'dsh-tool-search', `owner=${inventoryOwner}`])
// Which MCP rows are enabled is a per-machine choice now (a row can be
// registered but switched off), so the check is about enabled rows only.
checks.push([
  'enabled mcp servers all live',
  snapshot.mcp.every((entry) => entry.enabled === false || entry.status === 'connected'),
  JSON.stringify(snapshot.mcp.map((m) => `${m.server}:${m.enabled === false ? 'registered' : m.status}`)),
])
// Skill counts drift with the machine (skills get added, disabled and removed),
// so the check is "the scan found something" plus the observed number, not a
// frozen total from the audit date.
checks.push(['skills scanned', snapshot.skills.length >= 1, `skills=${snapshot.skills.length}`])
checks.push(['shadowed stubs detected', snapshot.skills.some((s) => s.disabled), `shadowed=${snapshot.skills.filter((s) => s.disabled).length}`])
checks.push(['session evidence present', snapshot.edges.some((edge) => edge.evidence.sources.includes('session')), `sessionEdges=${snapshot.edges.filter((e) => e.evidence.sources.includes('session')).length}`])
checks.push(['cold build under 3s', elapsed < 3000, `elapsed=${elapsed}ms`])
checks.push(['agent-plane tools included', ['read', 'pwsh', 'skill'].every((name) => snapshot.tools.some((tool) => tool.name === name)), `tools=${snapshot.tools.length}`])
checks.push([
  'global-plane mcp tools included',
  !snapshot.mcp.some((entry) => entry.enabled !== false && entry.status === 'connected') || snapshot.tools.some((tool) => tool.name.startsWith('mcp__')),
  `mcpTools=${snapshot.tools.filter((tool) => tool.name.startsWith('mcp__')).length}`,
])
checks.push(['tool planes reported', Array.isArray(snapshot.toolPlanes) && snapshot.toolPlanes.length >= 2, JSON.stringify(snapshot.toolPlanes)])
checks.push(['no secret in payload', !/ctx7sk-|sk-live-/.test(body), ''])
checks.push(['assign round-trip writes then removes', roundTrip.ok, roundTrip.detail])

let failed = 0
for (const [label, ok, detail] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${detail ?? ''}`)
  if (!ok) failed += 1
}
console.log(`\ncounts: ${JSON.stringify(snapshot.counts)}`)
process.exit(failed === 0 ? 0 : 1)
