/**
 * Tests for reading a profile off disk and for one reconciliation pass.
 *
 * Every filesystem fixture is created under a temp dir and removed afterwards;
 * the git clone is stubbed by injecting `fetched`, so no test touches the
 * network.
 *
 * Run: node --test test/*.test.mjs
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { readInstalled, resolveProfileDir } from '../lib/installed.js'
import { reconcile } from '../lib/reconcile.js'

/** Build a fake profile dir with the given dependencies and versions. */
function makeProfile(root, { dependencies = {}, bundles = [], versions = {} } = {}) {
  const dir = join(root, 'profile')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake-profile', dependencies, dsh: { profile: { bundles } } }, null, 2))
  for (const [pkgName, version] of Object.entries(versions)) {
    const pkgDir = join(dir, 'node_modules', pkgName)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: pkgName, version }))
  }
  return dir
}

let scratch
before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'dsh-plugin-sync-test-'))
})
after(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true })
})

describe('readInstalled', () => {
  it('returns nothing for a missing or empty profile dir', () => {
    assert.deepEqual(readInstalled(undefined), [])
    assert.deepEqual(readInstalled(''), [])
    assert.deepEqual(readInstalled(join(scratch, 'does-not-exist')), [])
  })

  it('reads versions from node_modules, not from the declared spec', () => {
    const dir = makeProfile(scratch, {
      dependencies: { 'dsh-ctx-guard': 'link:../../packages/dsh-ctx-guard' },
      versions: { 'dsh-ctx-guard': '0.1.1' },
    })
    const [pkg] = readInstalled(dir)
    assert.equal(pkg.name, 'dsh-ctx-guard')
    assert.equal(pkg.version, '0.1.1')
    assert.equal(pkg.linked, true)
    assert.equal(pkg.present, true)
  })

  it('marks a declared dependency with no node_modules entry as absent', () => {
    const dir = makeProfile(scratch, { dependencies: { 'ghost-plugin': '^1.0.0' } })
    const [pkg] = readInstalled(dir)
    assert.equal(pkg.present, false)
    assert.equal(pkg.version, undefined)
  })

  it('includes declared bundles that are not dependencies', () => {
    const dir = makeProfile(scratch, { bundles: ['@deepseek-ai/dsh-base'], versions: { '@deepseek-ai/dsh-base': '9.0.0' } })
    const [pkg] = readInstalled(dir)
    assert.equal(pkg.name, '@deepseek-ai/dsh-base')
    assert.equal(pkg.builtin, true)
    assert.equal(pkg.version, '9.0.0')
  })

  it('sorts by name', () => {
    const dir = makeProfile(scratch, {
      dependencies: { zeta: '1.0.0', alpha: '1.0.0' },
      versions: { zeta: '1.0.0', alpha: '1.0.0' },
    })
    assert.deepEqual(readInstalled(dir).map((p) => p.name), ['alpha', 'zeta'])
  })
})

describe('resolveProfileDir', () => {
  // Every case pins DSH_HOME at a scratch dir so the real ~/.dsh/profiles/desktop
  // on the developer machine can never satisfy the fallback and mask a bug.
  const noHome = () => ({ DSH_HOME: join(scratch, 'no-such-home') })

  it('prefers a file: baseUrl that points at a real profile', () => {
    const dir = makeProfile(scratch)
    assert.equal(resolveProfileDir({ baseUrl: `file:///${dir}` }, noHome()), dir)
  })

  it('falls back to DSH_PROFILE_DIR when baseUrl is unusable', () => {
    const dir = makeProfile(scratch)
    assert.equal(resolveProfileDir({}, { ...noHome(), DSH_PROFILE_DIR: dir }), dir)
  })

  it('returns null when nothing resolves to a real profile', () => {
    assert.equal(resolveProfileDir({}, noHome()), null)
  })

  it('ignores a non-file baseUrl', () => {
    assert.equal(resolveProfileDir({ baseUrl: 'https://example.invalid' }, noHome()), null)
  })

  it('uses DSH_HOME/profiles/desktop as the last resort', () => {
    const home = join(scratch, 'home-with-desktop')
    const desktop = join(home, 'profiles', 'desktop')
    mkdirSync(desktop, { recursive: true })
    writeFileSync(join(desktop, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop' }))
    assert.equal(resolveProfileDir({}, { DSH_HOME: home }), desktop)
  })
})

describe('reconcile', () => {
  const config = { repo: 'https://example.invalid/repo.git', ref: 'main', apply: false, direction: 'remote', exclude: ['dsh-plugin-sync'] }

  it('reports a failed fetch instead of throwing', async () => {
    const state = await reconcile(config, {
      profileDir: makeProfile(scratch),
      installed: [],
      fetched: { ok: false, reason: 'git-failed: no network', plugins: [], problems: [] },
    })
    assert.equal(state.ok, false)
    assert.equal(state.reason, 'git-failed: no network')
    assert.deepEqual(state.pending, [])
  })

  it('reports differences without applying when apply is false', async () => {
    const installed = [{ name: 'dsh-ctx-guard', version: '0.1.0', present: true }]
    const state = await reconcile(config, {
      profileDir: makeProfile(scratch),
      installed,
      fetched: { ok: true, reason: null, plugins: [{ name: 'dsh-ctx-guard', version: '0.1.1' }], problems: [] },
    })
    assert.equal(state.ok, true)
    assert.equal(state.pending.length, 1)
    assert.equal(state.pending[0].state, 'outdated')
    assert.deepEqual(state.applied, [])
  })

  it('calls the apply runner once per applicable action in apply mode', async () => {
    const calls = []
    const state = await reconcile(
      { ...config, apply: true },
      {
        profileDir: makeProfile(scratch),
        installed: [],
        fetched: {
          ok: true,
          reason: null,
          plugins: [
            { name: 'dsh-ctx-guard', version: '0.1.1' },
            { name: 'dsh-plugin-sync', version: '0.2.0' },
          ],
          problems: [],
        },
        applyPlugins: async (action) => {
          calls.push(action.name)
        },
      },
    )
    assert.deepEqual(calls, ['dsh-ctx-guard'])
    assert.equal(state.applied.length, 1)
  })

  it('records a failed apply without aborting the rest', async () => {
    const state = await reconcile(
      { ...config, apply: true },
      {
        profileDir: makeProfile(scratch),
        installed: [],
        fetched: {
          ok: true,
          reason: null,
          plugins: [
            { name: 'a', version: '1' },
            { name: 'b', version: '1' },
          ],
          problems: [],
        },
        applyPlugins: async (action) => {
          if (action.name === 'a') throw new Error('pnpm said no')
        },
      },
    )
    assert.equal(state.applied.length, 2)
    assert.equal(state.applied[0].ok, false)
    assert.equal(state.applied[0].error, 'pnpm said no')
    assert.equal(state.applied[1].ok, true)
  })

  it('never applies when direction is local', async () => {
    const calls = []
    const state = await reconcile(
      { ...config, apply: true, direction: 'local' },
      {
        profileDir: makeProfile(scratch),
        installed: [],
        fetched: { ok: true, reason: null, plugins: [{ name: 'a', version: '1' }], problems: [] },
        applyPlugins: async (action) => {
          calls.push(action.name)
        },
      },
    )
    assert.deepEqual(calls, [])
    assert.equal(state.pending.length, 1)
  })
})
