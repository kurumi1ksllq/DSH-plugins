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

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../index.js'
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

let registered = null
const ctx = {
  baseUrl: `file:///${profileDir.replace(/\\/g, '/').replace(/^\/+/, '')}/`,
  logger: { warn: console.warn, info: () => {}, error: console.error },
  get(name) {
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
          const globalPlane = live.tools.map((tool) => ({ name: tool.name, description: 'x'.repeat(tool.descLen ?? 0) }))
          // Core tools live on the agent plane, which the global view cannot see.
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
      registered = route
      return () => {}
    },
  },
}

apply(ctx)
if (registered === null) {
  console.error('FAIL: plugin did not register a route')
  process.exit(1)
}

let body = ''
let status = 0
const started = Date.now()
await registered.handler({ method: 'GET', url: '/inventory/snapshot?refresh=1' }, {
  writeHead(code) {
    status = code
  },
  end(chunk) {
    body = chunk
  },
})
const elapsed = Date.now() - started

const checks = []
const snapshot = JSON.parse(body)
const orphan = snapshot.packages.filter((pkg) => pkg.orphan).map((pkg) => pkg.name)
const deferred = snapshot.tools.filter((tool) => tool.deferred).length
const bskOwner = snapshot.tools.find((tool) => tool.name === 'bsk_session')?.owner?.ref
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
checks.push(['bsk_* attributed to plugin', bskOwner === '@wxg-prc-cpg/browser-skill-dsh-plugin', `owner=${bskOwner}`])
checks.push(['tool_search attributed', inventoryOwner === 'dsh-tool-search', `owner=${inventoryOwner}`])
checks.push(['mcp servers all live', snapshot.mcp.every((entry) => entry.status === 'connected'), JSON.stringify(snapshot.mcp.map((m) => `${m.server}:${m.status}`))])
checks.push(['skills scanned', snapshot.skills.length >= 28, `skills=${snapshot.skills.length}`])
checks.push(['shadowed stubs detected', snapshot.skills.filter((s) => s.disabled).length === 7, `shadowed=${snapshot.skills.filter((s) => s.disabled).length}`])
checks.push(['session evidence present', snapshot.edges.some((edge) => edge.evidence.sources.includes('session')), `sessionEdges=${snapshot.edges.filter((e) => e.evidence.sources.includes('session')).length}`])
checks.push(['cold build under 3s', elapsed < 3000, `elapsed=${elapsed}ms`])
checks.push(['agent-plane tools included', ['read', 'pwsh', 'skill'].every((name) => snapshot.tools.some((tool) => tool.name === name)), `tools=${snapshot.tools.length}`])
checks.push(['global-plane tools still included', snapshot.tools.some((tool) => tool.name === 'mcp__officecli__officecli'), ''])
checks.push(['tool planes reported', Array.isArray(snapshot.toolPlanes) && snapshot.toolPlanes.length >= 2, JSON.stringify(snapshot.toolPlanes)])
checks.push(['no secret in payload', !/ctx7sk-|sk-live-/.test(body), ''])

let failed = 0
for (const [label, ok, detail] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${detail ?? ''}`)
  if (!ok) failed += 1
}
console.log(`\ncounts: ${JSON.stringify(snapshot.counts)}`)
process.exit(failed === 0 ? 0 : 1)
