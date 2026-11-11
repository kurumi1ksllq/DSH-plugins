/**
 * Regression tests for sync call-3 issues:
 *   #3  the "unchanged" check must tolerate every formatting the publisher can
 *       produce, so only a real content change creates a commit
 *   #10 lastPullAt is recorded on a real pull, honours an injected clock, and
 *       is visible to the panel
 *
 * State isolation: `readState`/`writeState` resolve the file from
 * `process.env.DSH_HOME`, so every test that touches state points it at a
 * fresh temp directory (the pattern `sync-issues-2.test.mjs` uses) and never at
 * the developer's real `~/.dsh`.
 *
 * Tests run one at a time: they swap a process-wide environment variable, and
 * the default `node --test` mode runs files in parallel but tests sequentially.
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildManifest } from '../lib/manifest.js'
import { publicState } from '../lib/sync-state.js'
import { prepareManifestText, publishManifest, sameManifest } from '../lib/sync-publish.js'
import { syncApply, syncPublish, syncStatus } from '../lib/sync-service.js'

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

function caps(overrides = {}) {
  return { platform: 'linux', hasCommand: () => false, gpu: false, ...overrides }
}

function manifest(overrides = {}) {
  return {
    manifestVersion: 1,
    generatedAt: 0,
    repo: 'o/r',
    ref: 'main',
    // `spec` is part of what `buildManifest` emits for an npm source, so the
    // baseline file must carry it or every comparison would differ by it.
    plugins: [{ kind: 'plugin', name: 'a', version: '1.0.0', source: 'npm', spec: '1.0.0', platform: 'any' }],
    mcp: [],
    skills: [],
    ...overrides,
  }
}

const SNAPSHOT = {
  packages: [{ name: 'a', spec: 'npm:1.0.0', version: '1.0.0' }],
  mcp: [],
  skills: [],
}

function state(overrides = {}) {
  return {
    repo: 'o/r',
    ref: 'main',
    path: 'dsh-manifest.json',
    token: 't',
    annotations: {},
    lastPullAt: 0,
    lastPushAt: 0,
    ...overrides,
  }
}

/** A fetch stand-in that serves `existing` and counts PUT requests. */
function github(existing) {
  const calls = { put: 0 }
  const fetchImpl = async (url, init) => {
    if (init?.method === 'PUT') {
      calls.put += 1
      return { ok: true, status: 201, json: async () => ({ content: { sha: 'new-sha' } }) }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ sha: 'old-sha', content: Buffer.from(existing, 'utf8').toString('base64'), encoding: 'base64' }),
    }
  }
  return { calls, fetchImpl }
}

/** Text the publisher itself would write for `manifest` — the baseline file. */
function published(overrides = {}) {
  return prepareManifestText(manifest(overrides)).text
}

/** The file this machine would publish for `SNAPSHOT`, as `syncStatus` sees it. */
const SNAPSHOT_MANIFEST_TEXT = JSON.stringify(
  buildManifest(SNAPSHOT, { now: 1, repo: 'o/r', ref: 'main' }),
  null,
  2,
)

/**
 * Run with `DSH_HOME` pointed at a throwaway directory, then restore it.
 *
 * The state module is imported AFTER the env is set, so the test can never
 * resolve `~/.dsh/plugin-sync.json` of the machine running it.
 */
