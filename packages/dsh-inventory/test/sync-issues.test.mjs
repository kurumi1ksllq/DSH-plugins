/**
 * Regression tests for the open sync issues:
 *   #3  publish ignores generatedAt when deciding "unchanged"
 *   #4  MCP entries are blocked, never selectable `missing`
 *   #6  reverse diff reports local-only MCP servers
 *   #9  installed-but-ineligible entries report blocked
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { publishManifest, prepareManifestText } from '../lib/sync-publish.js'
import { diffManifest } from '../lib/sync-diff.js'

function caps(overrides = {}) {
  return { platform: 'linux', hasCommand: () => false, gpu: false, ...overrides }
}

function manifest(entries) {
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

// ---- #3 ------------------------------------------------------------------

test('#3 publish skips the commit when only generatedAt changed', async () => {
  let put = null
  // Build the stored file with the same pipeline the plugin publishes with,
  // then bump generatedAt the way every rebuild does.
  const built = prepareManifestText(manifest([{ kind: 'plugin', name: 'a', version: '1.0.0', source: 'npm' }]))
  const existing = built.text.replace(/"generatedAt": 0/, '"generatedAt": 111')
  const fetchImpl = async (url, init) => {
    if (init?.method === 'PUT') {
      put = {}
      return { ok: true, status: 200, json: async () => ({ content: { sha: 'new' } }) }
    }
    return {
      ok: true, status: 200,
      json: async () => ({ sha: 'old', content: Buffer.from(existing).toString('base64'), encoding: 'base64' }),
    }
  }
  const result = await publishManifest({
    owner: 'o', repo: 'r', token: 't',
    manifest: manifest([{ kind: 'plugin', name: 'a', version: '1.0.0', source: 'npm' }]),
    fetchImpl,
  })
  assert.equal(result.ok, true)
  assert.equal(result.unchanged, true)
  assert.equal(put, null)
})

test('#3 publish still commits when semantic content differs', async () => {
  let put = null
  const existing = JSON.stringify({
    manifestVersion: 1, generatedAt: 111, repo: 'o/r', ref: 'main',
    plugins: [{ kind: 'plugin', name: 'a', version: '1.0.0', source: 'npm', platform: 'any', requires: [], self: false }],
    mcp: [], skills: [],
  }, null, 2)
  const fetchImpl = async (url, init) => {
    if (init?.method === 'PUT') {
      put = {}
      return { ok: true, status: 200, json: async () => ({ content: { sha: 'new' } }) }
    }
    return {
      ok: true, status: 200,
      json: async () => ({ sha: 'old', content: Buffer.from(existing).toString('base64'), encoding: 'base64' }),
    }
  }
  const result = await publishManifest({
    owner: 'o', repo: 'r', token: 't',
    manifest: manifest([{ kind: 'plugin', name: 'a', version: '2.0.0', source: 'npm' }]),
    fetchImpl,
  })
  assert.equal(result.unchanged, false)
  assert.notEqual(put, null)
})

// ---- #4 / #6 / #9 ---------------------------------------------------------

test('#4 a missing MCP entry is blocked, not selectable missing', () => {
  const rows = diffManifest(
    manifest([{ kind: 'mcp', name: 'context7', platform: 'any' }]),
    { packages: [], mcp: [], skills: [] },
    { capabilities: caps() },
  )
  const row = rows.find((r) => r.key === 'mcp:context7')
  assert.equal(row.status, 'blocked')
  assert.match(row.reason, /暂不支持自动安装/)
})

test('#6 a local MCP server absent from the manifest is local-only', () => {
  const rows = diffManifest(
    manifest([]),
    { packages: [], mcp: [{ server: 'context7', enabled: true }], skills: [] },
    { capabilities: caps() },
  )
  const row = rows.find((r) => r.key === 'mcp:context7')
  assert.equal(row.status, 'local-only')
})

test('#9 an installed plugin that cannot run here is blocked, not current', () => {
  const rows = diffManifest(
    manifest([{ kind: 'plugin', name: 'dsh-git-bash-tool', version: '0.1.0', source: 'repo', platform: 'win32' }]),
    { packages: [{ name: 'dsh-git-bash-tool', version: '0.1.0' }], mcp: [], skills: [] },
    { capabilities: caps() },
  )
  const row = rows.find((r) => r.key === 'plugin:dsh-git-bash-tool')
  assert.equal(row.status, 'blocked')
  assert.match(row.reason, /仅支持 win32/)
})

// ---- #5 / #7 / #8 / #10 / #12 ----------------------------------------------
// These live in sync-issues-2.test.mjs to keep each file small.
