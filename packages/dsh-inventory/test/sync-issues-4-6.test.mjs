/**
 * Regression tests for the open sync issues owned by lib/sync-diff.js:
 *   #4  an MCP entry absent here is `blocked`, never selectable `missing`
 *   #6  the reverse pass reports locally installed MCP servers as `local-only`
 *
 * Only the public `diffManifest` surface is exercised: these cases assert what
 * the panel is told, never how a row is assembled internally.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { diffManifest } from '../lib/sync-diff.js'

function caps(overrides = {}) {
  return { platform: 'linux', hasCommand: () => false, gpu: false, ...overrides }
}

function entry(kind, name, extra = {}) {
  return { kind, name, platform: 'any', ...extra }
}

function manifestOf(entries = []) {
  return {
    manifestVersion: 1,
    generatedAt: 0,
    repo: 'o/r',
    ref: 'main',
    plugins: entries.filter((e) => e.kind === 'plugin'),
    mcp: entries.filter((e) => e.kind === 'mcp'),
    skills: entries.filter((e) => e.kind === 'skill'),
  }
}

function snapshotOf({ packages = [], mcp = [], skills = [] } = {}) {
  return { packages, mcp, skills }
}

function diff(entries, snapshot, capabilities = caps()) {
  return diffManifest(manifestOf(entries), snapshot, { capabilities })
}

/** The single row for `key`; fails loudly on zero or duplicated rows. */
function rowFor(rows, key) {
  const matches = rows.filter((row) => row.key === key)
  assert.equal(matches.length, 1, `expected exactly one row for ${key}, got ${matches.length}`)
  return matches[0]
}

function keysOf(rows) {
  return rows.map((row) => row.key)
}

// ---- #4: an absent manifest MCP entry is never selectable -------------------

test('#4 an absent MCP entry is blocked, never missing', () => {
  const rows = diff([entry('mcp', 'context7')], snapshotOf())
  const row = rowFor(rows, 'mcp:context7')
  assert.equal(row.status, 'blocked')
  assert.match(row.reason, /MCP/)
  // Nothing on the MCP side may be selectable: `applyItems` refuses every mcp
  // entry, so a `missing` row would offer a checkbox that can only fail.
  assert.equal(rows.filter((r) => r.kind === 'mcp' && r.status === 'missing').length, 0)
})

test('#4 an absent MCP entry stays blocked under every eligibility outcome', () => {
  // Wrong platform, a missing external command, a GPU requirement: each of
  // those would have produced a different eligibility reason for a plugin. For
  // MCP none of them may flip the status, and the reason must still name MCP
  // because that is the only thing the user can act on.
  const cases = [
    [entry('mcp', 'win-only', { platform: 'win32' }), caps()],
    [entry('mcp', 'tool-dep', { requires: ['officecli'] }), caps()],
    [entry('mcp', 'gpu-dep', { requires: ['gpu'] }), caps({ gpu: false })],
    [entry('mcp', 'satisfied', { requires: ['officecli'] }), caps({ hasCommand: () => true })],
  ]
  for (const [mcpEntry, capabilities] of cases) {
    const row = rowFor(diff([mcpEntry], snapshotOf(), capabilities), `mcp:${mcpEntry.name}`)
    assert.equal(row.status, 'blocked', `${mcpEntry.name} must be blocked`)
    assert.match(row.reason, /MCP/, `${mcpEntry.name} reason must mention MCP`)
  }
})

test('#4 an absent self MCP entry is skip, while a plain one is blocked', () => {
  // `self` outranks the missing-installer rule exactly as it does everywhere
  // else: the sync plugin is out of scope, so it is never an install target.
  const rows = diff([entry('mcp', 'dsh-sync', { self: true }), entry('mcp', 'context7')], snapshotOf())
  assert.equal(rowFor(rows, 'mcp:dsh-sync').status, 'skip')
  assert.equal(rowFor(rows, 'mcp:context7').status, 'blocked')
})

test('#4 an absent MCP entry is blocked even when the snapshot is null', () => {
  // A fresh install has no snapshot at all; the answer must not change.
  const rows = diffManifest(manifestOf([entry('mcp', 'context7')]), null, { capabilities: caps() })
  assert.equal(rowFor(rows, 'mcp:context7').status, 'blocked')
})

test('#4 an installed MCP entry keeps its normal status', () => {
  // The blocked rule is about a missing install path, not about MCP servers
  // being second-class: an installed one reports current, outdated or disabled
  // exactly like a plugin.
  const current = diff([entry('mcp', 'context7')], snapshotOf({ mcp: [{ server: 'context7', enabled: true }] }))
  assert.equal(rowFor(current, 'mcp:context7').status, 'current')

  const outdated = diff(
    [entry('mcp', 'context7', { version: '0.2.0' })],
    snapshotOf({ mcp: [{ server: 'context7', version: '0.1.0', enabled: true }] }),
  )
  assert.equal(rowFor(outdated, 'mcp:context7').status, 'outdated')

  const disabled = diff([entry('mcp', 'context7')], snapshotOf({ mcp: [{ server: 'context7', enabled: false }] }))
  assert.equal(rowFor(disabled, 'mcp:context7').status, 'disabled')
})

