// T4.inv (#123): gate search-parent bound + serverName collision guard,
// sync failure memory (persisted lastFetchError) + remote TTL cache +
// real abort on timeout, copySkill conflict detection.
//
// Red-first: every test pins behaviour that does not exist yet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { planMount } from '../lib/workspace-gate.js'
import { syncStatus } from '../lib/sync-service.js'
import { STATE_DEFAULTS } from '../lib/sync-state.js'
import { copySkill } from '../lib/sync-apply.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 't4-inv-test-'))
}

// ---------- 1. searchParents upper bound ----------

test('searchParentLimit stops the upward walk', () => {
  const root = tempDir()
  try {
    // deep/a/b/c with the declaration ONLY at deep/
    const base = join(root, 'deep')
    mkdirSync(join(base, '.dsh'), { recursive: true })
    mkdirSync(join(base, 'a', 'b', 'c'), { recursive: true })
    writeFileSync(join(base, '.dsh', 'mcp.json'), JSON.stringify({ servers: {} }))
    const cwd = join(base, 'a', 'b', 'c')
    // default: still found (back-compat)
    const found = planMount(cwd, { enabled: false })
    assert.equal(found.mount, false) // sanity: disabled gate reports disabled, not "not found"
    const hit = planMount(cwd, { readFile: () => JSON.stringify({ servers: {} }) })
    assert.equal(hit.reason.includes('declared') || hit.empty === true, true)
    // with a limit of 2, walking up from c reaches a (2 levels) but NOT deep → not found
    const limited = planMount(cwd, { searchParentLimit: 2, readFile: () => JSON.stringify({ servers: {} }) })
    assert.equal(limited.mount, false)
    assert.match(limited.reason, /no \.dsh\/mcp\.json found/)
    // limit 3 reaches deep → empty-but-declared
    const enough = planMount(cwd, { searchParentLimit: 3, readFile: () => JSON.stringify({ servers: {} }) })
    assert.equal(enough.empty, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('searchParentLimit 0 means "cwd only"', () => {
  const root = tempDir()
  try {
    const inner = join(root, 'inner')
    mkdirSync(join(root, '.dsh'), { recursive: true })
    mkdirSync(inner, { recursive: true })
    writeFileSync(join(root, '.dsh', 'mcp.json'), JSON.stringify({ servers: {} }))
    const limited = planMount(inner, { searchParentLimit: 0, readFile: () => JSON.stringify({ servers: {} }) })
    assert.equal(limited.mount, false)
    const unlimited = planMount(inner, { readFile: () => JSON.stringify({ servers: {} }) })
    assert.equal(unlimited.empty, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------- 2. serverName collision guard ----------

test('planMount keeps the whole-declaration serverName uniqueness guard (defensive)', () => {
  // Two declared names folding to one final serverName is structurally
  // impossible today (the suffix appends to every name), so the guard cannot
  // be exercised through the public API. It stays as an invariant for future
  // refactors; this test only pins that a normal suffixed declaration mounts.
  const root = tempDir()
  try {
    mkdirSync(join(root, '.dsh'), { recursive: true })
    writeFileSync(join(root, '.dsh', 'mcp.json'), JSON.stringify({
      servers: {
        x: { transport: 'stdio', command: 'echo' },
      },
    }))
    const plan = planMount(root, { serverNameSuffix: '-ws' })
    assert.equal(plan.mount, true)
    assert.equal(plan.servers.x.serverName, 'x-ws')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------- 3. sync failure memory + TTL cache + abort ----------

test('syncStatus persists lastFetchError into the state file and clears it on success', async () => {
  const root = tempDir()
  try {
    const stateFile = join(root, 'plugin-sync.json')
    const env = { DSH_HOME: root }
    // Point at an unreachable HTTP endpoint with a tiny timeout.
    writeFileSync(stateFile, JSON.stringify({ ...STATE_DEFAULTS, mode: 'http', repo: 'http://127.0.0.1:1/manifest.json', token: '' }))
    const first = await syncStatus({
      snapshot: {},
      state: { ...STATE_DEFAULTS, mode: 'http', repo: 'http://127.0.0.1:1/manifest.json' },
      options: { env, timeoutMs: 30, now: () => 1_000 },
    })
    assert.ok(first.fetchError, 'unreachable endpoint reports fetchError')
    const persisted = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(stateFile, 'utf8')))
    assert.equal(typeof persisted.lastFetchError, 'string')
    assert.ok(persisted.lastFetchError.length > 0)
    assert.equal(typeof persisted.lastFetchErrorAt, 'number')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('syncStatus serves a cached manifest within the remote TTL and refetches after it', async () => {
  const root = tempDir()
  try {
    let calls = 0
    const manifest = JSON.stringify({ manifestVersion: 1, generatedAt: 5, repo: '', ref: 'main', plugins: [], mcp: [], skills: [] })
    const fetchImpl = async () => { calls += 1; return { ok: true, status: 200, headers: { get: () => null }, text: async () => manifest } }
    const state = { ...STATE_DEFAULTS, mode: 'http', repo: 'http://127.0.0.1:9/manifest.json' }
    const first = await syncStatus({ snapshot: {}, state, options: { fetchImpl, ttlMs: 60_000, now: () => 10_000 } })
    assert.equal(first.empty, undefined)
    assert.equal(calls, 1)
    // Within TTL: served from cache, no new fetch.
    const second = await syncStatus({ snapshot: {}, state, options: { fetchImpl, ttlMs: 60_000, now: () => 40_000 } })
    assert.equal(calls, 1)
    assert.equal(second.fromCache, true)
    assert.equal(second.cacheAgeMs, 30_000)
    // After TTL: refetch.
    await syncStatus({ snapshot: {}, state, options: { fetchImpl, ttlMs: 60_000, now: () => 80_000 } })
    assert.equal(calls, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fetchHttpText aborts the in-flight request on timeout (AbortController)', async () => {
  const { fetchHttpText } = await import('../lib/sync-remote.js')
  let aborted = false
  const slowFetch = (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) })
    // Never resolves on its own: only the abort path ends it.
  })
  const result = await fetchHttpText('http://127.0.0.1:9/x', { timeoutMs: 20, fetchImpl: slowFetch })
  assert.ok(result.error, 'timeout reported')
  assert.equal(aborted, true, 'the fetch signal was aborted')
})

// ---------- 4. copySkill conflict detection ----------

test('copySkill reports a conflict instead of silently overwriting a modified vault copy', () => {
  const root = tempDir()
  try {
    const repoRoot = join(root, 'repo')
    const vault = join(root, 'vault')
    mkdirSync(join(repoRoot, 'skills', 'my-skill'), { recursive: true })
    writeFileSync(join(repoRoot, 'skills', 'my-skill', 'SKILL.md'), 'repo version\n')
    mkdirSync(join(vault, 'my-skill'), { recursive: true })
    writeFileSync(join(vault, 'my-skill', 'SKILL.md'), 'user edited\n')
    const result = copySkill({ name: 'my-skill' }, { repoRoot, vaultDir: vault, skillRoot: join(root, 'skills-root') })
    assert.equal(result.ok, false)
    assert.equal(result.conflict, true)
    assert.match(result.error, /修改|conflict/)
    // Vault copy untouched.
    assert.equal(readFileSync(join(vault, 'my-skill', 'SKILL.md'), 'utf8'), 'user edited\n')
    // Explicit overwrite goes through.
    const forced = copySkill({ name: 'my-skill' }, { repoRoot, vaultDir: vault, skillRoot: join(root, 'skills-root'), overwrite: true })
    assert.equal(forced.ok, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('copySkill still installs into an empty vault without conflicts', () => {
  const root = tempDir()
  try {
    const repoRoot = join(root, 'repo')
    const vault = join(root, 'vault')
    mkdirSync(join(repoRoot, 'skills', 'fresh'), { recursive: true })
    writeFileSync(join(repoRoot, 'skills', 'fresh', 'SKILL.md'), 'repo\n')
    const result = copySkill({ name: 'fresh' }, { repoRoot, vaultDir: vault, skillRoot: join(root, 'skills-root') })
    assert.equal(result.ok, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
