import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { collectPackages } from '../lib/profile-packages.js'
import { buildPluginToolIndex } from '../lib/plugin-tool-index.js'
import { BUILTIN_TOOLS, detectDeferred } from '../lib/tool-owners.js'
import { buildSnapshot } from '../lib/inventory.js'
import { scanSkillRoots } from '../lib/scan-skills.js'

// #145: every scratch directory this file makes is registered and removed at the
// end of the run. Leaving them behind accumulated hundreds of dsh-* trees in the
// OS temp dir on every full test run.
const scratchRegistry = []
after(() => {
  for (const dir of scratchRegistry) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows may still hold a handle; a temp leftover is harmless.
    }
  }
})

/** Register a directory for cleanup at the end of the run. */
function track(dir) {
  scratchRegistry.push(dir)
  return dir
}

function bundleDir(root, dir, content) {
  mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, dir, 'SKILL.md'), content)
}

function makeProfile({ dependencies = {}, bundles = [], installed = [] }) {
  const dir = track(mkdtempSync(join(tmpdir(), 'inv-profile-')))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies, dsh: { profile: { bundles } } }, null, 2))
  for (const name of installed) {
    const pkgDir = join(dir, 'node_modules', name)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version: '1.2.3', main: 'index.js' }))
    // A real install ships its entry file; `installed` alone is not enough.
    writeFileSync(join(pkgDir, 'index.js'), 'export default {}\n')
  }
  return dir
}

test('collectPackages marks an unresolvable, non-builtin bundle as not installed', () => {
  const dir = makeProfile({
    dependencies: { 'third-party-plugin': '1.0.0' },
    bundles: ['@deepseek-ai/dsh-base', 'third-party-plugin', 'dsh-websearch-failover'],
    installed: ['third-party-plugin'],
  })

  const packages = collectPackages(dir, [
    { id: 'x', name: 'third-party-plugin', fiberPhase: 'active' },
    { id: 'y', name: 'dsh-websearch-failover', fiberPhase: null },
  ])
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]))

  assert.equal(byName.get('third-party-plugin').installed, true)
  assert.equal(byName.get('third-party-plugin').loaded, true)
  assert.equal(byName.get('third-party-plugin').version, '1.2.3')

  // Declared + row present, but no package on disk and the fiber never came up.
  assert.equal(byName.get('dsh-websearch-failover').installed, false)
  assert.equal(byName.get('dsh-websearch-failover').loaded, false)

  // Built-in bundle resolves from the app, not from node_modules.
  assert.equal(byName.get('@deepseek-ai/dsh-base').installed, true)
})

test('a package.json without its main entry counts as not installed', () => {
  const dir = makeProfile({ dependencies: { 'half-baked': '1.0.0' }, installed: [] })
  const pkgDir = join(dir, 'node_modules', 'half-baked')
  mkdirSync(pkgDir, { recursive: true })
  // package.json claims `main: ./index.js`, but the entry file never landed.
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'half-baked', version: '1.0.0', main: './index.js' }))

  const packages = collectPackages(dir, [{ id: 'half', name: 'half-baked', fiberPhase: null }])
  assert.equal(packages[0].installed, false)
  assert.equal(packages[0].loaded, false)
})

test('buildPluginToolIndex finds tools declared in .mjs and nested lib files', () => {
  const dir = makeProfile({ dependencies: { 'browser-plugin': '1.0.0' }, installed: [] })
  const libDir = join(dir, 'node_modules', 'browser-plugin', 'lib')
  mkdirSync(libDir, { recursive: true })
  writeFileSync(join(libDir, 'index.mjs'), "ctx.tools.register({ name: 'bsk_session' })\n")
  const nested = join(libDir, 'tools')
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(nested, 'page.cjs'), "register({ name: 'bsk_page' })\n")

  const index = buildPluginToolIndex({
    profileDir: dir,
    packages: [{ name: 'browser-plugin', installed: true }],
    toolNames: ['bsk_session', 'bsk_page', 'read', 'mcp__x__y'],
    builtinTools: ['read'],
  })

  assert.equal(index.bsk_session, 'browser-plugin')
  assert.equal(index.bsk_page, 'browser-plugin')
  assert.equal(index.read, undefined)
  assert.equal(index['mcp__x__y'], undefined)
})