// ---- #6: locally installed MCP servers appear in the reverse pass -----------

test('#6 a local MCP server absent from the manifest is local-only once', () => {
  const rows = diff([], snapshotOf({ mcp: [{ server: 'context7', enabled: true }] }))
  const mcpRows = rows.filter((row) => row.kind === 'mcp')
  assert.equal(mcpRows.length, 1)
  assert.equal(mcpRows[0].key, 'mcp:context7')
  assert.equal(mcpRows[0].status, 'local-only')
  assert.equal(rowFor(rows, 'mcp:context7').name, 'context7')
})

test('#6 a local MCP server the manifest names is not local-only', () => {
  const rows = diff(
    [entry('mcp', 'context7')],
    snapshotOf({ mcp: [{ server: 'context7', enabled: true }] }),
  )
  assert.equal(rowFor(rows, 'mcp:context7').status, 'current')
  assert.equal(rows.filter((row) => row.status === 'local-only').length, 0)
  // Same for a manifest entry that is absent here: blocked, and the installed
  // server next to it must not produce a second row for the same key.
  const blockedAndLocal = diff([entry('mcp', 'other')], snapshotOf({ mcp: [{ server: 'context7' }] }))
  assert.equal(rowFor(blockedAndLocal, 'mcp:context7').status, 'local-only')
})

test('#6 a local-only MCP row has the same shape as a manifest MCP row', () => {
  // The panel renders local-only rows with the same component as the rest, so
  // a missing field here would surface as a broken cell.
  const localOnly = rowFor(diff([], snapshotOf({ mcp: [{ server: 'context7', enabled: true }] })), 'mcp:context7')
  assert.equal(localOnly.kind, 'mcp')
  assert.equal(localOnly.name, 'context7')
  assert.equal(localOnly.key, 'mcp:context7')
  assert.equal(localOnly.platform, 'any')
  assert.deepEqual(localOnly.requires, [])
  assert.equal(localOnly.self, false)
  assert.equal(typeof localOnly.reason, 'string')
  assert.ok(localOnly.reason.length > 0)
})

test('#6 a local MCP server without a version still yields a sane row', () => {
  // The snapshot's mcp rows come from the inventory and carry no version, so
  // this is the normal case, not an edge case: it must not invent a number or
  // crash on a version comparison.
  const rows = diff([], snapshotOf({ mcp: [{ server: 'context7', enabled: true, status: 'connected' }] }))
  const row = rowFor(rows, 'mcp:context7')
  assert.equal(row.status, 'local-only')
  assert.equal(row.version, undefined)
})

test('#6 a local MCP server whose name collides with a plugin stays a distinct key', () => {
  // `mcp:` and `plugin:` are different namespaces; a server named like a plugin
  // must not be swallowed by the plugin's row.
  const rows = diff(
    [],
    snapshotOf({
      packages: [{ name: 'dsh-ctx-guard', version: '0.1.1' }],
      mcp: [{ server: 'dsh-ctx-guard', enabled: true }],
    }),
  )
  assert.equal(rowFor(rows, 'plugin:dsh-ctx-guard').status, 'local-only')
  assert.equal(rowFor(rows, 'mcp:dsh-ctx-guard').status, 'local-only')
  assert.equal(keysOf(rows).length, new Set(keysOf(rows)).size)
})

test('#6 local-only MCP rows coexist with local-only plugin and skill rows', () => {
  const rows = diff(
    [],
    snapshotOf({
      packages: [{ name: 'dsh-extra', version: '1.0.0' }, { name: '@deepseek-ai/dsh-base', version: '0.2.1' }],
      mcp: [{ server: 'context7', enabled: true }, { server: 'sequential', enabled: false }],
      skills: [{ name: 'my-skill' }],
    }),
  )
  assert.equal(rowFor(rows, 'plugin:dsh-extra').status, 'local-only')
  assert.equal(rowFor(rows, 'mcp:context7').status, 'local-only')
  assert.equal(rowFor(rows, 'mcp:sequential').status, 'local-only')
  assert.equal(rowFor(rows, 'skill:my-skill').status, 'local-only')

  // No key may be reported twice across the whole row set: a duplicate would
  // render two checkboxes for one item, and publishing it would double-write.
  const keys = keysOf(rows)
  assert.equal(keys.length, new Set(keys).size, `duplicate keys in ${keys.join(', ')}`)
})