async function withTempHome(run) {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = track(mkdtempSync(join(tmpdir(), 'dsh-sync-issues-3-10-')))
  try {
    const mod = await import('../lib/sync-state.js')
    return await run(mod)
  } finally {
    // The writes are fire-and-forget in the service; give the queue a tick so
    // the temp file is settled before the directory is abandoned.
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
}

// ---- #3: the unchanged check tolerates formatting -------------------------

test('#3 only generatedAt differs: no PUT, reported unchanged', async () => {
  // The stored file is byte-identical to a new build except for the timestamp.
  const existing = published().replace('"generatedAt": 0', '"generatedAt": 111')
  const { calls, fetchImpl } = github(existing)
  const result = await publishManifest({ owner: 'o', repo: 'r', token: 't', manifest: manifest(), fetchImpl })
  assert.equal(result.ok, true)
  assert.equal(result.unchanged, true)
  assert.equal(result.created, false)
  assert.equal(result.sha, 'old-sha')
  assert.equal(calls.put, 0)
})

test('#3 generatedAt in another position is still unchanged', async () => {
  const moved = JSON.stringify({
    // Timestamp written last, i.e. a hand edit or an older publisher.
    repo: 'o/r',
    ref: 'main',
    manifestVersion: 1,
    plugins: manifest().plugins,
    mcp: [],
    skills: [],
    generatedAt: 999999,
  }, null, 2)
  const { calls, fetchImpl } = github(moved)
  const result = await publishManifest({ owner: 'o', repo: 'r', token: 't', manifest: manifest(), fetchImpl })
  assert.equal(result.unchanged, true)
  assert.equal(calls.put, 0)
})

test('#3 a different indentation / CRLF / extra blank lines is unchanged', async () => {
  const compact = JSON.stringify(manifest({ generatedAt: 42 }))
  const crlf = `${JSON.stringify(manifest({ generatedAt: 43 }), null, 4).replace(/\n/g, '\r\n')}\r\n\r\n`
  for (const existing of [compact, crlf]) {
    const { calls, fetchImpl } = github(existing)
    const result = await publishManifest({ owner: 'o', repo: 'r', token: 't', manifest: manifest(), fetchImpl })
    assert.equal(result.unchanged, true, 'a differently formatted file must compare equal')
    assert.equal(calls.put, 0)
  }
})

test('#3 a duplicate generatedAt key does not defeat the comparison', async () => {
  // JSON.parse keeps the last duplicate; the publisher writes a single key.
  const duplicated = published().replace('"generatedAt": 0', '"generatedAt": 1,\n  "generatedAt": 2')
  const { calls, fetchImpl } = github(duplicated)
  const result = await publishManifest({ owner: 'o', repo: 'r', token: 't', manifest: manifest(), fetchImpl })
  assert.equal(result.unchanged, true)
  assert.equal(calls.put, 0)
})

test('#3 a redaction-report-only difference does not create a commit', async () => {
  // A stored file that carries a stale report of what was stripped elsewhere.
  const withReport = JSON.stringify({
    ...manifest({ generatedAt: 7 }),
    report: { secretCount: 3, secretPaths: ['plugins[0].apiKey'], pathCount: 1, pathPaths: ['plugins[1].command'] },
  }, null, 2)
  const { calls, fetchImpl } = github(withReport)
  const result = await publishManifest({ owner: 'o', repo: 'r', token: 't', manifest: manifest(), fetchImpl })
  assert.equal(result.unchanged, true)
  assert.equal(calls.put, 0)
})

test('#3 a real content change still creates a commit', async () => {
  const existing = published().replace('"generatedAt": 0', '"generatedAt": 111')
  const { calls, fetchImpl } = github(existing)
  const changed = manifest({ plugins: [{ kind: 'plugin', name: 'a', version: '2.0.0', source: 'npm', spec: '2.0.0', platform: 'any' }] })
  const result = await publishManifest({ owner: 'o', repo: 'r', token: 't', manifest: changed, fetchImpl })
  assert.equal(result.ok, true)
  assert.equal(result.unchanged, false)
  assert.equal(calls.put, 1)
})

test('#3 an unparsable stored file is overwritten rather than skipped', async () => {
  const { calls, fetchImpl } = github('{broken')
  const result = await publishManifest({ owner: 'o', repo: 'r', token: 't', manifest: manifest(), fetchImpl })
  assert.equal(result.ok, true)
  assert.notEqual(result.unchanged, true)
  assert.equal(calls.put, 1)
})

test('#3 sameManifest ignores only the volatile keys', () => {
  assert.equal(sameManifest('{"a":1,"generatedAt":1}', '{"a":1}'), true)
  assert.equal(sameManifest('{"a":1}', '{"a":2}'), false)
  assert.equal(sameManifest('{broken', '{"a":1}'), null)
  assert.equal(sameManifest(undefined, '{"a":1}'), null)
  // Nested volatile keys are ignored too; an unknown extra field is not.
  assert.equal(sameManifest('{"x":{"generatedAt":1,"v":2}}', '{"x":{"v":2}}'), true)
  assert.equal(sameManifest('{"x":{"v":2,"extra":1}}', '{"x":{"v":2}}'), false)
})

// ---- #3: the panel is told the truth -------------------------------------

test('#3 syncPublish leaves lastPushAt untouched on an unchanged publish', async () => {
  await withTempHome(async ({ readState, writeState }) => {
    await writeState({ lastPushAt: 4242 })
    const existing = published().replace('"generatedAt": 0', '"generatedAt": 500')
    const { calls, fetchImpl } = github(existing)
    const result = await syncPublish({
      snapshot: SNAPSHOT,
      state: state(),
      now: 999999,
      options: { fetchImpl },
    })
    assert.equal(result.ok, true)
    assert.equal(result.unchanged, true)
    assert.equal(calls.put, 0)
    // The payload says so honestly, and the stored push time is not bumped.
    assert.equal(result.generatedAt, 999999)
    assert.equal(readState().lastPushAt, 4242)
  })
})

test('#3 syncPublish records lastPushAt on a real change', async () => {
  await withTempHome(async ({ readState }) => {
    const { fetchImpl } = github('{"manifestVersion":1,"generatedAt":1,"repo":"o/r","ref":"main","plugins":[],"mcp":[],"skills":[]}')
    const result = await syncPublish({
      snapshot: SNAPSHOT,
      state: state(),
      now: 777,
      options: { fetchImpl },
    })
    assert.equal(result.ok, true)
    assert.notEqual(result.unchanged, true)
    assert.equal(readState().lastPushAt, 777)
  })
})

// ---- #10: lastPullAt ------------------------------------------------------

test('#10 syncStatus records the injected pull time and exposes it to the panel', async () => {
  await withTempHome(async ({ readState }) => {
    // The stored file is what THIS machine would publish, up to the timestamp.
    const text = SNAPSHOT_MANIFEST_TEXT
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => text })
    const status = await syncStatus({
      snapshot: SNAPSHOT,
      state: state({ token: '' }),
      options: { now: 1234567, capabilities: caps(), fetchImpl },
    })
    assert.equal(status.fetchError, undefined)
    // Only a genuinely successful pull records a time; it is non-zero and exact.
    assert.equal(readState().lastPullAt, 1234567)
    // The panel reads `lastPullAt` out of publicState after its own reload.
    const panel = syncStatus0({ snapshot: SNAPSHOT, state: readState() })
    assert.equal(panel.state.lastPullAt, 1234567)
  })
})