test('a declaration site outranks a mere mention, and the inventory package never claims tools', () => {
  const dir = makeProfile({ dependencies: { 'mentions-tools': '1.0.0', 'declares-tools': '1.0.0', 'dsh-inventory': '0.1.0' }, installed: [] })
  for (const name of ['mentions-tools', 'declares-tools', 'dsh-inventory']) {
    mkdirSync(join(dir, 'node_modules', name), { recursive: true })
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
  }
  writeFileSync(join(dir, 'node_modules', 'mentions-tools', 'index.js'), "const bridge = ['tool_search', 'tool_describe']\n")
  writeFileSync(join(dir, 'node_modules', 'declares-tools', 'index.js'), "ctx.tools.register({ name: 'tool_search' })\n")
  writeFileSync(join(dir, 'node_modules', 'dsh-inventory', 'client.js'), "const bridge = ['tool_search']\n")

  const index = buildPluginToolIndex({
    profileDir: dir,
    packages: [
      { name: 'mentions-tools', installed: true },
      { name: 'declares-tools', installed: true },
      { name: 'dsh-inventory', installed: true },
    ],
    toolNames: ['tool_search'],
    builtinTools: [],
    selfPackage: 'dsh-inventory',
  })

  assert.equal(index.tool_search, 'declares-tools')
})

test('a package is loaded through its sub-path rows, and a row-less bundle is not called "not loaded"', () => {
  const dir = makeProfile({
    dependencies: { 'dsh-doublecheck': '0.9.29' },
    bundles: ['@deepseek-ai/dsh-base', 'dsh-doublecheck'],
  })

  const packages = collectPackages(dir, [
    { id: 'include:doublecheck-grill', name: 'dsh-doublecheck/grill', fiberPhase: 'active' },
    { id: 'include:doublecheck-guard', name: 'dsh-doublecheck/guard', fiberPhase: 'active' },
  ])
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]))

  // The package composes `dsh-doublecheck/grill`; it has no row named after
  // itself, so matching on the exact name alone reported a running plugin as
  // not loaded.
  assert.equal(byName.get('dsh-doublecheck').loaded, true)
  assert.equal(byName.get('dsh-doublecheck').fiberPhase, 'active')
  assert.equal(byName.get('dsh-doublecheck').rowless, false)

  // A bundle manifest owns no row at all: that is "no evidence", not "off".
  assert.equal(byName.get('@deepseek-ai/dsh-base').loaded, false)
  assert.equal(byName.get('@deepseek-ai/dsh-base').rowless, true)
})

test('tools registered by a plugin are never claimed as builtin', () => {
  const snapshot = buildSnapshot({
    now: 1,
    packages: [],
    rows: [],
    tools: [
      { name: 'read', deferred: false },
      { name: 'lsp_diagnostics', deferred: false },
      { name: 'doublecheck_spec', deferred: false },
    ],
    builtinTools: BUILTIN_TOOLS,
    pluginTools: { lsp_diagnostics: 'dsh-lsp-actions', doublecheck_spec: 'dsh-doublecheck' },
    skillEdges: [],
    sessionEdges: [],
  })
  const ownerOf = (name) => snapshot.tools.find((tool) => tool.name === name).owner

  assert.equal(ownerOf('read').kind, 'builtin')
  // A plugin tool listed as builtin is both mislabelled in the UI and skipped
  // by the ownership scan, which ignores builtin names.
  assert.equal(ownerOf('lsp_diagnostics').kind, 'plugin')
  assert.equal(ownerOf('lsp_diagnostics').ref, 'dsh-lsp-actions')
  assert.equal(ownerOf('doublecheck_spec').kind, 'plugin')
  assert.equal(ownerOf('doublecheck_spec').ref, 'dsh-doublecheck')
  assert.equal(BUILTIN_TOOLS.includes('lsp_diagnostics'), false)
  assert.equal(BUILTIN_TOOLS.includes('doublecheck_spec'), false)
})

test('detectDeferred honours the tool-search core allowlist', () => {
  const deferred = detectDeferred({
    toolNames: ['read', 'mcp__davinci-resolve__timeline', 'tool_search'],
    toolSearch: { enabled: 'auto', minCatalogSize: 3, core: ['read'], bridgeNames: ['tool_search'] },
  })
  assert.equal(deferred.has('read'), false)
  assert.equal(deferred.has('tool_search'), false)
  assert.equal(deferred.has('mcp__davinci-resolve__timeline'), true)

  const off = detectDeferred({ toolNames: ['read'], toolSearch: { enabled: 'off', core: ['read'] } })
  assert.equal(off.size, 0)

  const booleanOff = detectDeferred({ toolNames: ['read'], toolSearch: { enabled: false, core: [] } })
  assert.equal(booleanOff.size, 0)

  const absent = detectDeferred({ toolNames: ['read'], toolSearch: null })
  assert.equal(absent.size, 0)
})

test('an unreadable skill file is skipped with a diagnostic, not a throw', () => {
  const root = track(mkdtempSync(join(tmpdir(), 'inv-skills-unreadable-')))
  bundleDir(root, 'ghost', '---\nname: ghost\ndescription: Ghost\n---\n# ghost\n')

  const { skills, diagnostics } = scanSkillRoots([{ dir: root, source: 'user-dsh', rank: 400 }], {
    readText: () => {
      throw new Error('EACCES: permission denied')
    },
  })

  assert.deepEqual(skills, [])
  assert.ok(diagnostics.some((d) => d.kind === 'unreadable-file'), JSON.stringify(diagnostics))
})
