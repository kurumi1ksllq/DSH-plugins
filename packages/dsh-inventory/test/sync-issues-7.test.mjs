/**
 * Regression tests for issue #7: the fetch ref was hardcoded to `main` with no
 * default-branch fallback, so a `master` repository failed every transport.
 *
 * Public behaviour only: what comes back from `fetchManifestText`, and which
 * `--branch` the git seam is asked for.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fetchManifestText } from '../lib/sync-remote.js'

const MANIFEST = '{"manifestVersion":1}'

/** A fetch stub that models GitHub closely enough to exercise the fallbacks. */
function githubStub({ defaultBranch = 'master', rawAvailable = true, apiRef = null, probeThrows = false } = {}) {
  const calls = []
  const fetchImpl = async (url) => {
    const href = String(url)
    calls.push(href)
    // Repository probe: /repos/o/r (no /contents/ segment).
    if (/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(href)) {
      if (probeThrows) throw new Error('probe network down')
      return { ok: true, status: 200, json: async () => ({ default_branch: defaultBranch }) }
    }
    // Contents API: only the branch the repo really serves answers.
    if (href.includes('/contents/')) {
      const ref = new URL(href).searchParams.get('ref')
      if (apiRef !== null && ref === apiRef) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ encoding: 'base64', content: Buffer.from(MANIFEST, 'utf8').toString('base64') }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }
    // raw.githubusercontent.com — a private repo has no anonymous raw access.
    if (rawAvailable && href.includes('/master/')) return { ok: true, status: 200, text: async () => MANIFEST }
    return { ok: false, status: 404, text: async () => '' }
  }
  return { fetchImpl, calls }
}

// ---- raw path -------------------------------------------------------------

test('#7 raw path still retries the probed default branch once', async () => {
  const { fetchImpl, calls } = githubStub()
  const result = await fetchManifestText({ owner: 'o', repo: 'r' }, { ref: 'main', fetchImpl })
  assert.equal(result.via, 'raw')
  assert.equal(result.text, MANIFEST)
  assert.equal(calls.filter((u) => u.includes('/repos/o/r')).length, 1)
})

// ---- API-only path --------------------------------------------------------

test('#7 contents API succeeds on a master-default repo when raw is unavailable', async () => {
  // Private repo shape: raw is 404, the API works once asked for `master`.
  const { fetchImpl } = githubStub({ rawAvailable: false, apiRef: 'master' })
  const result = await fetchManifestText({ owner: 'o', repo: 'r' }, { ref: 'main', fetchImpl })
  assert.equal(result.via, 'api')
  assert.equal(result.text, MANIFEST)
})

test('#7 contents API is queried with the probed branch, not main', async () => {
  const { fetchImpl, calls } = githubStub({ defaultBranch: 'trunk', rawAvailable: false, apiRef: 'trunk' })
  const result = await fetchManifestText({ owner: 'o', repo: 'r' }, { ref: 'main', fetchImpl })
  assert.equal(result.text, MANIFEST)
  assert.equal(calls.some((u) => u.includes('/contents/') && u.includes('ref=trunk')), true)
})

// ---- git-only path --------------------------------------------------------

test('#7 git clone falls back to the probed default branch', async () => {
  // Every network transport is dead; only the git seam can answer. It records
  // the branch it is asked for and fails for `main` the way git really does.
  const branches = []
  const clone = async (args) => {
    const ref = args[args.indexOf('--branch') + 1]
    branches.push(ref)
    if (ref !== 'master') throw new Error("fatal: Remote branch main not found in upstream origin")
    const dir = args[args.length - 1]
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'dsh-manifest.json'), MANIFEST)
  }
  // The probe is the one API call that still works (private repo with token).
  const fetchImpl = async (url) => {
    if (/\/repos\/o\/r$/.test(String(url))) {
      return { ok: true, status: 200, json: async () => ({ default_branch: 'master' }) }
    }
    return { ok: false, status: 404, text: async () => '', json: async () => ({}) }
  }
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    { ref: 'main', fetchImpl, clone },
  )
  assert.equal(result.via, 'git')
  assert.equal(result.text, MANIFEST)
  assert.equal(branches.includes('master'), true)
})

// ---- probe failure --------------------------------------------------------

test('#7 a failing probe leaves the original behaviour intact', async () => {
  // Probe network error, raw 404, API 404: the old error path must still run
  // and must still mention the ref, and only one probe is attempted.
  const { fetchImpl, calls } = githubStub({ probeThrows: true })
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    { ref: 'main', fetchImpl, gitBin: 'definitely-not-git' },
  )
  assert.equal(result.text, undefined)
  assert.match(result.error, /ref/)
  assert.match(result.error, /无法读取清单/)
  assert.equal(calls.filter((u) => /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(u)).length, 1)
})

test('#7 the probe never breaks the happy path', async () => {
  const probe = async () => {
    throw new Error('probe exploded')
  }
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    { ref: 'main', fetchImpl: async (url) => (String(url).includes('raw.githubusercontent.com') ? { ok: true, status: 200, text: async () => MANIFEST } : probe()) },
  )
  assert.equal(result.via, 'raw')
  assert.equal(result.text, MANIFEST)
})
