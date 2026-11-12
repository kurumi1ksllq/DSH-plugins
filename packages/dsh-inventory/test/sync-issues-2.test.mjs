/**
 * Regression tests (part 2) for the open sync issues:
 *   #5  copySkill links the installed skill into a skill root
 *   #7  fetchManifestText probes the default branch on ref 404
 *   #8  pnpm failure rolls back profile package.json
 *   #10 successful pull writes lastPullAt
 *   #12 SECRET_KEYS coverage + env-block value scanning
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyItems, copySkill } from '../lib/sync-apply.js'
import { fetchManifestText } from '../lib/sync-remote.js'
import { syncApply, syncStatus } from '../lib/sync-service.js'
import { redactValue, isSecretKey, REDACTED } from '../lib/redact.js'

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

// ---- #5 -------------------------------------------------------------------

test('#5 copySkill links the vaulted copy into the skill root', () => {
  const repoRoot = track(mkdtempSync(join(tmpdir(), 'dsh-repo-')))
  const vault = track(mkdtempSync(join(tmpdir(), 'dsh-vault-')))
  const root = track(mkdtempSync(join(tmpdir(), 'dsh-root-')))
  mkdirSync(join(repoRoot, 'skills', 'my-skill'), { recursive: true })
  writeFileSync(join(repoRoot, 'skills', 'my-skill', 'SKILL.md'), '# x')
  const result = copySkill(
    { kind: 'skill', name: 'my-skill' },
    { repoRoot, vaultDir: vault, skillRoot: root },
  )
  assert.equal(result.ok, true)
  assert.equal(result.linked, true)
  assert.equal(existsSync(join(root, 'my-skill', 'SKILL.md')), true)
})

// ---- #7 -------------------------------------------------------------------

test('#7 fetchManifestText retries the probed default branch after a 404 on main', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    if (String(url).includes('api.github.com/repos/o/r') && !String(url).includes('/contents/')) {
      return { ok: true, status: 200, json: async () => ({ default_branch: 'master' }) }
    }
    if (String(url).includes('/master/')) {
      return { ok: true, status: 200, text: async () => '{"manifestVersion":1}' }
    }
    return { ok: false, status: 404, text: async () => '' }
  }
  const result = await fetchManifestText({ owner: 'o', repo: 'r' }, { ref: 'main', fetchImpl, gitBin: 'definitely-not-git' })
  assert.equal(result.text, '{"manifestVersion":1}')
  assert.equal(result.via, 'raw')
  assert.equal(calls.some((u) => u.includes('/master/')), true)
})

test('#7 an all-404 fetch reports "not published yet", not a ref error', async () => {
  // Every transport says 404: the manifest file simply is not there. That is
  // the normal state before a first publish, so it must be flagged `notFound`
  // rather than surfacing the scary "check your ref" message.
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => '' })
  const result = await fetchManifestText({ owner: 'o', repo: 'r' }, { ref: 'main', fetchImpl, gitBin: 'definitely-not-git' })
  assert.equal(result.text, undefined)
  assert.equal(result.notFound, true)
  assert.equal(result.missing, true)
  assert.doesNotMatch(result.error, /无法读取清单/)
})

test('#7 a non-404 failure still reports the ref', async () => {
  // The ref hint is still the right advice when the transport failed for any
  // reason *other* than 404 — that case must not be downgraded to notFound.
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => '' })
  const result = await fetchManifestText({ owner: 'o', repo: 'r' }, { ref: 'main', fetchImpl, gitBin: 'definitely-not-git' })
  assert.equal(result.text, undefined)
  assert.notEqual(result.notFound, true)
  assert.match(result.error, /ref/)
})

// ---- #8 -------------------------------------------------------------------

test('#8 a failed pnpm install rolls back profile package.json', async () => {
  const dir = track(mkdtempSync(join(tmpdir(), 'dsh-profile-')))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'profile', dependencies: { existing: '1.0.0' } }, null, 2))
  const result = await applyItems(
    [{ kind: 'plugin', name: 'dsh-ctx-guard', source: 'npm', version: '1.0.0' }],
    { profileDir: dir, pnpmBin: 'definitely-not-pnpm-xyz' },
  )
  assert.equal(result.ok, false)
  const after = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  assert.deepEqual(after.dependencies, { existing: '1.0.0' })
  const failed = result.results.find((r) => r.key === 'plugin:dsh-ctx-guard')
  assert.equal(failed.ok, false)
})

// ---- #10 ------------------------------------------------------------------

test('#10 a successful status pull writes lastPullAt', async () => {
  const home = track(mkdtempSync(join(tmpdir(), 'dsh-home-')))
  process.env.DSH_HOME = home
  try {
    const { readState } = await import('../lib/sync-state.js')
    const snapshot = { packages: [], mcp: [], skills: [] }
    const state = { repo: 'o/r', ref: 'main', path: 'dsh-manifest.json', token: '', annotations: {} }
    const text = JSON.stringify({
      manifestVersion: 1, generatedAt: 0, repo: 'o/r', ref: 'main',
      plugins: [], mcp: [], skills: [],
    })
    const status = await syncStatus({
      snapshot, state,
      options: {
        capabilities: caps(),
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => text }),
      },
    })
    assert.equal(status.fetchError, undefined)
    assert.equal(readState().lastPullAt > 0, true)
  } finally {
    delete process.env.DSH_HOME
  }
})

test('#10 a failed install does not record a pull', async () => {
  const home = track(mkdtempSync(join(tmpdir(), 'dsh-home2-')))
  process.env.DSH_HOME = home
  try {
    const profile = track(mkdtempSync(join(tmpdir(), 'dsh-prof-')))
    writeFileSync(join(profile, 'package.json'), '{"name":"p","dependencies":{}}')
    const text = JSON.stringify({
      manifestVersion: 1, generatedAt: 0, repo: 'o/r', ref: 'main',
      plugins: [{ kind: 'plugin', name: 'a', version: '1.0.0', source: 'npm', platform: 'any', requires: [], self: false }],
      mcp: [], skills: [],
    })
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => text })
    const result = await syncApply({
      snapshot: { packages: [], mcp: [], skills: [] },
      state: { repo: 'o/r', ref: 'main', path: 'dsh-manifest.json', token: '', annotations: {} },
      selection: ['plugin:a'],
      options: { profileDir: profile, pnpmBin: 'definitely-not-pnpm-xyz', capabilities: caps(), fetchImpl },
    })
    assert.equal(result.ok, false)
    const { readState } = await import('../lib/sync-state.js')
    assert.equal(readState().lastPullAt, 0)
  } finally {
    delete process.env.DSH_HOME
  }
})

// ---- #12 ------------------------------------------------------------------

test('#12 isSecretKey covers the newly added key names', () => {
  for (const key of ['privateKey', 'clientSecret', 'refreshToken', 'secretKey', 'PRIVATE_KEY', 'client_secret']) {
    assert.equal(isSecretKey(key), true, key)
  }
  assert.equal(isSecretKey('envKey'), false)
})

test('#12 redactValue masks credential-shaped values inside env blocks', () => {
  const out = redactValue({
    env: {
      GITHUB_TOKEN: 'ghp_abcdefghijklmnopqrstuv1234567890',
      PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----',
      API_KEY: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      LOG_LEVEL: 'info',
      ENDPOINT: 'https://example.com',
    },
  })
  assert.equal(out.env.GITHUB_TOKEN, REDACTED)
  assert.equal(out.env.PRIVATE_KEY, REDACTED)
  assert.equal(out.env.API_KEY, REDACTED)
  assert.equal(out.env.LOG_LEVEL, 'info')
  assert.equal(out.env.ENDPOINT, 'https://example.com')
})

test('#12 redactValue leaves ordinary objects untouched by env scanning', () => {
  const out = redactValue({ meta: { note: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } })
  assert.equal(out.meta.note, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
})