/** The panel's own read: whatever `readState` resolves is what it displays. */
function syncStatus0(args) {
  return { state: publicState(args.state) }
}

test('#10 a failed fetch leaves lastPullAt untouched', async () => {
  await withTempHome(async ({ readState, writeState }) => {
    await writeState({ lastPullAt: 555 })
    const status = await syncStatus({
      snapshot: SNAPSHOT,
      state: state(),
      options: {
        now: 987654,
        capabilities: caps(),
        fetchImpl: async () => ({ ok: false, status: 500, text: async () => '', json: async () => ({}) }),
        gitBin: 'definitely-not-git',
        timeoutMs: 10,
      },
    })
    assert.match(status.fetchError, /无法读取清单/)
    assert.equal(readState().lastPullAt, 555)
  })
})

test('#10 an invalid manifest leaves lastPullAt untouched', async () => {
  await withTempHome(async ({ readState, writeState }) => {
    await writeState({ lastPullAt: 31337 })
    const status = await syncStatus({
      snapshot: SNAPSHOT,
      state: state(),
      options: {
        now: 222,
        capabilities: caps(),
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{not json' }),
      },
    })
    assert.match(status.fetchError, /不是合法 JSON/)
    assert.equal(readState().lastPullAt, 31337)
  })
})

test('#10 syncApply success records lastPullAt and honours the injected clock', async () => {
  await withTempHome(async ({ readState }) => {
    // A skill install is a filesystem copy, so it can succeed without any
    // package manager: that is the success path this test needs.
    const profile = track(mkdtempSync(join(tmpdir(), 'dsh-profile-')))
    writeFileSync(join(profile, 'package.json'), '{"name":"p","dependencies":{}}')
    const repoRoot = track(mkdtempSync(join(tmpdir(), 'dsh-repo-')))
    mkdirSync(join(repoRoot, 'skills', 'ui-design'), { recursive: true })
    writeFileSync(join(repoRoot, 'skills', 'ui-design', 'SKILL.md'), '# ui-design')
    const vaultDir = track(mkdtempSync(join(tmpdir(), 'dsh-vault-')))
    const skillRoot = track(mkdtempSync(join(tmpdir(), 'dsh-skills-')))
    const text = JSON.stringify({
      manifestVersion: 1,
      generatedAt: 0,
      repo: 'o/r',
      ref: 'main',
      plugins: [],
      mcp: [],
      skills: [{ kind: 'skill', name: 'ui-design', platform: 'any' }],
    })
    const result = await syncApply({
      snapshot: { packages: [], mcp: [], skills: [] },
      state: state({ token: '' }),
      selection: ['skill:ui-design'],
      options: {
        now: 424242,
        profileDir: profile,
        repoRoot,
        vaultDir,
        skillRoot,
        capabilities: caps(),
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => text }),
      },
    })
    assert.equal(result.applied, 1)
    assert.equal(readState().lastPullAt, 424242)
  })
})

test('#10 syncApply without an injected clock still records a pull', async () => {
  await withTempHome(async ({ readState }) => {
    const profile = track(mkdtempSync(join(tmpdir(), 'dsh-profile-')))
    writeFileSync(join(profile, 'package.json'), '{"name":"p","dependencies":{}}')
    const repoRoot = track(mkdtempSync(join(tmpdir(), 'dsh-repo-')))
    mkdirSync(join(repoRoot, 'skills', 'ui-design'), { recursive: true })
    writeFileSync(join(repoRoot, 'skills', 'ui-design', 'SKILL.md'), '# ui-design')
    const text = JSON.stringify({
      manifestVersion: 1, generatedAt: 0, repo: 'o/r', ref: 'main',
      plugins: [], mcp: [], skills: [{ kind: 'skill', name: 'ui-design', platform: 'any' }],
    })
    const result = await syncApply({
      snapshot: { packages: [], mcp: [], skills: [] },
      state: state({ token: '' }),
      selection: ['skill:ui-design'],
      options: {
        profileDir: profile,
        repoRoot,
        vaultDir: track(mkdtempSync(join(tmpdir(), 'dsh-vault-'))),
        skillRoot: track(mkdtempSync(join(tmpdir(), 'dsh-skills-'))),
        capabilities: caps(),
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => text }),
      },
    })
    assert.equal(result.applied, 1)
    assert.equal(readState().lastPullAt > 0, true)
  })
})
